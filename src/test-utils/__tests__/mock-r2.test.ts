import { describe, it, expect, beforeEach } from 'vitest'
import { createMockR2, createMockR2WithData } from '../mock-r2'

describe('createMockR2', () => {
  let bucket: R2Bucket

  beforeEach(() => {
    bucket = createMockR2()
  })

  describe('put() and get()', () => {
    it('should store and retrieve string values', async () => {
      await bucket.put('test-key', 'test-value')

      const object = await bucket.get('test-key')
      expect(object).not.toBeNull()
      expect(await object!.text()).toBe('test-value')
    })

    it('should store and retrieve ArrayBuffer values', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      await bucket.put('binary-key', data.buffer)

      const object = await bucket.get('binary-key')
      expect(object).not.toBeNull()
      expect(new Uint8Array(await object!.arrayBuffer())).toEqual(data)
    })

    it('should store and retrieve Uint8Array values', async () => {
      const data = new Uint8Array([10, 20, 30])
      await bucket.put('uint8-key', data)

      const object = await bucket.get('uint8-key')
      expect(object).not.toBeNull()
      expect(new Uint8Array(await object!.arrayBuffer())).toEqual(data)
    })

    it('should store and retrieve Blob values', async () => {
      const blob = new Blob(['blob content'], { type: 'text/plain' })
      await bucket.put('blob-key', blob)

      const object = await bucket.get('blob-key')
      expect(object).not.toBeNull()
      expect(await object!.text()).toBe('blob content')
    })

    it('should return null for non-existent keys', async () => {
      const object = await bucket.get('non-existent')
      expect(object).toBeNull()
    })

    it('should overwrite existing values', async () => {
      await bucket.put('key', 'value1')
      await bucket.put('key', 'value2')

      const object = await bucket.get('key')
      expect(await object!.text()).toBe('value2')
    })

    it('should store custom metadata', async () => {
      await bucket.put('meta-key', 'value', {
        customMetadata: { foo: 'bar', num: '123' },
      })

      const object = await bucket.head('meta-key')
      expect(object).not.toBeNull()
      expect(object!.customMetadata).toEqual({ foo: 'bar', num: '123' })
    })
  })

  describe('head()', () => {
    it('should return object metadata without body', async () => {
      await bucket.put('head-key', 'some content')

      const object = await bucket.head('head-key')
      expect(object).not.toBeNull()
      expect(object!.key).toBe('head-key')
      expect(object!.size).toBe(12) // 'some content'.length
    })

    it('should return null for non-existent keys', async () => {
      const object = await bucket.head('non-existent')
      expect(object).toBeNull()
    })
  })

  describe('delete()', () => {
    it('should delete a single key', async () => {
      await bucket.put('delete-key', 'value')
      await bucket.delete('delete-key')

      const object = await bucket.get('delete-key')
      expect(object).toBeNull()
    })

    it('should delete multiple keys', async () => {
      await bucket.put('key1', 'value1')
      await bucket.put('key2', 'value2')
      await bucket.put('key3', 'value3')

      await bucket.delete(['key1', 'key2'])

      expect(await bucket.get('key1')).toBeNull()
      expect(await bucket.get('key2')).toBeNull()
      expect(await bucket.get('key3')).not.toBeNull()
    })

    it('should handle deleting non-existent keys gracefully', async () => {
      await expect(bucket.delete('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('list()', () => {
    it('should list all objects', async () => {
      await bucket.put('a', '1')
      await bucket.put('b', '2')
      await bucket.put('c', '3')

      const result = await bucket.list()

      expect(result.objects).toHaveLength(3)
      expect(result.objects.map((o) => o.key).sort()).toEqual(['a', 'b', 'c'])
    })

    it('should filter by prefix', async () => {
      await bucket.put('prefix/a', '1')
      await bucket.put('prefix/b', '2')
      await bucket.put('other/c', '3')

      const result = await bucket.list({ prefix: 'prefix/' })

      expect(result.objects).toHaveLength(2)
      expect(result.objects.map((o) => o.key).sort()).toEqual(['prefix/a', 'prefix/b'])
    })

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await bucket.put(`key-${i}`, `value-${i}`)
      }

      const result = await bucket.list({ limit: 5 })

      expect(result.objects).toHaveLength(5)
      expect(result.truncated).toBe(true)
    })

    it('should support pagination with cursor', async () => {
      for (let i = 0; i < 10; i++) {
        await bucket.put(`key-${String(i).padStart(2, '0')}`, `value-${i}`)
      }

      const page1 = await bucket.list({ limit: 5 })
      expect(page1.objects).toHaveLength(5)
      expect(page1.truncated).toBe(true)

      const page2 = await bucket.list({ limit: 5, cursor: page1.cursor })
      expect(page2.objects).toHaveLength(5)
      expect(page2.truncated).toBe(false)

      // Verify no duplicates
      const allKeys = [
        ...page1.objects.map((o) => o.key),
        ...page2.objects.map((o) => o.key),
      ]
      expect(new Set(allKeys).size).toBe(10)
    })

    it('should return empty list for non-matching prefix', async () => {
      await bucket.put('foo', 'bar')

      const result = await bucket.list({ prefix: 'baz/' })

      expect(result.objects).toHaveLength(0)
    })
  })

  describe('R2Object methods', () => {
    it('should support json() method', async () => {
      await bucket.put('json-key', JSON.stringify({ foo: 'bar', num: 42 }))

      const object = await bucket.get('json-key')
      const data = await object!.json<{ foo: string; num: number }>()

      expect(data).toEqual({ foo: 'bar', num: 42 })
    })

    it('should support blob() method', async () => {
      await bucket.put('blob-key', 'blob data')

      const object = await bucket.get('blob-key')
      const blob = await object!.blob()

      expect(blob).toBeInstanceOf(Blob)
      expect(await blob.text()).toBe('blob data')
    })

    it('should support body stream', async () => {
      await bucket.put('stream-key', 'stream data')

      const object = await bucket.get('stream-key')
      const reader = object!.body.getReader()

      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        if (result.value) chunks.push(result.value)
        done = result.done
      }

      const text = new TextDecoder().decode(
        new Uint8Array(chunks.reduce((acc, c) => [...acc, ...c], [] as number[]))
      )
      expect(text).toBe('stream data')
    })
  })
})

describe('createMockR2WithData', () => {
  it('should create bucket with pre-populated string data', async () => {
    const bucket = await createMockR2WithData({
      'key1': 'value1',
      'key2': 'value2',
    })

    expect(await (await bucket.get('key1'))!.text()).toBe('value1')
    expect(await (await bucket.get('key2'))!.text()).toBe('value2')
  })

  it('should create bucket with pre-populated binary data', async () => {
    const binaryData = new Uint8Array([1, 2, 3, 4]).buffer

    const bucket = await createMockR2WithData({
      'binary': binaryData,
    })

    const object = await bucket.get('binary')
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })
})
