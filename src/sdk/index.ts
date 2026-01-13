/**
 * Functions.do SDK Module
 *
 * Client SDK for interacting with Functions.do:
 * - FunctionClient: HTTP client for function invocation
 * - createFunction: Helper for creating function handlers
 * - RpcTarget: Base class for capnweb RPC targets
 */

// Re-export from the SDK package
export { FunctionClient, type FunctionClientConfig, type InvokeOptions, type InvokeResult, type DeployOptions, type DeployResult, type ListOptions, type ListResult, type GetOptions, type DeleteResult } from '../../packages/functions-sdk/src/index'
