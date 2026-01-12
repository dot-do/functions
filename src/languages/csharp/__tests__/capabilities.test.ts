/**
 * Capability Discovery and Composition Tests (RED)
 *
 * These tests validate the capability broker pattern and automatic
 * capability discovery from C# code. Key features tested:
 * 1. Static analysis to detect required capabilities
 * 2. Capability broker for providing runtime services
 * 3. Capability composition for custom runtime profiles
 * 4. Profile-based capability configuration
 *
 * These tests are written in the RED phase of TDD - they SHOULD FAIL
 * because the implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  detectCapabilities,
  createCapabilityBroker,
  createCapabilityComposer,
  getProfileAssemblies,
  getProfileNamespaces,
  getProfileMemoryFootprint,
  validateCapabilities,
  BUILTIN_CAPABILITIES,
  CAPABILITY_PROFILES,
  type Capability,
  type CapabilityBroker,
  type CapabilityDetectionResult,
  type CapabilityComposer,
  type CapabilityInstance,
} from '../capabilities'

describe('Built-in Capabilities', () => {
  describe('BUILTIN_CAPABILITIES', () => {
    it('includes core capability', () => {
      expect(BUILTIN_CAPABILITIES.core).toBeDefined()
      expect(BUILTIN_CAPABILITIES.core.id).toBe('core')
      expect(BUILTIN_CAPABILITIES.core.dependencies).toHaveLength(0)
    })

    it('includes collections capability', () => {
      expect(BUILTIN_CAPABILITIES.collections).toBeDefined()
      expect(BUILTIN_CAPABILITIES.collections.dependencies).toContain('core')
    })

    it('includes linq capability', () => {
      expect(BUILTIN_CAPABILITIES.linq).toBeDefined()
      expect(BUILTIN_CAPABILITIES.linq.dependencies).toContain('collections')
    })

    it('includes json capability', () => {
      expect(BUILTIN_CAPABILITIES.json).toBeDefined()
      expect(BUILTIN_CAPABILITIES.json.namespaces).toContain('System.Text.Json')
    })

    it('includes async capability', () => {
      expect(BUILTIN_CAPABILITIES.async).toBeDefined()
      expect(BUILTIN_CAPABILITIES.async.namespaces).toContain('System.Threading.Tasks')
    })

    it('marks http as privileged', () => {
      expect(BUILTIN_CAPABILITIES.http.privileged).toBe(true)
    })

    it('marks reflection as privileged', () => {
      expect(BUILTIN_CAPABILITIES.reflection.privileged).toBe(true)
    })

    it('has memory footprint estimates', () => {
      for (const cap of Object.values(BUILTIN_CAPABILITIES)) {
        expect(cap.memoryFootprint).toBeGreaterThan(0)
      }
    })

    it('has categories for all capabilities', () => {
      const validCategories = [
        'core',
        'collections',
        'io',
        'network',
        'serialization',
        'security',
        'logging',
        'database',
        'async',
        'reflection',
        'interop',
      ]
      for (const cap of Object.values(BUILTIN_CAPABILITIES)) {
        expect(validCategories).toContain(cap.category)
      }
    })
  })
})

describe('Capability Detection', () => {
  describe('detectCapabilities', () => {
    it('detects core capability', () => {
      const code = `Console.WriteLine("Hello");`
      const result = detectCapabilities(code)

      expect(result.required).toContain('core')
    })

    it('detects collections capability', () => {
      const code = `var list = new List<int> { 1, 2, 3 };`
      const result = detectCapabilities(code)

      expect(result.required).toContain('collections')
    })

    it('detects linq capability', () => {
      const code = `
        var numbers = new[] { 1, 2, 3, 4, 5 };
        var evens = numbers.Where(n => n % 2 == 0).ToList();
      `
      const result = detectCapabilities(code)

      expect(result.required).toContain('linq')
    })

    it('detects json capability', () => {
      const code = `var json = JsonSerializer.Serialize(obj);`
      const result = detectCapabilities(code)

      expect(result.required).toContain('json')
    })

    it('detects regex capability', () => {
      const code = `var match = Regex.Match(input, @"\d+");`
      const result = detectCapabilities(code)

      expect(result.required).toContain('regex')
    })

    it('detects async capability', () => {
      const code = `
        async Task<int> FetchAsync()
        {
            await Task.Delay(100);
            return 42;
        }
      `
      const result = detectCapabilities(code)

      expect(result.required).toContain('async')
    })

    it('detects http capability', () => {
      const code = `
        var client = new HttpClient();
        var response = await client.GetAsync(url);
      `
      const result = detectCapabilities(code)

      expect(result.unavailable).toContain('http') // privileged
    })

    it('detects logging capability', () => {
      const code = `logger.LogInformation("Message");`
      const result = detectCapabilities(code)

      expect(result.required).toContain('logging')
    })

    it('detects crypto capability', () => {
      const code = `var hash = SHA256.HashData(data);`
      const result = detectCapabilities(code)

      expect(result.unavailable).toContain('crypto') // privileged
    })

    it('detects reflection capability', () => {
      const code = `var method = typeof(MyClass).GetMethod("DoSomething");`
      const result = detectCapabilities(code)

      expect(result.unavailable).toContain('reflection') // privileged
    })

    it('resolves dependencies automatically', () => {
      const code = `var evens = numbers.Where(n => n % 2 == 0);`
      const result = detectCapabilities(code)

      // LINQ depends on collections which depends on core
      expect(result.required).toContain('linq')
      expect(result.required).toContain('collections')
      expect(result.required).toContain('core')
    })

    it('provides detection details', () => {
      const code = `var sum = numbers.Sum();`
      const result = detectCapabilities(code)

      expect(result.details.length).toBeGreaterThan(0)
      const linqDetail = result.details.find((d) => d.capabilityId === 'linq')
      expect(linqDetail).toBeDefined()
      expect(linqDetail?.locations.length).toBeGreaterThan(0)
    })

    it('provides confidence score', () => {
      const code = `return 1 + 2;`
      const result = detectCapabilities(code)

      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it('reports analysis time', () => {
      const code = `var x = 42;`
      const result = detectCapabilities(code)

      expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('handles complex code', () => {
      const code = `
        using System;
        using System.Collections.Generic;
        using System.Linq;
        using System.Text.Json;

        public class DataProcessor
        {
            public async Task<string> ProcessAsync(IEnumerable<int> data)
            {
                var filtered = data
                    .Where(x => x > 0)
                    .OrderBy(x => x)
                    .ToList();

                var result = new { Values = filtered, Count = filtered.Count };
                return JsonSerializer.Serialize(result);
            }
        }
      `
      const result = detectCapabilities(code)

      expect(result.required).toContain('core')
      expect(result.required).toContain('collections')
      expect(result.required).toContain('linq')
      expect(result.required).toContain('json')
      expect(result.required).toContain('async')
    })

    it('handles LINQ query syntax', () => {
      const code = `
        var query = from x in numbers
                    where x > 5
                    select x * 2;
      `
      const result = detectCapabilities(code)

      expect(result.required).toContain('linq')
    })
  })
})

describe('Capability Broker', () => {
  let broker: CapabilityBroker

  beforeEach(() => {
    broker = createCapabilityBroker()
  })

  describe('register', () => {
    it('registers a capability', () => {
      const cap: Capability = {
        id: 'custom',
        name: 'Custom',
        description: 'Custom capability',
        assemblies: ['Custom.dll'],
        namespaces: ['Custom'],
        providedTypes: ['CustomClass'],
        providedMethods: ['CustomMethod'],
        dependencies: [],
        privileged: false,
        category: 'core',
        memoryFootprint: 1000,
      }

      broker.register(cap)
      expect(broker.get('custom')).toBeDefined()
    })
  })

  describe('get', () => {
    it('returns registered capability', () => {
      const cap = broker.get('core')
      expect(cap).toBeUndefined() // Not registered yet in empty broker
    })

    it('returns undefined for unknown', () => {
      expect(broker.get('unknown')).toBeUndefined()
    })
  })

  describe('list', () => {
    it('returns all registered capabilities', () => {
      const list = broker.list()
      expect(Array.isArray(list)).toBe(true)
    })
  })

  describe('listByCategory', () => {
    it('filters by category', () => {
      // Register some capabilities
      broker.register(BUILTIN_CAPABILITIES.core)
      broker.register(BUILTIN_CAPABILITIES.collections)
      broker.register(BUILTIN_CAPABILITIES.linq)
      broker.register(BUILTIN_CAPABILITIES.json)

      const serialization = broker.listByCategory('serialization')
      expect(serialization.some((c) => c.id === 'json')).toBe(true)
    })
  })

  describe('request', () => {
    it('requests a capability instance', async () => {
      broker.register(BUILTIN_CAPABILITIES.core)
      const instance = await broker.request('core')

      expect(instance).toBeDefined()
      expect(instance.capability.id).toBe('core')
    })

    it('loads capability on request', async () => {
      broker.register(BUILTIN_CAPABILITIES.core)
      const instance = await broker.request('core')

      await instance.load()
      expect(instance.loaded).toBe(true)
    })

    it('rejects unknown capability', async () => {
      await expect(broker.request('unknown')).rejects.toThrow()
    })
  })

  describe('requestMultiple', () => {
    it('requests multiple capabilities', async () => {
      broker.register(BUILTIN_CAPABILITIES.core)
      broker.register(BUILTIN_CAPABILITIES.collections)

      const instances = await broker.requestMultiple(['core', 'collections'])

      expect(instances.size).toBe(2)
      expect(instances.has('core')).toBe(true)
      expect(instances.has('collections')).toBe(true)
    })
  })

  describe('release', () => {
    it('releases a capability', async () => {
      broker.register(BUILTIN_CAPABILITIES.core)
      await broker.request('core')
      await expect(broker.release('core')).resolves.not.toThrow()
    })
  })

  describe('isAvailable', () => {
    it('checks availability', () => {
      expect(broker.isAvailable('unknown')).toBe(false)
      broker.register(BUILTIN_CAPABILITIES.core)
      expect(broker.isAvailable('core')).toBe(true)
    })
  })

  describe('resolveDependencies', () => {
    it('resolves capability dependencies', () => {
      broker.register(BUILTIN_CAPABILITIES.core)
      broker.register(BUILTIN_CAPABILITIES.collections)
      broker.register(BUILTIN_CAPABILITIES.linq)

      const deps = broker.resolveDependencies('linq')

      expect(deps).toContain('core')
      expect(deps).toContain('collections')
    })
  })

  describe('stats', () => {
    it('returns broker statistics', () => {
      const stats = broker.stats()

      expect(stats.registered).toBeGreaterThanOrEqual(0)
      expect(stats.loaded).toBeGreaterThanOrEqual(0)
      expect(stats.requests).toBeGreaterThanOrEqual(0)
      expect(stats.memoryUsage).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('Capability Composer', () => {
  let composer: CapabilityComposer

  beforeEach(() => {
    composer = createCapabilityComposer()
  })

  describe('base', () => {
    it('starts with base capabilities', () => {
      const result = composer.base(['core', 'collections']).build()

      expect(result.some((c) => c.id === 'core')).toBe(true)
      expect(result.some((c) => c.id === 'collections')).toBe(true)
    })
  })

  describe('add', () => {
    it('adds capabilities', () => {
      const result = composer.base(['core']).add(['linq']).build()

      expect(result.some((c) => c.id === 'linq')).toBe(true)
    })
  })

  describe('remove', () => {
    it('removes capabilities', () => {
      const result = composer.base(['core', 'collections', 'linq']).remove(['linq']).build()

      expect(result.some((c) => c.id === 'linq')).toBe(false)
      expect(result.some((c) => c.id === 'core')).toBe(true)
    })
  })

  describe('filterByCategory', () => {
    it('filters by categories', () => {
      const result = composer
        .base(Object.keys(BUILTIN_CAPABILITIES))
        .filterByCategory(['serialization'])
        .build()

      expect(result.every((c) => c.category === 'serialization')).toBe(true)
    })
  })

  describe('excludePrivileged', () => {
    it('excludes privileged capabilities', () => {
      const result = composer.base(Object.keys(BUILTIN_CAPABILITIES)).excludePrivileged().build()

      expect(result.every((c) => !c.privileged)).toBe(true)
    })
  })

  describe('resolveDependencies', () => {
    it('adds missing dependencies', () => {
      const result = composer.base(['linq']).resolveDependencies().build()

      // linq depends on collections which depends on core
      expect(result.some((c) => c.id === 'collections')).toBe(true)
      expect(result.some((c) => c.id === 'core')).toBe(true)
    })
  })

  describe('getAssemblies', () => {
    it('returns all required assemblies', () => {
      const assemblies = composer.base(['core', 'json']).getAssemblies()

      expect(assemblies).toContain('System.Private.CoreLib')
      expect(assemblies).toContain('System.Text.Json')
    })

    it('deduplicates assemblies', () => {
      const assemblies = composer.base(['core', 'collections', 'linq']).getAssemblies()
      const unique = new Set(assemblies)

      expect(assemblies.length).toBe(unique.size)
    })
  })

  describe('getNamespaces', () => {
    it('returns all required namespaces', () => {
      const namespaces = composer.base(['core', 'linq']).getNamespaces()

      expect(namespaces).toContain('System')
      expect(namespaces).toContain('System.Linq')
    })
  })

  describe('getMemoryFootprint', () => {
    it('calculates total memory footprint', () => {
      const footprint = composer.base(['core', 'json']).getMemoryFootprint()

      const expected =
        BUILTIN_CAPABILITIES.core.memoryFootprint + BUILTIN_CAPABILITIES.json.memoryFootprint

      expect(footprint).toBe(expected)
    })
  })

  describe('chaining', () => {
    it('supports method chaining', () => {
      const result = composer
        .base(['core'])
        .add(['collections', 'linq'])
        .add(['json'])
        .remove(['linq'])
        .resolveDependencies()
        .build()

      expect(result.some((c) => c.id === 'json')).toBe(true)
      expect(result.some((c) => c.id === 'collections')).toBe(true)
    })
  })
})

describe('Capability Profiles', () => {
  describe('CAPABILITY_PROFILES', () => {
    it('has minimal profile', () => {
      expect(CAPABILITY_PROFILES.minimal).toEqual(['core'])
    })

    it('has basic profile', () => {
      expect(CAPABILITY_PROFILES.basic).toContain('core')
      expect(CAPABILITY_PROFILES.basic).toContain('collections')
      expect(CAPABILITY_PROFILES.basic).toContain('linq')
    })

    it('has standard profile', () => {
      expect(CAPABILITY_PROFILES.standard).toContain('json')
      expect(CAPABILITY_PROFILES.standard).toContain('async')
    })

    it('has extended profile', () => {
      expect(CAPABILITY_PROFILES.extended).toContain('regex')
      expect(CAPABILITY_PROFILES.extended).toContain('numerics')
    })

    it('has full profile with all non-privileged', () => {
      const privileged = Object.values(BUILTIN_CAPABILITIES)
        .filter((c) => c.privileged)
        .map((c) => c.id)

      expect(CAPABILITY_PROFILES.full.some((id) => privileged.includes(id))).toBe(false)
    })

    it('has network profile with http', () => {
      expect(CAPABILITY_PROFILES.network).toContain('http')
    })
  })

  describe('getProfileAssemblies', () => {
    it('returns assemblies for profile', () => {
      const assemblies = getProfileAssemblies('standard')

      expect(assemblies).toContain('System.Private.CoreLib')
      expect(assemblies).toContain('System.Text.Json')
      expect(assemblies).toContain('System.Threading.Tasks')
    })

    it('deduplicates assemblies', () => {
      const assemblies = getProfileAssemblies('full')
      const unique = new Set(assemblies)

      expect(assemblies.length).toBe(unique.size)
    })
  })

  describe('getProfileNamespaces', () => {
    it('returns namespaces for profile', () => {
      const namespaces = getProfileNamespaces('standard')

      expect(namespaces).toContain('System')
      expect(namespaces).toContain('System.Linq')
      expect(namespaces).toContain('System.Text.Json')
    })
  })

  describe('getProfileMemoryFootprint', () => {
    it('calculates footprint for profile', () => {
      const minimalFootprint = getProfileMemoryFootprint('minimal')
      const standardFootprint = getProfileMemoryFootprint('standard')
      const fullFootprint = getProfileMemoryFootprint('full')

      expect(minimalFootprint).toBeLessThan(standardFootprint)
      expect(standardFootprint).toBeLessThan(fullFootprint)
    })
  })
})

describe('Capability Validation', () => {
  describe('validateCapabilities', () => {
    it('validates when all required are available', () => {
      const result = validateCapabilities(['core', 'linq'], ['core', 'collections', 'linq'])

      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it('reports missing capabilities', () => {
      const result = validateCapabilities(['core', 'http', 'database'], ['core', 'collections'])

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('http')
      expect(result.missing).toContain('database')
    })

    it('handles empty required list', () => {
      const result = validateCapabilities([], ['core'])

      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it('handles empty available list', () => {
      const result = validateCapabilities(['core'], [])

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('core')
    })
  })
})
