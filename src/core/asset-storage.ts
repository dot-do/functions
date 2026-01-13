/**
 * Asset Storage for WASM Binaries
 *
 * Uses Cloudflare Workers Static Assets for storing compiled WASM binaries.
 * Benefits:
 * - Free storage and requests
 * - 25MB per file limit (plenty for WASM)
 * - Edge-cached globally
 * - Direct upload API for CI/CD
 *
 * Storage layout:
 *   /wasm/{functionId}/{version}.wasm
 *   /wasm/{functionId}/latest.wasm (symlink to latest version)
 */

import { validateFunctionId } from './function-registry'

/**
 * Interface for the ASSETS binding from Workers Static Assets
 */
export interface AssetsBinding {
  fetch(request: Request | string): Promise<Response>
}

/**
 * Result from storing a WASM binary
 */
export interface StoreWasmResult {
  path: string
  size: number
  hash: string
}

/**
 * Asset storage for WASM binaries using Workers Static Assets
 */
export class AssetStorage {
  constructor(private assets: AssetsBinding) {}

  /**
   * Get the asset path for a function's WASM binary
   */
  private getWasmPath(functionId: string, version?: string): string {
    return `/wasm/${functionId}/${version || 'latest'}.wasm`
  }

  /**
   * Fetch a WASM binary from static assets
   *
   * @param functionId - The function ID
   * @param version - Optional version (defaults to 'latest')
   * @returns The WASM binary as Uint8Array, or null if not found
   */
  async getWasm(functionId: string, version?: string): Promise<Uint8Array | null> {
    validateFunctionId(functionId)

    const path = this.getWasmPath(functionId, version)
    const response = await this.assets.fetch(new Request(`https://assets${path}`))

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  }

  /**
   * Check if a WASM binary exists
   */
  async hasWasm(functionId: string, version?: string): Promise<boolean> {
    validateFunctionId(functionId)

    const path = this.getWasmPath(functionId, version)
    const response = await this.assets.fetch(
      new Request(`https://assets${path}`, { method: 'HEAD' })
    )

    return response.ok
  }

  /**
   * Get the URL for a WASM binary (for external access)
   */
  getWasmUrl(functionId: string, version?: string, baseUrl = 'https://functions.do'): string {
    validateFunctionId(functionId)
    return `${baseUrl}${this.getWasmPath(functionId, version)}`
  }
}

/**
 * Direct Upload API for WASM binaries
 *
 * Used during deployment to upload compiled WASM to static assets.
 * Requires Cloudflare API credentials.
 */
export class AssetUploader {
  constructor(
    private accountId: string,
    private apiToken: string,
    private scriptName = 'functions-do'
  ) {}

  /**
   * Upload a WASM binary to static assets via Direct Upload API
   *
   * @param functionId - The function ID
   * @param version - The version
   * @param wasm - The WASM binary
   * @returns The upload result
   */
  async uploadWasm(
    functionId: string,
    version: string,
    wasm: Uint8Array
  ): Promise<StoreWasmResult> {
    validateFunctionId(functionId)

    const path = `/wasm/${functionId}/${version}.wasm`
    const hash = await this.computeHash(wasm)

    // Step 1: Create upload session with manifest
    const manifest = {
      [path]: {
        hash,
        size: wasm.byteLength,
      },
    }

    const sessionResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${this.scriptName}/assets-upload-session`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest }),
      }
    )

    if (!sessionResponse.ok) {
      const error = await sessionResponse.text()
      throw new Error(`Failed to create upload session: ${error}`)
    }

    const session = await sessionResponse.json() as {
      result: {
        jwt: string
        buckets: string[][]
      }
    }

    // Step 2: Upload files if needed (not already cached)
    const needsUpload = session.result.buckets.flat().includes(hash)

    if (needsUpload) {
      const formData = new FormData()
      const base64Wasm = this.toBase64(wasm)
      formData.append(hash, new Blob([base64Wasm]), path)

      const uploadResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/assets/upload?base64=true`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.result.jwt}`,
          },
          body: formData,
        }
      )

      if (!uploadResponse.ok) {
        const error = await uploadResponse.text()
        throw new Error(`Failed to upload WASM: ${error}`)
      }
    }

    return {
      path,
      size: wasm.byteLength,
      hash,
    }
  }

  /**
   * Upload multiple WASM binaries in a single session
   */
  async uploadBatch(
    files: Array<{ functionId: string; version: string; wasm: Uint8Array }>
  ): Promise<StoreWasmResult[]> {
    // Build manifest for all files
    const manifest: Record<string, { hash: string; size: number }> = {}
    const fileMap = new Map<string, { path: string; wasm: Uint8Array }>()

    for (const file of files) {
      validateFunctionId(file.functionId)
      const path = `/wasm/${file.functionId}/${file.version}.wasm`
      const hash = await this.computeHash(file.wasm)
      manifest[path] = { hash, size: file.wasm.byteLength }
      fileMap.set(hash, { path, wasm: file.wasm })
    }

    // Create upload session
    const sessionResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${this.scriptName}/assets-upload-session`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest }),
      }
    )

    if (!sessionResponse.ok) {
      const error = await sessionResponse.text()
      throw new Error(`Failed to create upload session: ${error}`)
    }

    const session = await sessionResponse.json() as {
      result: {
        jwt: string
        buckets: string[][]
      }
    }

    // Upload files that need uploading
    const hashesToUpload = new Set(session.result.buckets.flat())

    if (hashesToUpload.size > 0) {
      const formData = new FormData()

      for (const hash of hashesToUpload) {
        const file = fileMap.get(hash)
        if (file) {
          const base64Wasm = this.toBase64(file.wasm)
          formData.append(hash, new Blob([base64Wasm]), file.path)
        }
      }

      const uploadResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/assets/upload?base64=true`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.result.jwt}`,
          },
          body: formData,
        }
      )

      if (!uploadResponse.ok) {
        const error = await uploadResponse.text()
        throw new Error(`Failed to upload WASM batch: ${error}`)
      }
    }

    // Return results
    return files.map((file) => {
      const path = `/wasm/${file.functionId}/${file.version}.wasm`
      return {
        path,
        size: file.wasm.byteLength,
        hash: manifest[path]!.hash,
      }
    })
  }

  /**
   * Compute SHA-256 hash of data (hex string)
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private toBase64(data: Uint8Array): string {
    // Use Buffer in Node.js, btoa in browser/Workers
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(data).toString('base64')
    }
    const binary = String.fromCharCode(...data)
    return btoa(binary)
  }
}
