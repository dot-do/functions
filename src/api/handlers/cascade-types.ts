/**
 * Type definitions for cascade handler
 *
 * Separated to allow clean imports without circular dependencies.
 *
 * @module handlers/cascade-types
 */

import type { Env } from '../../core/env'

/**
 * CascadeEnv is now an alias for the unified Env type.
 * All bindings (AI_CLIENT, HUMAN_TASKS, CODE_STORAGE, etc.) are defined in src/core/env.ts.
 */
export type CascadeEnv = Env
