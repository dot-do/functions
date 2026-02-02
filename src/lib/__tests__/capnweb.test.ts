/**
 * capnweb Library Tests
 *
 * Tests for the Cap'n Proto-style RPC for Web library.
 * Covers:
 * - RpcTarget base class instantiation
 * - Disposable interface (Symbol.dispose)
 * - Subclass extension with custom methods
 * - Symbol.dispose polyfill behavior
 * - PropertyPath type alias
 *
 * @module lib/__tests__/capnweb.test
 */

import { describe, it, expect, vi } from 'vitest'
import { RpcTarget, type PropertyPath } from '../capnweb'

// =============================================================================
// RpcTarget BASE CLASS
// =============================================================================

describe('RpcTarget', () => {
  describe('instantiation', () => {
    it('should create an instance of RpcTarget', () => {
      const target = new RpcTarget()
      expect(target).toBeInstanceOf(RpcTarget)
    })

    it('should be a plain object with no enumerable own properties by default', () => {
      const target = new RpcTarget()
      expect(Object.keys(target)).toEqual([])
    })
  })

  describe('Disposable interface', () => {
    it('should implement Symbol.dispose', () => {
      const target = new RpcTarget()
      expect(typeof target[Symbol.dispose]).toBe('function')
    })

    it('should not throw when dispose is called', () => {
      const target = new RpcTarget()
      expect(() => target[Symbol.dispose]()).not.toThrow()
    })

    it('should be callable multiple times without error', () => {
      const target = new RpcTarget()
      target[Symbol.dispose]()
      target[Symbol.dispose]()
      target[Symbol.dispose]()
      // Should not throw
    })
  })

  describe('subclass extension', () => {
    it('should support subclassing with custom methods', () => {
      class MyService extends RpcTarget {
        greet(name: string): string {
          return `Hello, ${name}!`
        }
      }

      const service = new MyService()
      expect(service).toBeInstanceOf(RpcTarget)
      expect(service).toBeInstanceOf(MyService)
      expect(service.greet('World')).toBe('Hello, World!')
    })

    it('should support async methods in subclasses', async () => {
      class AsyncService extends RpcTarget {
        async fetchData(id: string): Promise<{ id: string; value: number }> {
          return { id, value: 42 }
        }
      }

      const service = new AsyncService()
      const result = await service.fetchData('test-123')
      expect(result).toEqual({ id: 'test-123', value: 42 })
    })

    it('should allow subclasses to override dispose', () => {
      const disposeFn = vi.fn()

      class CleanupService extends RpcTarget {
        [Symbol.dispose](): void {
          disposeFn()
        }
      }

      const service = new CleanupService()
      service[Symbol.dispose]()

      expect(disposeFn).toHaveBeenCalledTimes(1)
    })

    it('should support subclasses with state', () => {
      class StatefulService extends RpcTarget {
        private connections: Set<string> = new Set()

        connect(id: string): void {
          this.connections.add(id)
        }

        disconnect(id: string): void {
          this.connections.delete(id)
        }

        getConnectionCount(): number {
          return this.connections.size
        }

        [Symbol.dispose](): void {
          this.connections.clear()
        }
      }

      const service = new StatefulService()
      service.connect('conn-1')
      service.connect('conn-2')
      expect(service.getConnectionCount()).toBe(2)

      service[Symbol.dispose]()
      expect(service.getConnectionCount()).toBe(0)
    })

    it('should support multi-level inheritance', () => {
      class BaseService extends RpcTarget {
        getType(): string {
          return 'base'
        }
      }

      class ExtendedService extends BaseService {
        getType(): string {
          return 'extended'
        }

        getVersion(): number {
          return 2
        }
      }

      const service = new ExtendedService()
      expect(service).toBeInstanceOf(RpcTarget)
      expect(service).toBeInstanceOf(BaseService)
      expect(service).toBeInstanceOf(ExtendedService)
      expect(service.getType()).toBe('extended')
      expect(service.getVersion()).toBe(2)
    })
  })
})

// =============================================================================
// Symbol.dispose POLYFILL
// =============================================================================

describe('Symbol.dispose polyfill', () => {
  it('should ensure Symbol.dispose is defined', () => {
    expect(Symbol.dispose).toBeDefined()
    expect(typeof Symbol.dispose).toBe('symbol')
  })

  it('should allow using Symbol.dispose as a method key', () => {
    const obj = {
      [Symbol.dispose]() {
        return 'disposed'
      },
    }

    expect(obj[Symbol.dispose]()).toBe('disposed')
  })
})

// =============================================================================
// PropertyPath TYPE
// =============================================================================

describe('PropertyPath type', () => {
  it('should accept an array of strings', () => {
    const path: PropertyPath = ['foo', 'bar', 'baz']
    expect(path).toEqual(['foo', 'bar', 'baz'])
  })

  it('should accept an array of numbers', () => {
    const path: PropertyPath = [0, 1, 2]
    expect(path).toEqual([0, 1, 2])
  })

  it('should accept a mixed array of strings and numbers', () => {
    const path: PropertyPath = ['users', 0, 'name']
    expect(path).toEqual(['users', 0, 'name'])
  })

  it('should accept an empty array', () => {
    const path: PropertyPath = []
    expect(path).toEqual([])
  })
})
