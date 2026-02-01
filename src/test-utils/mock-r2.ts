/**
 * Mock R2 Bucket for testing purposes.
 * Implements the Cloudflare Workers R2 interface in-memory.
 */

/**
 * Stored R2 object with value, metadata, and HTTP metadata.
 */
interface StoredObject {
  key: string
  value: ArrayBuffer
  customMetadata: Record<string, string>
  httpMetadata?: R2HTTPMetadata
  size: number
  uploaded: Date
  etag: string
}

/**
 * Creates a mock R2Object from stored data
 */
function createR2Object(stored: StoredObject): R2Object {
  const { key, value, customMetadata, httpMetadata, size, uploaded, etag } = stored

  return {
    key,
    version: etag,
    size,
    etag,
    httpEtag: `"${etag}"`,
    uploaded,
    httpMetadata: httpMetadata ?? {},
    customMetadata,
    checksums: {
      toJSON: () => ({}),
    },
    storageClass: 'Standard' as R2ObjectStorageClass,

    // R2ObjectBody methods
    async text(): Promise<string> {
      return new TextDecoder().decode(value)
    },

    async json<T>(): Promise<T> {
      const text = new TextDecoder().decode(value)
      return JSON.parse(text) as T
    },

    async arrayBuffer(): Promise<ArrayBuffer> {
      return value
    },

    get body(): ReadableStream<Uint8Array> {
      const data = new Uint8Array(value)
      return new ReadableStream({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })
    },

    get bodyUsed(): boolean {
      return false
    },

    async blob(): Promise<Blob> {
      return new Blob([value])
    },

    writeHttpMetadata(_headers: Headers): void {
      // No-op for mock
    },
  } as R2Object
}

/**
 * Creates a mock R2ObjectBody (for head operations that return metadata only)
 */
function createR2ObjectHead(stored: StoredObject): R2Object {
  const { key, customMetadata, httpMetadata, size, uploaded, etag } = stored

  return {
    key,
    version: etag,
    size,
    etag,
    httpEtag: `"${etag}"`,
    uploaded,
    httpMetadata: httpMetadata ?? {},
    customMetadata,
    checksums: {
      toJSON: () => ({}),
    },
    storageClass: 'Standard' as R2ObjectStorageClass,

    writeHttpMetadata(_headers: Headers): void {
      // No-op for mock
    },
  } as R2Object
}

/**
 * Creates a mock R2Bucket for testing purposes.
 * Implements the Cloudflare Workers R2 interface in-memory.
 */
export function createMockR2(): R2Bucket {
  const store = new Map<string, StoredObject>()
  let objectCounter = 0

  const generateEtag = (): string => {
    objectCounter++
    return `etag-${objectCounter}-${Date.now()}`
  }

  return {
    async head(key: string): Promise<R2Object | null> {
      const stored = store.get(key)
      if (!stored) {
        return null
      }
      return createR2ObjectHead(stored)
    },

    async get(
      key: string,
      _options?: R2GetOptions
    ): Promise<R2ObjectBody | R2Object | null> {
      const stored = store.get(key)
      if (!stored) {
        return null
      }
      return createR2Object(stored) as R2ObjectBody
    },

    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutOptions
    ): Promise<R2Object> {
      let arrayBuffer: ArrayBuffer

      if (typeof value === 'string') {
        arrayBuffer = new TextEncoder().encode(value).buffer
      } else if (value instanceof ArrayBuffer) {
        arrayBuffer = value
      } else if (ArrayBuffer.isView(value)) {
        arrayBuffer = value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength
        )
      } else if (value instanceof Blob) {
        arrayBuffer = await value.arrayBuffer()
      } else if (value instanceof ReadableStream) {
        // Handle ReadableStream
        const reader = value.getReader()
        const chunks: Uint8Array[] = []
        let done = false

        while (!done) {
          const result = await reader.read()
          if (result.value) {
            chunks.push(result.value)
          }
          done = result.done
        }

        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        arrayBuffer = combined.buffer
      } else if (value === null) {
        arrayBuffer = new ArrayBuffer(0)
      } else {
        throw new Error('Unsupported value type for R2 put')
      }

      const etag = generateEtag()
      const stored: StoredObject = {
        key,
        value: arrayBuffer,
        customMetadata: (options?.customMetadata as Record<string, string>) ?? {},
        httpMetadata: options?.httpMetadata,
        size: arrayBuffer.byteLength,
        uploaded: new Date(),
        etag,
      }

      store.set(key, stored)

      return createR2ObjectHead(stored)
    },

    async delete(keys: string | string[]): Promise<void> {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      for (const key of keyArray) {
        store.delete(key)
      }
    },

    async list(options?: R2ListOptions): Promise<R2Objects> {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const delimiter = options?.delimiter
      const cursor = options?.cursor

      const objects: R2Object[] = []
      const delimitedPrefixes: string[] = []

      // Get all keys with the prefix
      const allKeys = Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .sort()

      // Handle cursor (simplified: treat cursor as the start index)
      const startIndex = cursor ? parseInt(cursor, 10) : 0

      let count = 0
      for (let i = startIndex; i < allKeys.length && count < limit; i++) {
        const key = allKeys[i]!
        const stored = store.get(key)!

        if (delimiter) {
          // Handle delimiter for hierarchical listing
          const suffixStart = prefix.length
          const delimiterIndex = key.indexOf(delimiter, suffixStart)

          if (delimiterIndex !== -1) {
            // This key contains the delimiter after the prefix
            const commonPrefix = key.slice(0, delimiterIndex + delimiter.length)
            if (!delimitedPrefixes.includes(commonPrefix)) {
              delimitedPrefixes.push(commonPrefix)
              count++
            }
          } else {
            // No delimiter after prefix, include the object
            objects.push(createR2ObjectHead(stored))
            count++
          }
        } else {
          objects.push(createR2ObjectHead(stored))
          count++
        }
      }

      const hasMore = startIndex + limit < allKeys.length

      return {
        objects,
        truncated: hasMore,
        cursor: hasMore ? String(startIndex + limit) : undefined,
        delimitedPrefixes,
      }
    },

    createMultipartUpload(
      _key: string,
      _options?: R2MultipartOptions
    ): Promise<R2MultipartUpload> {
      throw new Error('Multipart upload not implemented in mock')
    },

    resumeMultipartUpload(_key: string, _uploadId: string): R2MultipartUpload {
      throw new Error('Resume multipart upload not implemented in mock')
    },
  }
}

/**
 * Create a mock R2 bucket with pre-populated data for testing
 */
export async function createMockR2WithData(
  data: Record<string, string | ArrayBuffer>
): Promise<R2Bucket> {
  const bucket = createMockR2()

  for (const [key, value] of Object.entries(data)) {
    await bucket.put(key, value)
  }

  return bucket
}
