/**
 * E2E Tests: Function Rollback (RED)
 *
 * Issue: functions-o3nt
 *
 * Comprehensive E2E tests for function rollback functionality on the
 * live functions.do platform. Tests cover:
 *
 * 1. Deploy multiple versions of a function
 * 2. Rollback to a previous version
 * 3. Verify the rollback worked
 * 4. Test error cases
 *
 * Prerequisites:
 * - functions.do Worker must be deployed
 * - No auth required initially (added later with oauth.do)
 *
 * Run with: npm run test:e2e
 *
 * RED Phase: These tests document expected behavior and may fail until
 * implementation is complete.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deployAndUploadFunction,
  invokeFunction,
  deleteFunction,
} from './config'

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get function info via API
 */
async function getFunctionInfo(functionId: string): Promise<{
  id: string
  version: string
  language: string
  createdAt: string
  updatedAt: string
  versions: string[]
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/info`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get function info failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Rollback a function to a specific version
 */
async function rollbackFunction(
  functionId: string,
  version: string
): Promise<{
  id: string
  version: string
  rolledBackFrom: string
  rolledBackAt: string
}> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions/${functionId}/rollback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({ version }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Rollback failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get rollback history for a function
 */
async function getRollbackHistory(functionId: string): Promise<
  Array<{
    version: string
    rolledBackFrom: string
    rolledBackAt: string
    triggeredBy?: string
  }>
> {
  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}/rollback/history`,
    {
      method: 'GET',
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get rollback history failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get deployment history for a function
 */
async function getDeploymentHistory(functionId: string): Promise<
  Array<{
    version: string
    deployedAt: string
    metadata: Record<string, unknown>
  }>
> {
  const response = await fetch(
    `${E2E_CONFIG.baseUrl}/api/functions/${functionId}/deployments`,
    {
      method: 'GET',
      headers: {
        ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get deployment history failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Helper to create a versioned function code
 */
function createVersionedCode(version: string, data: string = 'default'): string {
  return `
    export default {
      async fetch(request: Request): Promise<Response> {
        return Response.json({
          version: '${version}',
          data: '${data}',
          deployedWith: 'functions.do'
        })
      }
    }
  `
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe.skipIf(!shouldRunE2E())('E2E: Function Rollback', () => {
  const deployedFunctions: string[] = []

  afterAll(async () => {
    // Cleanup all deployed test functions
    if (!E2E_CONFIG.skipCleanup) {
      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ===========================================================================
  // 1. DEPLOY MULTIPLE VERSIONS
  // ===========================================================================

  describe('1. Deploy Multiple Versions', () => {
    let multiVersionFunctionId: string

    beforeAll(() => {
      multiVersionFunctionId = generateTestFunctionId()
      deployedFunctions.push(multiVersionFunctionId)
    })

    it('deploys v1.0.0 as initial version', async () => {
      const result = await deployAndUploadFunction({
        id: multiVersionFunctionId,
        code: createVersionedCode('1.0.0', 'initial'),
        language: 'typescript',
        version: '1.0.0',
      })

      expect(result.id).toBe(multiVersionFunctionId)
      expect(result.version).toBe('1.0.0')
    }, E2E_CONFIG.deployTimeout)

    it('deploys v1.1.0 as second version', async () => {
      const result = await deployAndUploadFunction({
        id: multiVersionFunctionId,
        code: createVersionedCode('1.1.0', 'patched'),
        language: 'typescript',
        version: '1.1.0',
      })

      expect(result.id).toBe(multiVersionFunctionId)
      expect(result.version).toBe('1.1.0')
    }, E2E_CONFIG.deployTimeout)

    it('deploys v2.0.0 as third version', async () => {
      const result = await deployAndUploadFunction({
        id: multiVersionFunctionId,
        code: createVersionedCode('2.0.0', 'major-update'),
        language: 'typescript',
        version: '2.0.0',
      })

      expect(result.id).toBe(multiVersionFunctionId)
      expect(result.version).toBe('2.0.0')
    }, E2E_CONFIG.deployTimeout)

    it('function info shows all deployed versions', async () => {
      const info = await getFunctionInfo(multiVersionFunctionId)

      expect(info.id).toBe(multiVersionFunctionId)
      expect(info.version).toBe('2.0.0') // Current version
      expect(info.versions).toContain('1.0.0')
      expect(info.versions).toContain('1.1.0')
      expect(info.versions).toContain('2.0.0')
      expect(info.versions.length).toBeGreaterThanOrEqual(3)
    }, E2E_CONFIG.invokeTimeout)

    it('invoking returns the latest version (2.0.0)', async () => {
      const result = await invokeFunction<{
        version: string
        data: string
      }>(multiVersionFunctionId)

      expect(result.version).toBe('2.0.0')
      expect(result.data).toBe('major-update')
    }, E2E_CONFIG.invokeTimeout)
  })

  // ===========================================================================
  // 2. ROLLBACK TO PREVIOUS VERSION
  // ===========================================================================

  describe('2. Rollback to Previous Version', () => {
    let rollbackFunctionId: string

    beforeAll(async () => {
      rollbackFunctionId = generateTestFunctionId()
      deployedFunctions.push(rollbackFunctionId)

      // Deploy v1.0.0
      await deployAndUploadFunction({
        id: rollbackFunctionId,
        code: createVersionedCode('1.0.0', 'original'),
        language: 'typescript',
        version: '1.0.0',
      })

      // Deploy v2.0.0
      await deployAndUploadFunction({
        id: rollbackFunctionId,
        code: createVersionedCode('2.0.0', 'updated'),
        language: 'typescript',
        version: '2.0.0',
      })
    }, E2E_CONFIG.deployTimeout * 2)

    it('rollback from v2.0.0 to v1.0.0', async () => {
      const result = await rollbackFunction(rollbackFunctionId, '1.0.0')

      expect(result.id).toBe(rollbackFunctionId)
      expect(result.version).toBe('1.0.0')
      expect(result.rolledBackFrom).toBe('2.0.0')
      expect(result.rolledBackAt).toBeDefined()
    }, E2E_CONFIG.invokeTimeout)

    it('rollback response includes timestamp', async () => {
      // Deploy v3.0.0 first
      await deployAndUploadFunction({
        id: rollbackFunctionId,
        code: createVersionedCode('3.0.0', 'newest'),
        language: 'typescript',
        version: '3.0.0',
      })

      const beforeRollback = new Date().toISOString()
      const result = await rollbackFunction(rollbackFunctionId, '2.0.0')
      const afterRollback = new Date().toISOString()

      expect(result.rolledBackAt).toBeDefined()
      expect(result.rolledBackAt >= beforeRollback).toBe(true)
      expect(result.rolledBackAt <= afterRollback).toBe(true)
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('can rollback to any previous version, not just immediate', async () => {
      // Current should be v2.0.0 (from previous test)
      // Rollback directly to v1.0.0
      const result = await rollbackFunction(rollbackFunctionId, '1.0.0')

      expect(result.version).toBe('1.0.0')
      expect(result.rolledBackFrom).toBe('2.0.0')
    }, E2E_CONFIG.invokeTimeout)

    it('can rollback forward to a newer version', async () => {
      // After rolling back to 1.0.0, we can "rollback" to 3.0.0
      const result = await rollbackFunction(rollbackFunctionId, '3.0.0')

      expect(result.version).toBe('3.0.0')
      expect(result.rolledBackFrom).toBe('1.0.0')
    }, E2E_CONFIG.invokeTimeout)
  })

  // ===========================================================================
  // 3. VERIFY ROLLBACK WORKED
  // ===========================================================================

  describe('3. Verify Rollback Worked', () => {
    let verifyFunctionId: string

    beforeAll(async () => {
      verifyFunctionId = generateTestFunctionId()
      deployedFunctions.push(verifyFunctionId)

      // Deploy v1.0.0
      await deployAndUploadFunction({
        id: verifyFunctionId,
        code: createVersionedCode('1.0.0', 'v1-data'),
        language: 'typescript',
        version: '1.0.0',
      })

      // Deploy v2.0.0
      await deployAndUploadFunction({
        id: verifyFunctionId,
        code: createVersionedCode('2.0.0', 'v2-data'),
        language: 'typescript',
        version: '2.0.0',
      })
    }, E2E_CONFIG.deployTimeout * 2)

    it('invoking after rollback returns rolled-back version', async () => {
      // First verify we're on v2.0.0
      let result = await invokeFunction<{ version: string; data: string }>(verifyFunctionId)
      expect(result.version).toBe('2.0.0')
      expect(result.data).toBe('v2-data')

      // Rollback to v1.0.0
      await rollbackFunction(verifyFunctionId, '1.0.0')

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Now invoking should return v1.0.0
      result = await invokeFunction<{ version: string; data: string }>(verifyFunctionId)
      expect(result.version).toBe('1.0.0')
      expect(result.data).toBe('v1-data')
    }, E2E_CONFIG.invokeTimeout * 2 + 2000)

    it('function info shows rolled-back version as current', async () => {
      const info = await getFunctionInfo(verifyFunctionId)

      expect(info.version).toBe('1.0.0')
      // All versions should still exist
      expect(info.versions).toContain('1.0.0')
      expect(info.versions).toContain('2.0.0')
    }, E2E_CONFIG.invokeTimeout)

    it('multiple concurrent invocations after rollback all return correct version', async () => {
      // Run 5 concurrent invocations
      const promises = Array.from({ length: 5 }, () =>
        invokeFunction<{ version: string; data: string }>(verifyFunctionId)
      )

      const results = await Promise.all(promises)

      // All should return v1.0.0
      results.forEach((result) => {
        expect(result.version).toBe('1.0.0')
        expect(result.data).toBe('v1-data')
      })
    }, E2E_CONFIG.invokeTimeout)

    it('rollback is atomic - no intermediate states visible', async () => {
      // Deploy v3.0.0
      await deployAndUploadFunction({
        id: verifyFunctionId,
        code: createVersionedCode('3.0.0', 'v3-data'),
        language: 'typescript',
        version: '3.0.0',
      })

      // Start multiple invocations while rolling back
      const rollbackPromise = rollbackFunction(verifyFunctionId, '2.0.0')
      const invokePromises = Array.from({ length: 10 }, () =>
        invokeFunction<{ version: string }>(verifyFunctionId)
      )

      await rollbackPromise
      const results = await Promise.all(invokePromises)

      // All results should be either v3.0.0 (before rollback) or v2.0.0 (after)
      // No intermediate or inconsistent states
      results.forEach((result) => {
        expect(['2.0.0', '3.0.0']).toContain(result.version)
      })
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout)

    it('deployment history records the rollback', async () => {
      const history = await getDeploymentHistory(verifyFunctionId)

      // History should include all deployments and rollbacks
      expect(history.length).toBeGreaterThanOrEqual(2)

      // Versions should be present
      const versions = history.map((h) => h.version)
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('2.0.0')
    }, E2E_CONFIG.invokeTimeout)

    it('rollback history is tracked', async () => {
      const history = await getRollbackHistory(verifyFunctionId)

      // Should have at least one rollback recorded
      expect(history.length).toBeGreaterThanOrEqual(1)

      // Check structure
      const lastRollback = history[0]
      expect(lastRollback.version).toBeDefined()
      expect(lastRollback.rolledBackFrom).toBeDefined()
      expect(lastRollback.rolledBackAt).toBeDefined()
    }, E2E_CONFIG.invokeTimeout)
  })

  // ===========================================================================
  // 4. TEST ERROR CASES
  // ===========================================================================

  describe('4. Error Cases', () => {
    let errorTestFunctionId: string

    beforeAll(async () => {
      errorTestFunctionId = generateTestFunctionId()
      deployedFunctions.push(errorTestFunctionId)

      // Deploy only v1.0.0
      await deployAndUploadFunction({
        id: errorTestFunctionId,
        code: createVersionedCode('1.0.0', 'only-version'),
        language: 'typescript',
        version: '1.0.0',
      })
    }, E2E_CONFIG.deployTimeout)

    it('fails to rollback to non-existent version', async () => {
      await expect(rollbackFunction(errorTestFunctionId, '99.0.0')).rejects.toThrow(
        /not found|does not exist|invalid version/i
      )
    }, E2E_CONFIG.invokeTimeout)

    it('fails to rollback non-existent function', async () => {
      const nonExistentId = 'non-existent-function-' + Date.now()

      await expect(rollbackFunction(nonExistentId, '1.0.0')).rejects.toThrow(
        /not found|does not exist/i
      )
    }, E2E_CONFIG.invokeTimeout)

    it('fails with invalid version format', async () => {
      await expect(rollbackFunction(errorTestFunctionId, 'invalid-version')).rejects.toThrow(
        /invalid|not found|format/i
      )
    }, E2E_CONFIG.invokeTimeout)

    it('fails with empty version string', async () => {
      await expect(rollbackFunction(errorTestFunctionId, '')).rejects.toThrow(
        /required|invalid|empty/i
      )
    }, E2E_CONFIG.invokeTimeout)

    it('handles rollback to current version gracefully', async () => {
      // Rollback to the currently active version (should be a no-op or return success)
      const result = await rollbackFunction(errorTestFunctionId, '1.0.0')

      // Either succeeds (as a no-op) or returns current version info
      expect(result.version).toBe('1.0.0')
    }, E2E_CONFIG.invokeTimeout)

    it('handles function with deleted version', async () => {
      // This tests that if a version's code was somehow corrupted/deleted,
      // the rollback should fail gracefully
      // Note: This may require special setup or mocking in real tests
      // For now, we just verify the API handles missing versions properly
      await expect(
        rollbackFunction(errorTestFunctionId, '0.0.0-never-existed')
      ).rejects.toThrow(/not found|does not exist/i)
    }, E2E_CONFIG.invokeTimeout)
  })

  // ===========================================================================
  // 5. ROLLBACK SCENARIOS
  // ===========================================================================

  describe('5. Rollback Scenarios', () => {
    it('rollback after deploying a broken version', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy working v1.0.0
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0', 'working'),
        language: 'typescript',
        version: '1.0.0',
      })

      // Verify it works
      let result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('1.0.0')

      // Deploy v2.0.0 that throws an error
      await deployAndUploadFunction({
        id: functionId,
        code: `
          export default {
            async fetch(request: Request): Promise<Response> {
              throw new Error('Intentional error in v2.0.0')
            }
          }
        `,
        language: 'typescript',
        version: '2.0.0',
      })

      // v2.0.0 invocation should fail
      await expect(invokeFunction(functionId)).rejects.toThrow()

      // Rollback to v1.0.0
      await rollbackFunction(functionId, '1.0.0')

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Now it should work again
      result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('1.0.0')
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout * 3 + 2000)

    it('multiple rollbacks in sequence', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy v1, v2, v3
      for (const version of ['1.0.0', '2.0.0', '3.0.0']) {
        await deployAndUploadFunction({
          id: functionId,
          code: createVersionedCode(version, `data-${version}`),
          language: 'typescript',
          version,
        })
      }

      // Current: v3.0.0
      let result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('3.0.0')

      // Rollback to v2.0.0
      await rollbackFunction(functionId, '2.0.0')
      await new Promise((resolve) => setTimeout(resolve, 500))
      result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('2.0.0')

      // Rollback to v1.0.0
      await rollbackFunction(functionId, '1.0.0')
      await new Promise((resolve) => setTimeout(resolve, 500))
      result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('1.0.0')

      // Rollback back to v3.0.0
      await rollbackFunction(functionId, '3.0.0')
      await new Promise((resolve) => setTimeout(resolve, 500))
      result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('3.0.0')
    }, E2E_CONFIG.deployTimeout * 3 + E2E_CONFIG.invokeTimeout * 4 + 5000)

    it('deploy new version after rollback', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy v1.0.0 and v2.0.0
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0', 'v1'),
        language: 'typescript',
        version: '1.0.0',
      })
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('2.0.0', 'v2'),
        language: 'typescript',
        version: '2.0.0',
      })

      // Rollback to v1.0.0
      await rollbackFunction(functionId, '1.0.0')

      // Deploy v3.0.0 (new version after rollback)
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('3.0.0', 'v3-after-rollback'),
        language: 'typescript',
        version: '3.0.0',
      })

      // Current should be v3.0.0
      const result = await invokeFunction<{ version: string; data: string }>(functionId)
      expect(result.version).toBe('3.0.0')
      expect(result.data).toBe('v3-after-rollback')

      // All versions should still exist
      const info = await getFunctionInfo(functionId)
      expect(info.versions).toContain('1.0.0')
      expect(info.versions).toContain('2.0.0')
      expect(info.versions).toContain('3.0.0')
    }, E2E_CONFIG.deployTimeout * 3 + E2E_CONFIG.invokeTimeout * 2)

    it('rollback preserves function configuration', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy v1.0.0 with specific behavior
      await deployAndUploadFunction({
        id: functionId,
        code: `
          export default {
            async fetch(request: Request): Promise<Response> {
              const body = await request.json().catch(() => ({})) as { key?: string }
              return Response.json({
                version: '1.0.0',
                config: 'v1-config',
                receivedKey: body.key
              })
            }
          }
        `,
        language: 'typescript',
        version: '1.0.0',
      })

      // Deploy v2.0.0 with different behavior
      await deployAndUploadFunction({
        id: functionId,
        code: `
          export default {
            async fetch(request: Request): Promise<Response> {
              return Response.json({
                version: '2.0.0',
                config: 'v2-config'
              })
            }
          }
        `,
        language: 'typescript',
        version: '2.0.0',
      })

      // Rollback to v1.0.0
      await rollbackFunction(functionId, '1.0.0')
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // v1.0.0 behavior should be restored (including parsing body)
      const result = await invokeFunction<{
        version: string
        config: string
        receivedKey?: string
      }>(functionId, { key: 'test-value' })

      expect(result.version).toBe('1.0.0')
      expect(result.config).toBe('v1-config')
      expect(result.receivedKey).toBe('test-value')
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout + 2000)
  })

  // ===========================================================================
  // 6. CONCURRENT ROLLBACKS
  // ===========================================================================

  describe('6. Concurrent Rollbacks', () => {
    it('handles concurrent rollback requests', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy v1.0.0, v2.0.0, v3.0.0
      for (const version of ['1.0.0', '2.0.0', '3.0.0']) {
        await deployAndUploadFunction({
          id: functionId,
          code: createVersionedCode(version, `v${version}`),
          language: 'typescript',
          version,
        })
      }

      // Try to rollback to multiple versions concurrently
      // Only one should succeed, or they should be serialized
      const rollbackPromises = [
        rollbackFunction(functionId, '1.0.0').catch((e) => ({ error: e.message })),
        rollbackFunction(functionId, '2.0.0').catch((e) => ({ error: e.message })),
      ]

      const results = await Promise.all(rollbackPromises)

      // At least one should succeed
      const successfulRollbacks = results.filter((r) => !('error' in r))
      expect(successfulRollbacks.length).toBeGreaterThanOrEqual(1)

      // Function should be in a consistent state
      const info = await getFunctionInfo(functionId)
      expect(['1.0.0', '2.0.0']).toContain(info.version)
    }, E2E_CONFIG.deployTimeout * 3 + E2E_CONFIG.invokeTimeout * 2)

    it('rollback during active invocations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy slow v1.0.0
      await deployAndUploadFunction({
        id: functionId,
        code: `
          export default {
            async fetch(request: Request): Promise<Response> {
              await new Promise(r => setTimeout(r, 1000)) // 1 second delay
              return Response.json({ version: '1.0.0' })
            }
          }
        `,
        language: 'typescript',
        version: '1.0.0',
      })

      // Deploy fast v2.0.0
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('2.0.0', 'fast'),
        language: 'typescript',
        version: '2.0.0',
      })

      // Start invocations and rollback concurrently
      const invokePromise = invokeFunction<{ version: string }>(functionId)
      const rollbackPromise = rollbackFunction(functionId, '1.0.0')

      const [invokeResult, rollbackResult] = await Promise.all([
        invokePromise,
        rollbackPromise,
      ])

      // Both should complete without error
      expect(invokeResult.version).toBeDefined()
      expect(rollbackResult.version).toBe('1.0.0')
    }, E2E_CONFIG.deployTimeout * 2 + 5000)
  })

  // ===========================================================================
  // 7. ROLLBACK METADATA
  // ===========================================================================

  describe('7. Rollback Metadata', () => {
    it('rollback response includes all required fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0', 'v1'),
        language: 'typescript',
        version: '1.0.0',
      })
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('2.0.0', 'v2'),
        language: 'typescript',
        version: '2.0.0',
      })

      const result = await rollbackFunction(functionId, '1.0.0')

      // Check all required fields
      expect(result.id).toBe(functionId)
      expect(result.version).toBe('1.0.0')
      expect(result.rolledBackFrom).toBe('2.0.0')
      expect(result.rolledBackAt).toBeDefined()

      // Validate timestamp format
      const timestamp = new Date(result.rolledBackAt)
      expect(timestamp.getTime()).not.toBeNaN()
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout)

    it('function info is updated after rollback', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0', 'v1'),
        language: 'typescript',
        version: '1.0.0',
      })
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('2.0.0', 'v2'),
        language: 'typescript',
        version: '2.0.0',
      })

      const infoBefore = await getFunctionInfo(functionId)
      expect(infoBefore.version).toBe('2.0.0')

      await rollbackFunction(functionId, '1.0.0')

      const infoAfter = await getFunctionInfo(functionId)
      expect(infoAfter.version).toBe('1.0.0')
      // updatedAt should change
      expect(infoAfter.updatedAt).not.toBe(infoBefore.updatedAt)
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout * 2)
  })

  // ===========================================================================
  // 8. EDGE CASES
  // ===========================================================================

  describe('8. Edge Cases', () => {
    it('handles function with only one version', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0', 'only'),
        language: 'typescript',
        version: '1.0.0',
      })

      // Rollback to the only version (should succeed or be a no-op)
      const result = await rollbackFunction(functionId, '1.0.0')
      expect(result.version).toBe('1.0.0')

      // Verify function still works
      const invokeResult = await invokeFunction<{ version: string }>(functionId)
      expect(invokeResult.version).toBe('1.0.0')
    }, E2E_CONFIG.deployTimeout + E2E_CONFIG.invokeTimeout * 2)

    it('handles semver pre-release versions', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0-alpha.1', 'alpha'),
        language: 'typescript',
        version: '1.0.0-alpha.1',
      })
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0-beta.1', 'beta'),
        language: 'typescript',
        version: '1.0.0-beta.1',
      })
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0', 'stable'),
        language: 'typescript',
        version: '1.0.0',
      })

      // Rollback to pre-release
      await rollbackFunction(functionId, '1.0.0-alpha.1')

      const result = await invokeFunction<{ version: string; data: string }>(functionId)
      expect(result.version).toBe('1.0.0-alpha.1')
      expect(result.data).toBe('alpha')
    }, E2E_CONFIG.deployTimeout * 3 + E2E_CONFIG.invokeTimeout)

    it('handles versions with build metadata', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0+build.123', 'build-123'),
        language: 'typescript',
        version: '1.0.0+build.123',
      })
      await deployAndUploadFunction({
        id: functionId,
        code: createVersionedCode('1.0.0+build.456', 'build-456'),
        language: 'typescript',
        version: '1.0.0+build.456',
      })

      // Rollback to earlier build
      await rollbackFunction(functionId, '1.0.0+build.123')

      const result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('1.0.0+build.123')
    }, E2E_CONFIG.deployTimeout * 2 + E2E_CONFIG.invokeTimeout)

    it('handles many versions (stress test)', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      // Deploy 10 versions
      for (let i = 1; i <= 10; i++) {
        await deployAndUploadFunction({
          id: functionId,
          code: createVersionedCode(`1.0.${i}`, `data-${i}`),
          language: 'typescript',
          version: `1.0.${i}`,
        })
      }

      // Rollback to an early version
      await rollbackFunction(functionId, '1.0.3')

      const result = await invokeFunction<{ version: string }>(functionId)
      expect(result.version).toBe('1.0.3')

      // All versions should still be available
      const info = await getFunctionInfo(functionId)
      expect(info.versions.length).toBeGreaterThanOrEqual(10)
    }, E2E_CONFIG.deployTimeout * 10 + E2E_CONFIG.invokeTimeout * 2)

    it('rollback preserves other functions', async () => {
      const functionId1 = generateTestFunctionId()
      const functionId2 = generateTestFunctionId()
      deployedFunctions.push(functionId1, functionId2)

      // Deploy both functions
      await deployAndUploadFunction({
        id: functionId1,
        code: createVersionedCode('1.0.0', 'func1-v1'),
        language: 'typescript',
        version: '1.0.0',
      })
      await deployAndUploadFunction({
        id: functionId1,
        code: createVersionedCode('2.0.0', 'func1-v2'),
        language: 'typescript',
        version: '2.0.0',
      })
      await deployAndUploadFunction({
        id: functionId2,
        code: createVersionedCode('1.0.0', 'func2'),
        language: 'typescript',
        version: '1.0.0',
      })

      // Rollback function1
      await rollbackFunction(functionId1, '1.0.0')

      // Function2 should be unaffected
      const result2 = await invokeFunction<{ version: string; data: string }>(functionId2)
      expect(result2.version).toBe('1.0.0')
      expect(result2.data).toBe('func2')

      // Function1 should be rolled back
      const result1 = await invokeFunction<{ version: string; data: string }>(functionId1)
      expect(result1.version).toBe('1.0.0')
      expect(result1.data).toBe('func1-v1')
    }, E2E_CONFIG.deployTimeout * 3 + E2E_CONFIG.invokeTimeout * 2)
  })
})
