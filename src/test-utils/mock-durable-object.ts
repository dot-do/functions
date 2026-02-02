/**
 * Mock Durable Object utilities for testing distributed rate limiting
 */

import { RateLimiterDO } from '../core/rate-limiter'

/**
 * Mock Durable Object storage for testing.
 * Implements the subset of DurableObjectStorage used by production code.
 */
export function createMockDurableObjectStorage(): DurableObjectStorage {
  const data = new Map<string, unknown>()
  let alarmTime: number | null = null

  return {
    get: async <T = unknown>(key: string): Promise<T | undefined> => {
      return data.get(key) as T | undefined
    },
    put: async <T>(key: string, value: T): Promise<void> => {
      data.set(key, value)
    },
    delete: async (key: string): Promise<boolean> => {
      return data.delete(key)
    },
    list: async (options?: { prefix?: string }): Promise<Map<string, unknown>> => {
      if (!options?.prefix) return new Map(data)
      const result = new Map<string, unknown>()
      for (const [key, value] of data) {
        if (key.startsWith(options.prefix)) {
          result.set(key, value)
        }
      }
      return result
    },
    deleteAll: async (): Promise<void> => {
      data.clear()
    },
    getAlarm: async (): Promise<number | null> => alarmTime,
    setAlarm: async (time: number | Date): Promise<void> => {
      alarmTime = time instanceof Date ? time.getTime() : time
    },
    deleteAlarm: async (): Promise<void> => {
      alarmTime = null
    },
    sync: async (): Promise<void> => {},
    transaction: async <T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> => {
      // Simplified transaction - just run the closure with storage as txn
      return closure({
        get: async (key: string) => data.get(key),
        put: async (key: string, value: unknown) => { data.set(key, value) },
        delete: async (key: string) => data.delete(key),
        deleteAll: async () => { data.clear() },
        list: async () => new Map(data),
        rollback: () => {},
      } as unknown as DurableObjectTransaction)
    },
  } as unknown as DurableObjectStorage
}

/**
 * Mock Durable Object state for testing.
 * Matches the real DurableObjectState interface including the `props` field.
 */
export function createMockDurableObjectState(): DurableObjectState {
  return {
    id: {
      toString: () => 'mock-do-id',
      name: 'mock-do-name',
      equals: () => true,
    } as DurableObjectId,
    props: undefined,
    storage: createMockDurableObjectStorage(),
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    waitUntil: () => {},
    acceptWebSocket: () => {},
    getWebSockets: () => [],
    setWebSocketAutoResponse: () => {},
    getWebSocketAutoResponse: () => null,
    getWebSocketAutoResponseTimestamp: () => null,
    setHibernatableWebSocketEventTimeout: () => {},
    getHibernatableWebSocketEventTimeout: () => null,
    getTags: () => [],
    abort: () => {},
  } as unknown as DurableObjectState
}

/**
 * Create a mock Durable Object namespace that routes to actual RateLimiterDO instances
 */
export function createMockRateLimiterNamespace(): DurableObjectNamespace {
  const instances = new Map<string, RateLimiterDO>()

  return {
    idFromName(name: string): DurableObjectId {
      return {
        toString: () => name,
        name,
        equals: (other: DurableObjectId) => other.toString() === name,
      } as DurableObjectId
    },

    idFromString(id: string): DurableObjectId {
      return {
        toString: () => id,
        name: id,
        equals: (other: DurableObjectId) => other.toString() === id,
      } as DurableObjectId
    },

    newUniqueId(): DurableObjectId {
      const id = `unique-${Date.now()}-${Math.random()}`
      return {
        toString: () => id,
        name: id,
        equals: (other: DurableObjectId) => other.toString() === id,
      } as DurableObjectId
    },

    get(id: DurableObjectId): DurableObjectStub {
      const idString = id.toString()

      // Get or create the DO instance
      if (!instances.has(idString)) {
        const state = createMockDurableObjectState()
        instances.set(idString, new RateLimiterDO(state))
      }

      const instance = instances.get(idString)!

      return {
        id,
        name: id.name,
        fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const request = input instanceof Request ? input : new Request(input, init)
          return instance.fetch(request)
        },
        connect: () => {
          throw new Error('WebSocket not supported in mock')
        },
        queue: async () => {},
        scheduled: async () => {},
        alarm: async () => {},
      } as unknown as DurableObjectStub
    },

    jurisdiction(jurisdiction: DurableObjectJurisdiction): DurableObjectNamespace {
      return this
    },
  } as unknown as DurableObjectNamespace
}

/**
 * Helper to reset all mock DO instances between tests
 */
export function createResettableMockNamespace(): {
  namespace: DurableObjectNamespace
  reset: () => void
} {
  let namespace = createMockRateLimiterNamespace()

  return {
    get namespace() {
      return namespace
    },
    reset() {
      namespace = createMockRateLimiterNamespace()
    },
  }
}
