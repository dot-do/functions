/**
 * Cache metrics for observability
 */

export interface CacheMetrics {
  hits: number
  misses: number
  errors: number
}

const metrics: Record<string, CacheMetrics> = {
  metadata: { hits: 0, misses: 0, errors: 0 },
  compiledCode: { hits: 0, misses: 0, errors: 0 },
  sourceCode: { hits: 0, misses: 0, errors: 0 },
}

export function recordCacheHit(type: keyof typeof metrics): void {
  if (metrics[type]) metrics[type].hits++
}

export function recordCacheMiss(type: keyof typeof metrics): void {
  if (metrics[type]) metrics[type].misses++
}

export function recordCacheError(type: keyof typeof metrics): void {
  if (metrics[type]) metrics[type].errors++
}

export function getCacheStats(): Record<string, CacheMetrics & { hitRate: number }> {
  const result: Record<string, CacheMetrics & { hitRate: number }> = {}
  for (const [key, m] of Object.entries(metrics)) {
    const total = m.hits + m.misses
    result[key] = { ...m, hitRate: total > 0 ? m.hits / total : 0 }
  }
  return result
}

export function resetCacheStats(): void {
  for (const m of Object.values(metrics)) {
    m.hits = 0
    m.misses = 0
    m.errors = 0
  }
}
