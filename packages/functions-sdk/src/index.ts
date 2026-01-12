/**
 * @functions.do/sdk - SDK for building serverless functions
 *
 * This SDK provides:
 * - RpcTarget for capnweb RPC integration
 * - FunctionTarget for invoking remote functions
 * - Type utilities for function development
 * - Build tools for ESM bundle production
 *
 * @module @functions.do/sdk
 */

// Re-export capnweb types and classes
export { RpcTarget, type PropertyPath, type RpcTargetBranded, __RPC_TARGET_BRAND } from './capnweb'

// Re-export FunctionTarget for RPC invocation
export {
  FunctionTarget,
  RpcError,
  type WorkerStub,
  type FunctionTargetOptions,
  type TracingHooks,
  type SpanContext,
  type RequestMetrics,
  type AggregatedMetrics,
} from './function-target'

// Export function creation utilities
export { createFunction, type FunctionHandler, type FunctionContext, type FunctionEnv } from './create-function'

// Export type utilities
export type {
  FunctionSignature,
  FunctionParameter,
  JsDocTag,
  TypeDefinitionResult,
  RpcBindingsResult,
  BundleConfig,
  BundleResult,
  ApiDocEntry,
  ApiDocumentation,
} from './types'
