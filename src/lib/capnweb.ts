/**
 * capnweb - Cap'n Proto-style RPC for Web
 *
 * This module provides the RpcTarget base class for implementing
 * RPC targets that can be invoked remotely.
 *
 * Inspired by Cloudflare's Workers RPC and Cap'n Proto.
 * Reference: projects/dot-do-capnweb/src/core.ts
 */

// Polyfill Symbol.dispose for environments that don't support it yet
if (!Symbol.dispose) {
  ;(Symbol as any).dispose = Symbol.for('dispose')
}

/**
 * Brand type for RpcTarget identification
 */
export declare const __RPC_TARGET_BRAND: unique symbol

/**
 * Branded type for type-safe RpcTarget identification
 */
export interface RpcTargetBranded {
  [__RPC_TARGET_BRAND]: never
}

/**
 * RpcTarget is the base class for objects that can be remotely invoked.
 *
 * Subclasses can define methods that will be callable via RPC.
 * The RPC system handles serialization and deserialization of
 * arguments and return values.
 *
 * Example:
 * ```typescript
 * class MyService extends RpcTarget {
 *   async greet(name: string): Promise<string> {
 *     return `Hello, ${name}!`
 *   }
 * }
 * ```
 */
export class RpcTarget implements RpcTargetBranded, Disposable {
  /**
   * Brand for type identification
   */
  declare [__RPC_TARGET_BRAND]: never

  /**
   * Dispose of resources held by this target.
   * Override in subclasses to clean up resources.
   */
  [Symbol.dispose](): void {
    // Default implementation does nothing
    // Subclasses should override to clean up resources
  }
}

/**
 * Type alias for property path used in RPC
 */
export type PropertyPath = (string | number)[]
