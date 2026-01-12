/**
 * Pyodide Compatibility Checker for Functions.do
 *
 * This module checks whether Python packages and code are compatible
 * with Pyodide (Python running in WebAssembly on Cloudflare Workers).
 */

import type { PythonDependency } from './dependency-parser'

/**
 * Result of a Pyodide compatibility check
 */
export interface PyodideCompatResult {
  /**
   * Whether all dependencies are compatible
   */
  compatible: boolean

  /**
   * List of compatible packages
   */
  compatiblePackages: string[]

  /**
   * List of incompatible packages with reasons
   */
  incompatiblePackages: Array<{
    name: string
    reason: string
    suggestion?: string
  }>

  /**
   * Packages that might work but need testing
   */
  unknownPackages: string[]

  /**
   * Python version compatibility
   */
  pythonVersion?: {
    required?: string
    pyodideVersion: string
    compatible: boolean
  }

  /**
   * Warnings about potential issues
   */
  warnings: string[]
}

/**
 * Packages known to be available in Pyodide
 * See: https://pyodide.org/en/stable/usage/packages-in-pyodide.html
 */
const PYODIDE_BUILTIN_PACKAGES = new Set([
  // Standard library - always available
  'json',
  'math',
  're',
  'datetime',
  'collections',
  'itertools',
  'functools',
  'operator',
  'pathlib',
  'typing',
  'dataclasses',
  'enum',
  'abc',
  'copy',
  'pprint',
  'random',
  'hashlib',
  'hmac',
  'secrets',
  'base64',
  'binascii',
  'struct',
  'codecs',
  'unicodedata',
  'string',
  'textwrap',
  'difflib',
  'io',
  'contextlib',
  'decimal',
  'fractions',
  'numbers',
  'statistics',
  'urllib',
  'html',
  'xml',
  'email',
  'mailbox',
  'mimetypes',
  'csv',
  'configparser',
  'tomllib',
  'pickle',
  'shelve',
  'sqlite3',
  'zlib',
  'gzip',
  'bz2',
  'lzma',
  'zipfile',
  'tarfile',
  'asyncio',
  'logging',
  'warnings',
  'traceback',
  'inspect',
  'dis',
  'sys',
  'os',
  'time',
  'calendar',
  'locale',
  'gettext',
  'argparse',
  'optparse',
  'getopt',
  'unittest',
  'doctest',
  'typing-extensions',
])

/**
 * Packages available as Pyodide built-in packages (need to be loaded)
 */
const PYODIDE_LOADABLE_PACKAGES = new Set([
  // Scientific computing
  'numpy',
  'scipy',
  'pandas',
  'scikit-learn',
  'statsmodels',

  // Data processing
  'lxml',
  'beautifulsoup4',
  'html5lib',
  'cssselect',
  'soupsieve',

  // Text processing
  'regex',
  'pyparsing',
  'pyyaml',
  'toml',
  'jinja2',
  'markupsafe',
  'packaging',

  // Cryptography (pure Python parts)
  'pycryptodome',
  'cryptography',

  // Image processing (limited)
  'pillow',
  'imageio',

  // Machine Learning
  'scikit-image',
  'networkx',

  // JSON/Data
  'orjson',
  'ujson',
  'jsonschema',
  'attrs',
  'cattrs',
  'pydantic',

  // HTTP/Networking (limited - no actual sockets in WASM)
  'httpx',
  'requests',
  'urllib3',
  'certifi',
  'charset-normalizer',
  'idna',

  // Async
  'aiohttp',

  // Utilities
  'more-itertools',
  'toolz',
  'cytoolz',
  'cachetools',
  'python-dateutil',
  'pytz',
  'six',

  // Testing
  'pytest',
  'hypothesis',

  // Plotting (output limited in Workers)
  'matplotlib',
  'seaborn',
  'plotly',

  // Other scientific
  'sympy',
  'mpmath',
  'gmpy2',
])

/**
 * Packages known to be INCOMPATIBLE with Pyodide
 */
const INCOMPATIBLE_PACKAGES: Record<string, { reason: string; suggestion?: string }> = {
  // System-level packages
  psutil: {
    reason: 'Requires OS-level system calls not available in WASM',
    suggestion: 'Use environment variables or static configuration instead',
  },
  subprocess32: {
    reason: 'No subprocess support in WASM environment',
    suggestion: 'Use async/await patterns or Workers service bindings',
  },
  multiprocessing: {
    reason: 'No process spawning in WASM environment',
    suggestion: 'Use Workers for parallel processing via service bindings',
  },

  // File system dependent
  watchdog: {
    reason: 'No filesystem watching in WASM',
  },
  inotify: {
    reason: 'Linux-specific filesystem watching not available',
  },

  // Network/Socket dependent
  gevent: {
    reason: 'Requires native sockets and greenlet C extension',
    suggestion: 'Use asyncio instead',
  },
  eventlet: {
    reason: 'Requires native sockets',
    suggestion: 'Use asyncio instead',
  },
  twisted: {
    reason: 'Requires native sockets and reactor implementations',
    suggestion: 'Use asyncio instead',
  },
  tornado: {
    reason: 'Requires native sockets',
    suggestion: 'Use asyncio with aiohttp for similar functionality',
  },
  uvloop: {
    reason: 'C extension for event loops not compatible with WASM',
  },
  grpcio: {
    reason: 'Requires native gRPC bindings',
    suggestion: 'Use HTTP/JSON APIs or Workers RPC',
  },

  // Database drivers (native)
  psycopg2: {
    reason: 'Requires native PostgreSQL client library',
    suggestion: 'Use Hyperdrive or REST APIs for database access',
  },
  'psycopg2-binary': {
    reason: 'Requires native PostgreSQL client library',
    suggestion: 'Use Hyperdrive or REST APIs for database access',
  },
  pymysql: {
    reason: 'Requires socket connections',
    suggestion: 'Use Hyperdrive or REST APIs for database access',
  },
  mysqlclient: {
    reason: 'Requires native MySQL client library',
    suggestion: 'Use Hyperdrive or REST APIs for database access',
  },
  'mysql-connector-python': {
    reason: 'Requires socket connections',
    suggestion: 'Use Hyperdrive or REST APIs for database access',
  },
  redis: {
    reason: 'Requires socket connections',
    suggestion: 'Use Workers KV or Upstash Redis REST API',
  },
  pymongo: {
    reason: 'Requires socket connections',
    suggestion: 'Use MongoDB Atlas Data API',
  },
  elasticsearch: {
    reason: 'Requires persistent HTTP connections',
    suggestion: 'Use fetch-based REST API calls',
  },

  // AWS SDK (uses native crypto and sockets)
  boto3: {
    reason: 'Requires socket connections and native crypto',
    suggestion: 'Use fetch with AWS Signature V4 or Workers S3 bindings',
  },
  botocore: {
    reason: 'Requires socket connections and native crypto',
    suggestion: 'Use fetch with AWS Signature V4',
  },

  // Web frameworks (not needed in Workers)
  django: {
    reason: 'Full web framework not suitable for serverless functions',
    suggestion: 'Export handler functions directly',
  },
  flask: {
    reason: 'Web framework with WSGI server not compatible',
    suggestion: 'Export handler functions directly',
  },
  fastapi: {
    reason: 'Requires ASGI server',
    suggestion: 'Export handler functions directly',
  },
  starlette: {
    reason: 'Requires ASGI server',
    suggestion: 'Use function handlers directly',
  },
  uvicorn: {
    reason: 'ASGI server not applicable to Workers',
  },
  gunicorn: {
    reason: 'WSGI server not applicable to Workers',
  },
  celery: {
    reason: 'Task queue requiring broker connections',
    suggestion: 'Use Workers Queues instead',
  },

  // Native C extensions
  cffi: {
    reason: 'C Foreign Function Interface not available in WASM',
  },
  cython: {
    reason: 'Cython requires compilation to native code',
  },
  swig: {
    reason: 'SWIG bindings require native compilation',
  },

  // Heavy ML (use Workers AI instead)
  tensorflow: {
    reason: 'Too large and requires native ops',
    suggestion: 'Use Workers AI for inference',
  },
  'tensorflow-gpu': {
    reason: 'No GPU access in Workers',
    suggestion: 'Use Workers AI for inference',
  },
  torch: {
    reason: 'Too large and requires native ops',
    suggestion: 'Use Workers AI for inference',
  },
  pytorch: {
    reason: 'Too large and requires native ops',
    suggestion: 'Use Workers AI for inference',
  },
  keras: {
    reason: 'Requires TensorFlow',
    suggestion: 'Use Workers AI for inference',
  },
  xgboost: {
    reason: 'Requires native C++ library',
    suggestion: 'Use pre-trained models with scikit-learn or Workers AI',
  },
  lightgbm: {
    reason: 'Requires native C++ library',
    suggestion: 'Use pre-trained models with scikit-learn or Workers AI',
  },
  catboost: {
    reason: 'Requires native C++ library',
    suggestion: 'Use Workers AI for inference',
  },

  // Graphics/GUI
  tkinter: {
    reason: 'No GUI support in Workers',
  },
  pygame: {
    reason: 'No graphics support in Workers',
  },
  pyglet: {
    reason: 'No graphics support in Workers',
  },
  pyqt5: {
    reason: 'No GUI support in Workers',
  },
  wxpython: {
    reason: 'No GUI support in Workers',
  },
  opencv: {
    reason: 'Requires native OpenCV library',
    suggestion: 'Use Workers AI for image processing or simpler alternatives',
  },
  'opencv-python': {
    reason: 'Requires native OpenCV library',
    suggestion: 'Use Workers AI for image processing',
  },

  // Audio/Video
  pyaudio: {
    reason: 'No audio hardware access',
  },
  pydub: {
    reason: 'Requires ffmpeg',
    suggestion: 'Process media server-side before Workers',
  },
  moviepy: {
    reason: 'Requires ffmpeg',
  },
}

/**
 * Patterns for packages that are likely incompatible
 */
const INCOMPATIBLE_PATTERNS: Array<{ pattern: RegExp; reason: string; suggestion?: string }> = [
  {
    pattern: /^py.*-dev$/,
    reason: 'Development headers package',
    suggestion: 'Remove -dev packages, they are for building C extensions',
  },
  {
    pattern: /-native$/,
    reason: 'Native extension package',
  },
  {
    pattern: /^lib.*-dev$/,
    reason: 'System library development package',
  },
]

/**
 * Current Pyodide Python version
 */
const PYODIDE_PYTHON_VERSION = '3.11'

/**
 * Check if a Python version constraint is compatible with Pyodide
 */
function checkPythonVersionCompat(requiredVersion: string | undefined): {
  compatible: boolean
  pyodideVersion: string
  required?: string
} {
  if (!requiredVersion) {
    return { compatible: true, pyodideVersion: PYODIDE_PYTHON_VERSION }
  }

  // Parse version constraint
  const pyodideMajor = 3
  const pyodideMinor = 11

  // Handle >=3.x, ~=3.x, ==3.x patterns
  const geMatch = requiredVersion.match(/>=\s*(\d+)\.(\d+)/)
  if (geMatch) {
    const reqMajor = parseInt(geMatch[1], 10)
    const reqMinor = parseInt(geMatch[2], 10)
    const compatible = pyodideMajor >= reqMajor && (pyodideMajor > reqMajor || pyodideMinor >= reqMinor)
    return { compatible, pyodideVersion: PYODIDE_PYTHON_VERSION, required: requiredVersion }
  }

  const ltMatch = requiredVersion.match(/<\s*(\d+)\.(\d+)/)
  if (ltMatch) {
    const reqMajor = parseInt(ltMatch[1], 10)
    const reqMinor = parseInt(ltMatch[2], 10)
    const compatible = pyodideMajor < reqMajor || (pyodideMajor === reqMajor && pyodideMinor < reqMinor)
    return { compatible, pyodideVersion: PYODIDE_PYTHON_VERSION, required: requiredVersion }
  }

  // Assume compatible if we can't parse
  return { compatible: true, pyodideVersion: PYODIDE_PYTHON_VERSION, required: requiredVersion }
}

/**
 * Check Pyodide compatibility for a list of dependencies
 */
export function checkPyodideCompat(
  dependencies: PythonDependency[],
  pythonVersion?: string
): PyodideCompatResult {
  const compatiblePackages: string[] = []
  const incompatiblePackages: Array<{ name: string; reason: string; suggestion?: string }> = []
  const unknownPackages: string[] = []
  const warnings: string[] = []

  for (const dep of dependencies) {
    const normalizedName = dep.name.toLowerCase()

    // Check if it's a known compatible package
    if (PYODIDE_BUILTIN_PACKAGES.has(normalizedName) || PYODIDE_LOADABLE_PACKAGES.has(normalizedName)) {
      compatiblePackages.push(dep.name)
      continue
    }

    // Check if it's a known incompatible package
    if (normalizedName in INCOMPATIBLE_PACKAGES) {
      const info = INCOMPATIBLE_PACKAGES[normalizedName]
      incompatiblePackages.push({
        name: dep.name,
        reason: info.reason,
        suggestion: info.suggestion,
      })
      continue
    }

    // Check against incompatible patterns
    let matchedPattern = false
    for (const { pattern, reason, suggestion } of INCOMPATIBLE_PATTERNS) {
      if (pattern.test(normalizedName)) {
        incompatiblePackages.push({ name: dep.name, reason, suggestion })
        matchedPattern = true
        break
      }
    }

    if (matchedPattern) {
      continue
    }

    // Unknown package - might work if it's pure Python
    unknownPackages.push(dep.name)
    warnings.push(
      `Package "${dep.name}" is not in the known compatibility list. ` +
        `It may work if it's pure Python with no C extensions.`
    )
  }

  // Check Python version compatibility
  const pythonVersionCompat = checkPythonVersionCompat(pythonVersion)
  if (!pythonVersionCompat.compatible) {
    warnings.push(
      `Python version constraint "${pythonVersion}" may not be compatible with ` +
        `Pyodide (Python ${PYODIDE_PYTHON_VERSION})`
    )
  }

  // Determine overall compatibility
  const compatible = incompatiblePackages.length === 0 && pythonVersionCompat.compatible

  return {
    compatible,
    compatiblePackages,
    incompatiblePackages,
    unknownPackages,
    pythonVersion: pythonVersionCompat,
    warnings,
  }
}

/**
 * Check if Python code uses incompatible features
 */
export function checkCodeCompat(code: string): { compatible: boolean; warnings: string[] } {
  const warnings: string[] = []

  // Check for file system operations (limited in Workers)
  if (/\bopen\s*\(/.test(code) && !code.includes('# fs-ok')) {
    warnings.push('File system operations (open()) are limited in Workers. Use KV, R2, or D1 for persistence.')
  }

  // Check for subprocess usage
  if (/\bsubprocess\b/.test(code)) {
    warnings.push('subprocess module is not available in Workers environment.')
  }

  // Check for multiprocessing
  if (/\bmultiprocessing\b/.test(code)) {
    warnings.push('multiprocessing is not available. Use service bindings for parallelism.')
  }

  // Check for threading
  if (/\bthreading\b/.test(code) && !code.includes('# threading-ok')) {
    warnings.push(
      'Threading has limited support in Pyodide. Consider using asyncio.'
    )
  }

  // Check for socket usage
  if (/\bsocket\b/.test(code)) {
    warnings.push('Raw socket operations are not available. Use fetch() for HTTP requests.')
  }

  // Check for os.system or os.popen
  if (/\bos\.(system|popen)\s*\(/.test(code)) {
    warnings.push('os.system() and os.popen() are not available in Workers.')
  }

  // Check for ctypes/cffi
  if (/\b(ctypes|cffi)\b/.test(code)) {
    warnings.push('C extension interfaces (ctypes/cffi) are not available in WASM.')
  }

  return {
    compatible: warnings.length === 0,
    warnings,
  }
}

/**
 * Generate a requirements.txt with only Pyodide-compatible packages
 */
export function filterCompatibleDependencies(dependencies: PythonDependency[]): {
  compatible: PythonDependency[]
  filtered: Array<{ dependency: PythonDependency; reason: string }>
} {
  const compatible: PythonDependency[] = []
  const filtered: Array<{ dependency: PythonDependency; reason: string }> = []

  for (const dep of dependencies) {
    const normalizedName = dep.name.toLowerCase()

    if (normalizedName in INCOMPATIBLE_PACKAGES) {
      filtered.push({
        dependency: dep,
        reason: INCOMPATIBLE_PACKAGES[normalizedName].reason,
      })
    } else {
      // Check patterns
      let isIncompatible = false
      for (const { pattern, reason } of INCOMPATIBLE_PATTERNS) {
        if (pattern.test(normalizedName)) {
          filtered.push({ dependency: dep, reason })
          isIncompatible = true
          break
        }
      }

      if (!isIncompatible) {
        compatible.push(dep)
      }
    }
  }

  return { compatible, filtered }
}

/**
 * Get list of all known Pyodide-compatible packages
 */
export function getKnownCompatiblePackages(): string[] {
  return [...PYODIDE_BUILTIN_PACKAGES, ...PYODIDE_LOADABLE_PACKAGES].sort()
}

/**
 * Check if a specific package is known to be compatible
 */
export function isPackageCompatible(packageName: string): 'compatible' | 'incompatible' | 'unknown' {
  const normalized = packageName.toLowerCase()

  if (PYODIDE_BUILTIN_PACKAGES.has(normalized) || PYODIDE_LOADABLE_PACKAGES.has(normalized)) {
    return 'compatible'
  }

  if (normalized in INCOMPATIBLE_PACKAGES) {
    return 'incompatible'
  }

  for (const { pattern } of INCOMPATIBLE_PATTERNS) {
    if (pattern.test(normalized)) {
      return 'incompatible'
    }
  }

  return 'unknown'
}
