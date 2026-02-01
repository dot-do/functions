/**
 * Type definitions for cascade handler
 *
 * Separated to allow clean imports without circular dependencies.
 *
 * @module handlers/cascade-types
 */

import type { Env, AIClient } from '../router'

/**
 * Extended environment for cascade handler with all tier executor bindings
 */
export interface CascadeEnv extends Env {
  /** AI client for generative/agentic execution */
  AI_CLIENT?: AIClient
  /** Durable Object for human task execution */
  HUMAN_TASKS?: DurableObjectNamespace
  /** R2 bucket for code storage */
  CODE_STORAGE?: R2Bucket
}
