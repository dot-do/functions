/**
 * Runtime Capability Discovery and Composition
 *
 * This module implements the capability broker pattern for C# runtime,
 * enabling automatic discovery of required capabilities from code and
 * composition of capability sets. Key features:
 * 1. Static analysis to detect required capabilities from code
 * 2. Capability broker for providing runtime services
 * 3. Capability composition for building custom runtime profiles
 * 4. Lazy capability loading for optimal resource usage
 *
 * Capability Model:
 * - Capabilities are named services/features (e.g., 'http', 'json', 'logging')
 * - Code analysis detects which capabilities are needed
 * - Broker provides capabilities only when requested
 * - Composition allows building custom capability sets
 */

/**
 * Runtime capability definition
 */
export interface Capability {
  /**
   * Unique capability identifier
   */
  id: string
  /**
   * Human-readable name
   */
  name: string
  /**
   * Description of what this capability provides
   */
  description: string
  /**
   * Required assembly references
   */
  assemblies: string[]
  /**
   * Required namespace imports
   */
  namespaces: string[]
  /**
   * Types provided by this capability
   */
  providedTypes: string[]
  /**
   * Methods provided by this capability
   */
  providedMethods: string[]
  /**
   * Dependencies on other capabilities
   */
  dependencies: string[]
  /**
   * Whether this capability requires elevated privileges
   */
  privileged: boolean
  /**
   * Capability category
   */
  category: CapabilityCategory
  /**
   * Estimated memory footprint in bytes
   */
  memoryFootprint: number
}

/**
 * Capability categories
 */
export type CapabilityCategory =
  | 'core' // Basic runtime features
  | 'collections' // Data structures
  | 'io' // Input/output operations
  | 'network' // Network operations
  | 'serialization' // Data serialization
  | 'security' // Security and cryptography
  | 'logging' // Logging and diagnostics
  | 'database' // Database access
  | 'async' // Async/await support
  | 'reflection' // Reflection APIs
  | 'interop' // Native interop

/**
 * Result of capability detection from code
 */
export interface CapabilityDetectionResult {
  /**
   * Required capabilities
   */
  required: string[]
  /**
   * Optional capabilities (detected but not critical)
   */
  optional: string[]
  /**
   * Capabilities that would enhance the code
   */
  suggested: string[]
  /**
   * Detected but unavailable capabilities
   */
  unavailable: string[]
  /**
   * Detection confidence (0-1)
   */
  confidence: number
  /**
   * Detection details for each capability
   */
  details: Array<{
    capabilityId: string
    reason: string
    locations: Array<{ line: number; column: number }>
  }>
  /**
   * Analysis time in milliseconds
   */
  analysisTimeMs: number
}

/**
 * Capability instance (runtime-provided service)
 */
export interface CapabilityInstance {
  /**
   * Capability definition
   */
  capability: Capability
  /**
   * Whether the capability is loaded
   */
  loaded: boolean
  /**
   * Load the capability
   */
  load(): Promise<void>
  /**
   * Unload the capability
   */
  unload(): Promise<void>
  /**
   * Get the service provided by this capability
   */
  getService<T>(): T | undefined
}

/**
 * Capability broker - provides capabilities to runtime
 */
export interface CapabilityBroker {
  /**
   * Register a capability
   */
  register(capability: Capability): void

  /**
   * Get a registered capability by ID
   */
  get(id: string): Capability | undefined

  /**
   * List all registered capabilities
   */
  list(): Capability[]

  /**
   * List capabilities by category
   */
  listByCategory(category: CapabilityCategory): Capability[]

  /**
   * Request a capability instance
   */
  request(id: string): Promise<CapabilityInstance>

  /**
   * Request multiple capabilities
   */
  requestMultiple(ids: string[]): Promise<Map<string, CapabilityInstance>>

  /**
   * Release a capability instance
   */
  release(id: string): Promise<void>

  /**
   * Check if a capability is available
   */
  isAvailable(id: string): boolean

  /**
   * Resolve capability dependencies
   */
  resolveDependencies(id: string): string[]

  /**
   * Get capability usage statistics
   */
  stats(): CapabilityBrokerStats
}

/**
 * Capability broker statistics
 */
export interface CapabilityBrokerStats {
  /**
   * Total registered capabilities
   */
  registered: number
  /**
   * Currently loaded capabilities
   */
  loaded: number
  /**
   * Total requests served
   */
  requests: number
  /**
   * Cache hits
   */
  cacheHits: number
  /**
   * Cache misses
   */
  cacheMisses: number
  /**
   * Total memory used by capabilities
   */
  memoryUsage: number
}

/**
 * Built-in capabilities
 */
export const BUILTIN_CAPABILITIES: Record<string, Capability> = {
  core: {
    id: 'core',
    name: 'Core Runtime',
    description: 'Basic .NET runtime features',
    assemblies: ['System.Private.CoreLib', 'System.Runtime'],
    namespaces: ['System'],
    providedTypes: ['Object', 'String', 'Int32', 'Boolean', 'Array'],
    providedMethods: ['ToString', 'GetHashCode', 'Equals'],
    dependencies: [],
    privileged: false,
    category: 'core',
    memoryFootprint: 1024 * 1024, // 1 MB
  },
  collections: {
    id: 'collections',
    name: 'Collections',
    description: 'Generic collections and data structures',
    assemblies: ['System.Collections', 'System.Collections.Generic'],
    namespaces: ['System.Collections', 'System.Collections.Generic'],
    providedTypes: [
      'List<T>',
      'Dictionary<K,V>',
      'HashSet<T>',
      'Queue<T>',
      'Stack<T>',
    ],
    providedMethods: ['Add', 'Remove', 'Contains', 'Clear', 'Count'],
    dependencies: ['core'],
    privileged: false,
    category: 'collections',
    memoryFootprint: 512 * 1024, // 512 KB
  },
  linq: {
    id: 'linq',
    name: 'LINQ',
    description: 'Language Integrated Query',
    assemblies: ['System.Linq'],
    namespaces: ['System.Linq'],
    providedTypes: ['Enumerable', 'Queryable'],
    providedMethods: [
      'Where',
      'Select',
      'OrderBy',
      'GroupBy',
      'Join',
      'Aggregate',
      'First',
      'Last',
      'Any',
      'All',
    ],
    dependencies: ['core', 'collections'],
    privileged: false,
    category: 'collections',
    memoryFootprint: 256 * 1024, // 256 KB
  },
  json: {
    id: 'json',
    name: 'JSON Serialization',
    description: 'JSON serialization and deserialization',
    assemblies: ['System.Text.Json'],
    namespaces: ['System.Text.Json', 'System.Text.Json.Serialization'],
    providedTypes: ['JsonSerializer', 'JsonDocument', 'JsonElement'],
    providedMethods: ['Serialize', 'Deserialize', 'Parse'],
    dependencies: ['core'],
    privileged: false,
    category: 'serialization',
    memoryFootprint: 1024 * 1024, // 1 MB
  },
  regex: {
    id: 'regex',
    name: 'Regular Expressions',
    description: 'Regular expression matching and manipulation',
    assemblies: ['System.Text.RegularExpressions'],
    namespaces: ['System.Text.RegularExpressions'],
    providedTypes: ['Regex', 'Match', 'Group', 'Capture'],
    providedMethods: ['Match', 'Matches', 'Replace', 'Split', 'IsMatch'],
    dependencies: ['core'],
    privileged: false,
    category: 'core',
    memoryFootprint: 256 * 1024, // 256 KB
  },
  async: {
    id: 'async',
    name: 'Async/Await',
    description: 'Asynchronous programming support',
    assemblies: ['System.Threading.Tasks'],
    namespaces: ['System.Threading.Tasks'],
    providedTypes: ['Task', 'Task<T>', 'ValueTask', 'ValueTask<T>'],
    providedMethods: ['Run', 'WhenAll', 'WhenAny', 'Delay', 'FromResult'],
    dependencies: ['core'],
    privileged: false,
    category: 'async',
    memoryFootprint: 256 * 1024, // 256 KB
  },
  http: {
    id: 'http',
    name: 'HTTP Client',
    description: 'HTTP client for making web requests',
    assemblies: ['System.Net.Http'],
    namespaces: ['System.Net.Http'],
    providedTypes: [
      'HttpClient',
      'HttpRequestMessage',
      'HttpResponseMessage',
      'StringContent',
    ],
    providedMethods: ['GetAsync', 'PostAsync', 'PutAsync', 'DeleteAsync', 'SendAsync'],
    dependencies: ['core', 'async'],
    privileged: true,
    category: 'network',
    memoryFootprint: 2 * 1024 * 1024, // 2 MB
  },
  logging: {
    id: 'logging',
    name: 'Logging',
    description: 'Logging and diagnostics',
    assemblies: ['Microsoft.Extensions.Logging.Abstractions'],
    namespaces: ['Microsoft.Extensions.Logging'],
    providedTypes: ['ILogger', 'ILoggerFactory', 'LogLevel'],
    providedMethods: [
      'LogInformation',
      'LogWarning',
      'LogError',
      'LogDebug',
      'LogTrace',
    ],
    dependencies: ['core'],
    privileged: false,
    category: 'logging',
    memoryFootprint: 128 * 1024, // 128 KB
  },
  crypto: {
    id: 'crypto',
    name: 'Cryptography',
    description: 'Cryptographic operations',
    assemblies: ['System.Security.Cryptography'],
    namespaces: ['System.Security.Cryptography'],
    providedTypes: ['SHA256', 'Aes', 'RSA', 'HMACSHA256'],
    providedMethods: ['ComputeHash', 'Encrypt', 'Decrypt'],
    dependencies: ['core'],
    privileged: true,
    category: 'security',
    memoryFootprint: 512 * 1024, // 512 KB
  },
  reflection: {
    id: 'reflection',
    name: 'Reflection',
    description: 'Runtime type inspection and invocation',
    assemblies: ['System.Reflection'],
    namespaces: ['System.Reflection'],
    providedTypes: ['Type', 'MethodInfo', 'PropertyInfo', 'FieldInfo'],
    providedMethods: ['GetType', 'GetMethod', 'GetProperty', 'Invoke'],
    dependencies: ['core'],
    privileged: true,
    category: 'reflection',
    memoryFootprint: 1024 * 1024, // 1 MB
  },
  xml: {
    id: 'xml',
    name: 'XML Processing',
    description: 'XML parsing and manipulation',
    assemblies: ['System.Xml', 'System.Xml.Linq'],
    namespaces: ['System.Xml', 'System.Xml.Linq'],
    providedTypes: ['XDocument', 'XElement', 'XmlDocument', 'XmlReader'],
    providedMethods: ['Parse', 'Load', 'Save', 'SelectNodes'],
    dependencies: ['core'],
    privileged: false,
    category: 'serialization',
    memoryFootprint: 1024 * 1024, // 1 MB
  },
  numerics: {
    id: 'numerics',
    name: 'Numerics',
    description: 'Advanced numeric types and SIMD',
    assemblies: ['System.Numerics', 'System.Numerics.Vectors'],
    namespaces: ['System.Numerics'],
    providedTypes: ['BigInteger', 'Complex', 'Vector<T>', 'Matrix4x4'],
    providedMethods: ['Add', 'Multiply', 'Pow', 'Sqrt'],
    dependencies: ['core'],
    privileged: false,
    category: 'core',
    memoryFootprint: 256 * 1024, // 256 KB
  },
}

/**
 * Capability detection patterns - maps code patterns to required capabilities
 */
const CAPABILITY_PATTERNS: Array<{
  pattern: RegExp
  capability: string
  confidence: number
}> = [
  // Core
  { pattern: /\bConsole\.(Write|Read)/g, capability: 'core', confidence: 1.0 },
  { pattern: /\bMath\./g, capability: 'core', confidence: 1.0 },
  // Collections
  { pattern: /\bList<|new\s+List</g, capability: 'collections', confidence: 1.0 },
  { pattern: /\bDictionary<|new\s+Dictionary</g, capability: 'collections', confidence: 1.0 },
  { pattern: /\bHashSet<|new\s+HashSet</g, capability: 'collections', confidence: 1.0 },
  { pattern: /\bQueue<|new\s+Queue</g, capability: 'collections', confidence: 1.0 },
  { pattern: /\bStack<|new\s+Stack</g, capability: 'collections', confidence: 1.0 },
  // LINQ
  { pattern: /\.(Where|Select|OrderBy|GroupBy|Join)\s*\(/g, capability: 'linq', confidence: 0.9 },
  { pattern: /\.(First|Last|Single|Any|All|Count)\s*\(/g, capability: 'linq', confidence: 0.8 },
  { pattern: /\.(Sum|Average|Min|Max|Aggregate)\s*\(/g, capability: 'linq', confidence: 0.9 },
  { pattern: /from\s+\w+\s+in\s+/g, capability: 'linq', confidence: 1.0 },
  // JSON
  { pattern: /JsonSerializer\.(Serialize|Deserialize)/g, capability: 'json', confidence: 1.0 },
  { pattern: /JsonDocument\.Parse/g, capability: 'json', confidence: 1.0 },
  { pattern: /\[JsonProperty|JsonIgnore\]/g, capability: 'json', confidence: 0.9 },
  // Regex
  { pattern: /new\s+Regex\s*\(/g, capability: 'regex', confidence: 1.0 },
  { pattern: /Regex\.(Match|Matches|Replace|Split|IsMatch)/g, capability: 'regex', confidence: 1.0 },
  // Async
  { pattern: /\basync\b/g, capability: 'async', confidence: 1.0 },
  { pattern: /\bawait\b/g, capability: 'async', confidence: 1.0 },
  { pattern: /Task\.(Run|WhenAll|WhenAny|Delay)/g, capability: 'async', confidence: 1.0 },
  { pattern: /\bTask<|ValueTask</g, capability: 'async', confidence: 0.9 },
  // HTTP
  { pattern: /new\s+HttpClient/g, capability: 'http', confidence: 1.0 },
  { pattern: /HttpClient\./g, capability: 'http', confidence: 1.0 },
  { pattern: /\.(GetAsync|PostAsync|PutAsync|DeleteAsync)/g, capability: 'http', confidence: 1.0 },
  // Logging
  { pattern: /ILogger[^<]|\bILogger</g, capability: 'logging', confidence: 1.0 },
  { pattern: /\.Log(Information|Warning|Error|Debug|Trace)/g, capability: 'logging', confidence: 1.0 },
  // Crypto
  { pattern: /SHA256\.|SHA512\.|MD5\./g, capability: 'crypto', confidence: 1.0 },
  { pattern: /\bAes\.|RSA\./g, capability: 'crypto', confidence: 1.0 },
  { pattern: /HMAC/g, capability: 'crypto', confidence: 0.9 },
  // Reflection
  { pattern: /typeof\s*\([^)]+\)\.(GetMethod|GetProperty|GetField)/g, capability: 'reflection', confidence: 1.0 },
  { pattern: /\.GetType\(\)\./g, capability: 'reflection', confidence: 0.8 },
  { pattern: /MethodInfo|PropertyInfo|FieldInfo/g, capability: 'reflection', confidence: 1.0 },
  // XML
  { pattern: /XDocument\.|XElement\./g, capability: 'xml', confidence: 1.0 },
  { pattern: /XmlDocument\.|XmlReader\./g, capability: 'xml', confidence: 1.0 },
  // Numerics
  { pattern: /BigInteger/g, capability: 'numerics', confidence: 1.0 },
  { pattern: /Complex\./g, capability: 'numerics', confidence: 1.0 },
  { pattern: /Vector<|Matrix\d+x\d+/g, capability: 'numerics', confidence: 1.0 },
]

/**
 * Detect required capabilities from C# code
 */
export function detectCapabilities(code: string): CapabilityDetectionResult {
  const startTime = performance.now()
  const detected = new Map<string, { confidence: number; locations: Array<{ line: number; column: number }> }>()

  // Split code into lines for location tracking
  const lines = code.split('\n')

  for (const { pattern, capability, confidence } of CAPABILITY_PATTERNS) {
    let match
    const regex = new RegExp(pattern.source, pattern.flags)
    while ((match = regex.exec(code)) !== null) {
      // Calculate line and column
      const beforeMatch = code.substring(0, match.index)
      const linesBefore = beforeMatch.split('\n')
      const line = linesBefore.length
      const column = linesBefore[linesBefore.length - 1].length + 1

      const existing = detected.get(capability)
      if (existing) {
        existing.confidence = Math.max(existing.confidence, confidence)
        existing.locations.push({ line, column })
      } else {
        detected.set(capability, {
          confidence,
          locations: [{ line, column }],
        })
      }
    }
  }

  // Resolve dependencies
  const required: string[] = []
  const visited = new Set<string>()

  function resolveDeps(capId: string): void {
    if (visited.has(capId)) return
    visited.add(capId)

    const cap = BUILTIN_CAPABILITIES[capId]
    if (cap) {
      for (const dep of cap.dependencies) {
        resolveDeps(dep)
      }
      if (!required.includes(capId)) {
        required.push(capId)
      }
    }
  }

  for (const capId of detected.keys()) {
    resolveDeps(capId)
  }

  // Calculate overall confidence
  let totalConfidence = 0
  for (const { confidence } of detected.values()) {
    totalConfidence += confidence
  }
  const avgConfidence = detected.size > 0 ? totalConfidence / detected.size : 1.0

  // Build details
  const details = Array.from(detected.entries()).map(([capId, info]) => ({
    capabilityId: capId,
    reason: `Detected ${BUILTIN_CAPABILITIES[capId]?.name || capId} usage`,
    locations: info.locations,
  }))

  // Determine unavailable (privileged that may not be allowed)
  const unavailable = required.filter(id => BUILTIN_CAPABILITIES[id]?.privileged)

  return {
    required: required.filter(id => !BUILTIN_CAPABILITIES[id]?.privileged),
    optional: [],
    suggested: [],
    unavailable,
    confidence: avgConfidence,
    details,
    analysisTimeMs: performance.now() - startTime,
  }
}

/**
 * Create a capability broker
 */
export function createCapabilityBroker(): CapabilityBroker {
  throw new Error('Not implemented: createCapabilityBroker')
}

/**
 * Capability composition - combine multiple capability sets
 */
export interface CapabilityComposer {
  /**
   * Start with base capabilities
   */
  base(capabilities: string[]): CapabilityComposer

  /**
   * Add capabilities
   */
  add(capabilities: string[]): CapabilityComposer

  /**
   * Remove capabilities
   */
  remove(capabilities: string[]): CapabilityComposer

  /**
   * Filter by category
   */
  filterByCategory(categories: CapabilityCategory[]): CapabilityComposer

  /**
   * Exclude privileged capabilities
   */
  excludePrivileged(): CapabilityComposer

  /**
   * Include only non-privileged capabilities
   */
  onlyNonPrivileged(): CapabilityComposer

  /**
   * Resolve all dependencies
   */
  resolveDependencies(): CapabilityComposer

  /**
   * Build the final capability set
   */
  build(): Capability[]

  /**
   * Get assembly references for the capability set
   */
  getAssemblies(): string[]

  /**
   * Get namespace imports for the capability set
   */
  getNamespaces(): string[]

  /**
   * Calculate total memory footprint
   */
  getMemoryFootprint(): number
}

/**
 * Create a capability composer
 */
export function createCapabilityComposer(): CapabilityComposer {
  throw new Error('Not implemented: createCapabilityComposer')
}

/**
 * Predefined capability profiles
 */
export const CAPABILITY_PROFILES = {
  /**
   * Minimal - only core runtime
   */
  minimal: ['core'],
  /**
   * Basic - core + collections + LINQ
   */
  basic: ['core', 'collections', 'linq'],
  /**
   * Standard - basic + JSON + async
   */
  standard: ['core', 'collections', 'linq', 'json', 'async'],
  /**
   * Extended - standard + regex + numerics
   */
  extended: ['core', 'collections', 'linq', 'json', 'async', 'regex', 'numerics'],
  /**
   * Full - all non-privileged capabilities
   */
  full: Object.keys(BUILTIN_CAPABILITIES).filter(
    id => !BUILTIN_CAPABILITIES[id].privileged
  ),
  /**
   * Network - includes HTTP (privileged)
   */
  network: ['core', 'collections', 'linq', 'json', 'async', 'http'],
} as const

/**
 * Get assemblies for a capability profile
 */
export function getProfileAssemblies(profileName: keyof typeof CAPABILITY_PROFILES): string[] {
  const capabilities = CAPABILITY_PROFILES[profileName]
  const assemblies = new Set<string>()

  for (const capId of capabilities) {
    const cap = BUILTIN_CAPABILITIES[capId]
    if (cap) {
      for (const asm of cap.assemblies) {
        assemblies.add(asm)
      }
    }
  }

  return Array.from(assemblies)
}

/**
 * Get namespaces for a capability profile
 */
export function getProfileNamespaces(profileName: keyof typeof CAPABILITY_PROFILES): string[] {
  const capabilities = CAPABILITY_PROFILES[profileName]
  const namespaces = new Set<string>()

  for (const capId of capabilities) {
    const cap = BUILTIN_CAPABILITIES[capId]
    if (cap) {
      for (const ns of cap.namespaces) {
        namespaces.add(ns)
      }
    }
  }

  return Array.from(namespaces)
}

/**
 * Calculate memory footprint for a capability profile
 */
export function getProfileMemoryFootprint(
  profileName: keyof typeof CAPABILITY_PROFILES
): number {
  const capabilities = CAPABILITY_PROFILES[profileName]
  let total = 0

  for (const capId of capabilities) {
    const cap = BUILTIN_CAPABILITIES[capId]
    if (cap) {
      total += cap.memoryFootprint
    }
  }

  return total
}

/**
 * Validate that required capabilities are available
 */
export function validateCapabilities(
  required: string[],
  available: string[]
): { valid: boolean; missing: string[] } {
  const availableSet = new Set(available)
  const missing = required.filter(cap => !availableSet.has(cap))

  return {
    valid: missing.length === 0,
    missing,
  }
}
