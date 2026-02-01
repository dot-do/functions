/**
 * Mock Durable Object utilities for testing distributed rate limiting
 */

import { RateLimiterDO } from '../core/rate-limiter'

/**
 * Mock Durable Object state for testing
 */
export function createMockDurableObjectState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'mock-do-id',
      name: 'mock-do-name',
      equals: () => true,
    } as DurableObjectId,
    storage: {
      get: async <T = unknown>(key: string): Promise<T | undefined> => {
        return storage.get(key) as T | undefined
      },
      put: async <T>(key: string, value: T): Promise<void> => {
        storage.set(key, value)
      },
      delete: async (key: string): Promise<boolean> => {
        return storage.delete(key)
      },
      list: async (): Promise<Map<string, unknown>> => {
        return new Map(storage)
      },
      deleteAll: async (): Promise<void> => {
        storage.clear()
      },
      getAlarm: async (): Promise<number | null> => null,
      setAlarm: async (): Promise<void> => {},
      deleteAlarm: async (): Promise<void> => {},
      sync: async (): Promise<void> => {},
    } as unknown as DurableObjectStorage,
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
