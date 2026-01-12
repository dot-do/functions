import { describe, it, expect, beforeEach } from 'vitest'
import { createMockKV } from '../mock-kv'

describe('createMockKV', () => {
  let kv: KVNamespace

  beforeEach(() => {
    kv = createMockKV()
  })

  describe('empty namespace', () => {
    it('should return null for get on empty namespace', async () => {
      const result = await kv.get('any-key')
      expect(result).toBeNull()
    })

    it('should return null for getWithMetadata on empty namespace', async () => {
      const result = await kv.getWithMetadata('any-key')
      expect(result.value).toBeNull()
      expect(result.metadata).toBeNull()
    })

    it('should return empty keys array for list on empty namespace', async () => {
      const result = await kv.list()
      expect(result.keys).toEqual([])
      expect(result.list_complete).toBe(true)
    })

    it('should handle delete on empty namespace without error', async () => {
      await expect(kv.delete('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('non-existent keys', () => {
    beforeEach(async () => {
      await kv.put('existing-key', 'existing-value')
    })

    it('should return null for non-existent key with get', async () => {
      const result = await kv.get('non-existent')
      expect(result).toBeNull()
    })

    it('should return null value for non-existent key with getWithMetadata', async () => {
      const result = await kv.getWithMetadata('non-existent')
      expect(result.value).toBeNull()
      expect(result.metadata).toBeNull()
    })

    it('should handle delete of non-existent key without error', async () => {
      await expect(kv.delete('non-existent')).resolves.toBeUndefined()
      // Verify existing key was not affected
      const existing = await kv.get('existing-key')
      expect(existing).toBe('existing-value')
    })
  })

  describe('get()', () => {
    it('should return stored string value', async () => {
      await kv.put('key', 'hello world')
      const result = await kv.get('key')
      expect(result).toBe('hello world')
    })

    it('should return text when type is "text"', async () => {
      await kv.put('key', 'hello world')
      const result = await kv.get('key', 'text')
      expect(result).toBe('hello world')
    })

    it('should return parsed JSON when type is "json"', async () => {
      const data = { foo: 'bar', num: 42 }
      await kv.put('key', JSON.stringify(data))
      const result = await kv.get('key', 'json')
      expect(result).toEqual(data)
    })

    it('should return ArrayBuffer when type is "arrayBuffer"', async () => {
      await kv.put('key', 'hello')
      const result = await kv.get('key', 'arrayBuffer')
      expect(result).toBeInstanceOf(ArrayBuffer)
      const decoded = new TextDecoder().decode(result as ArrayBuffer)
      expect(decoded).toBe('hello')
    })

    it('should return ReadableStream when type is "stream"', async () => {
      await kv.put('key', 'stream content')
      const result = await kv.get('key', 'stream')
      expect(result).toBeInstanceOf(ReadableStream)

      const reader = (result as ReadableStream).getReader()
      const { value, done } = await reader.read()
      expect(done).toBe(false)
      expect(new TextDecoder().decode(value)).toBe('stream content')
    })

    it('should accept options object with type property', async () => {
      await kv.put('key', JSON.stringify({ test: true }))
      const result = await kv.get('key', { type: 'json' })
      expect(result).toEqual({ test: true })
    })
  })

  describe('put()', () => {
    it('should store string value', async () => {
      await kv.put('key', 'value')
      expect(await kv.get('key')).toBe('value')
    })

    it('should store ArrayBuffer value', async () => {
      const buffer = new TextEncoder().encode('buffer content').buffer as ArrayBuffer
      await kv.put('key', buffer)
      expect(await kv.get('key')).toBe('buffer content')
    })

    it('should store ReadableStream value', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('streamed'))
          controller.close()
        },
      })
      await kv.put('key', stream)
      expect(await kv.get('key')).toBe('streamed')
    })

    it('should overwrite existing value', async () => {
      await kv.put('key', 'original')
      await kv.put('key', 'updated')
      expect(await kv.get('key')).toBe('updated')
    })
  })

  describe('delete()', () => {
    it('should delete existing key', async () => {
      await kv.put('key', 'value')
      await kv.delete('key')
      expect(await kv.get('key')).toBeNull()
    })

    it('should not affect other keys when deleting', async () => {
      await kv.put('key1', 'value1')
      await kv.put('key2', 'value2')
      await kv.delete('key1')
      expect(await kv.get('key1')).toBeNull()
      expect(await kv.get('key2')).toBe('value2')
    })
  })

  describe('metadata handling', () => {
    it('should store and retrieve metadata with put', async () => {
      const metadata = { version: 1, author: 'test' }
      await kv.put('key', 'value', { metadata })

      const result = await kv.getWithMetadata('key')
      expect(result.value).toBe('value')
      expect(result.metadata).toEqual(metadata)
    })

    it('should return null metadata when not provided', async () => {
      await kv.put('key', 'value')

      const result = await kv.getWithMetadata('key')
      expect(result.value).toBe('value')
      expect(result.metadata).toBeNull()
    })

    it('should include metadata in list results', async () => {
      const metadata = { type: 'config' }
      await kv.put('key', 'value', { metadata })

      const result = await kv.list()
      expect(result.keys).toHaveLength(1)
      expect(result.keys[0]!.metadata).toEqual(metadata)
    })

    it('should update metadata when overwriting key', async () => {
      await kv.put('key', 'value1', { metadata: { version: 1 } })
      await kv.put('key', 'value2', { metadata: { version: 2 } })

      const result = await kv.getWithMetadata('key')
      expect(result.value).toBe('value2')
      expect(result.metadata).toEqual({ version: 2 })
    })

    it('should clear metadata when overwriting without metadata', async () => {
      await kv.put('key', 'value1', { metadata: { version: 1 } })
      await kv.put('key', 'value2')

      const result = await kv.getWithMetadata('key')
      expect(result.value).toBe('value2')
      expect(result.metadata).toBeNull()
    })
  })

  describe('getWithMetadata()', () => {
    it('should return value and metadata together', async () => {
      const metadata = { createdAt: '2024-01-01' }
      await kv.put('key', 'content', { metadata })

      const result = await kv.getWithMetadata('key')
      expect(result.value).toBe('content')
      expect(result.metadata).toEqual(metadata)
      expect(result.cacheStatus).toBeNull()
    })

    it('should support type option for value parsing', async () => {
      const data = { foo: 'bar' }
      await kv.put('key', JSON.stringify(data), { metadata: { type: 'json' } })

      const result = await kv.getWithMetadata('key', 'json')
      expect(result.value).toEqual(data)
      expect(result.metadata).toEqual({ type: 'json' })
    })

    it('should return null for both value and metadata for non-existent key', async () => {
      const result = await kv.getWithMetadata('non-existent')
      expect(result.value).toBeNull()
      expect(result.metadata).toBeNull()
    })
  })

  describe('list()', () => {
    it('should list all keys', async () => {
      await kv.put('a', 'value-a')
      await kv.put('b', 'value-b')
      await kv.put('c', 'value-c')

      const result = await kv.list()
      expect(result.keys).toHaveLength(3)
      expect(result.keys.map((k) => k.name)).toEqual(['a', 'b', 'c'])
      expect(result.list_complete).toBe(true)
    })

    it('should filter by prefix', async () => {
      await kv.put('user:1', 'alice')
      await kv.put('user:2', 'bob')
      await kv.put('config:theme', 'dark')

      const result = await kv.list({ prefix: 'user:' })
      expect(result.keys).toHaveLength(2)
      expect(result.keys.map((k) => k.name)).toEqual(['user:1', 'user:2'])
    })

    it('should return empty array when no keys match prefix', async () => {
      await kv.put('key1', 'value1')
      await kv.put('key2', 'value2')

      const result = await kv.list({ prefix: 'nonexistent:' })
      expect(result.keys).toEqual([])
      expect(result.list_complete).toBe(true)
    })

    it('should sort keys alphabetically', async () => {
      await kv.put('zebra', '1')
      await kv.put('apple', '2')
      await kv.put('mango', '3')

      const result = await kv.list()
      expect(result.keys.map((k) => k.name)).toEqual(['apple', 'mango', 'zebra'])
    })
  })

  describe('pagination with cursor', () => {
    beforeEach(async () => {
      // Add 5 keys for pagination testing
      for (let i = 1; i <= 5; i++) {
        await kv.put(`key${i}`, `value${i}`, { metadata: { index: i } })
      }
    })

    it('should limit results with limit option', async () => {
      const result = await kv.list({ limit: 2 })
      expect(result.keys).toHaveLength(2)
      expect(result.keys.map((k) => k.name)).toEqual(['key1', 'key2'])
      expect(result.list_complete).toBe(false)
      expect('cursor' in result && result.cursor).toBeDefined()
    })

    it('should continue from cursor position', async () => {
      const firstPage = await kv.list({ limit: 2 })
      expect(firstPage.list_complete).toBe(false)
      if (!firstPage.list_complete) {
        expect(firstPage.cursor).toBeDefined()

        const secondPage = await kv.list({ limit: 2, cursor: firstPage.cursor })
        expect(secondPage.keys).toHaveLength(2)
        expect(secondPage.keys.map((k) => k.name)).toEqual(['key3', 'key4'])
        expect(secondPage.list_complete).toBe(false)
      }
    })

    it('should return list_complete true on last page', async () => {
      const firstPage = await kv.list({ limit: 2 })
      if (!firstPage.list_complete) {
        const secondPage = await kv.list({ limit: 2, cursor: firstPage.cursor })
        if (!secondPage.list_complete) {
          const thirdPage = await kv.list({ limit: 2, cursor: secondPage.cursor })

          expect(thirdPage.keys).toHaveLength(1)
          expect(thirdPage.keys[0]!.name).toBe('key5')
          expect(thirdPage.list_complete).toBe(true)
          expect('cursor' in thirdPage).toBe(false)
        }
      }
    })

    it('should not have cursor property when list_complete is true', async () => {
      const result = await kv.list({ limit: 10 }) // More than total keys
      expect(result.list_complete).toBe(true)
      expect('cursor' in result).toBe(false)
    })

    it('should paginate all keys correctly', async () => {
      const allKeys: string[] = []
      let cursor: string | null = null

      do {
        const options: KVNamespaceListOptions = { limit: 2 }
        if (cursor !== null) {
          options.cursor = cursor
        }
        const result = await kv.list(options)
        allKeys.push(...result.keys.map((k) => k.name))
        cursor = result.list_complete ? null : result.cursor
      } while (cursor !== null)

      expect(allKeys).toEqual(['key1', 'key2', 'key3', 'key4', 'key5'])
    })

    it('should preserve metadata in paginated results', async () => {
      const result = await kv.list({ limit: 2 })
      expect(result.keys[0]!.metadata).toEqual({ index: 1 })
      expect(result.keys[1]!.metadata).toEqual({ index: 2 })
    })
  })

  describe('expiration handling', () => {
    it('should store expiration from put options', async () => {
      const futureExpiration = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      await kv.put('key', 'value', { expiration: futureExpiration })

      const result = await kv.list()
      expect(result.keys[0]!.expiration).toBe(futureExpiration)
    })

    it('should store expiration calculated from expirationTtl', async () => {
      const beforePut = Math.floor(Date.now() / 1000)
      await kv.put('key', 'value', { expirationTtl: 3600 }) // 1 hour TTL
      const afterPut = Math.floor(Date.now() / 1000)

      const result = await kv.list()
      const expiration = result.keys[0]!.expiration
      expect(expiration).toBeGreaterThanOrEqual(beforePut + 3600)
      expect(expiration).toBeLessThanOrEqual(afterPut + 3600)
    })

    it('should include expiration in list results', async () => {
      const expiration = Math.floor(Date.now() / 1000) + 7200
      await kv.put('key', 'value', { expiration })

      const result = await kv.list()
      expect(result.keys[0]!.expiration).toBe(expiration)
    })
  })

  describe('cacheStatus field', () => {
    it('should return null for cacheStatus in getWithMetadata', async () => {
      await kv.put('key', 'value')
      const result = await kv.getWithMetadata('key')
      expect(result.cacheStatus).toBeNull()
    })

    it('should return null for cacheStatus in list', async () => {
      await kv.put('key', 'value')
      const result = await kv.list()
      expect(result.cacheStatus).toBeNull()
    })
  })
})
