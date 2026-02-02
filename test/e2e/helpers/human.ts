/**
 * Human Function E2E Test Helpers
 *
 * Shared types, utilities, and helpers for human function E2E tests.
 */

import { E2E_CONFIG } from '../config'

// ============================================================================
// Human Function Types
// ============================================================================

export type HumanInteractionType = 'approval' | 'review' | 'input' | 'selection' | 'annotation' | 'verification' | 'custom'

export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'expired'

export interface FormField {
  name: string
  type: 'text' | 'textarea' | 'number' | 'email' | 'select' | 'checkbox' | 'date'
  label?: string
  required?: boolean
  placeholder?: string
  options?: Array<{ label: string; value: string }>
  defaultValue?: unknown
}

export interface QuickAction {
  id: string
  label: string
  value: unknown
  style?: 'primary' | 'secondary' | 'danger'
}

export interface HumanFunctionUI {
  title: string
  description?: string
  form?: FormField[]
  quickActions?: QuickAction[]
  metadata?: Record<string, unknown>
}

export interface HumanFunctionDeployParams {
  id: string
  interactionType: HumanInteractionType
  ui: HumanFunctionUI
  timeout?: string
  assignee?: string
  assignees?: Array<{ type: string; value: string }>
  callbackUrl?: string
}

export interface HumanFunctionDeployResult {
  id: string
  version: string
  url: string
  type: 'human'
  interactionType: HumanInteractionType
}

export interface HumanInvokeResult {
  status: 'pending'
  taskId: string
  taskUrl: string
  callbackUrl: string
  expiresAt?: string
}

export interface TaskStatusResult {
  taskId: string
  status: TaskStatus
  functionId: string
  interactionType: HumanInteractionType
  assignee?: string
  assignedAt?: string
  response?: unknown
  completedAt?: string
  cancelledAt?: string
  expiredAt?: string
  createdAt: string
  ui: HumanFunctionUI
  invocationData?: unknown
}

export interface ApprovalResponse {
  approved: boolean
  reason?: string
  approvedBy?: string
}

export interface FormResponse {
  data: Record<string, unknown>
  submittedBy?: string
}

// ============================================================================
// Human Function Helpers
// ============================================================================

/**
 * Deploy a human function to functions.do
 */
export async function deployHumanFunction(
  params: HumanFunctionDeployParams
): Promise<HumanFunctionDeployResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/functions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify({
      id: params.id,
      version: '1.0.0',
      type: 'human',
      interactionType: params.interactionType,
      ui: params.ui,
      timeout: params.timeout,
      assignee: params.assignee,
      callbackUrl: params.callbackUrl,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deploy human function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Invoke a human function - returns pending status with taskId
 */
export async function invokeHumanFunction(
  functionId: string,
  data?: unknown
): Promise<HumanInvokeResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/functions/${functionId}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Invoke human function failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Get the status of a human task
 */
export async function getTaskStatus(taskId: string): Promise<TaskStatusResult> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Get task status failed (${response.status}): ${error}`)
  }

  return response.json()
}

/**
 * Submit a response to a human task
 */
export async function submitTaskResponse(taskId: string, taskResponse: unknown): Promise<void> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks/${taskId}/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
    body: JSON.stringify(taskResponse),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Submit task response failed (${response.status}): ${error}`)
  }
}

/**
 * Cancel a human task
 */
export async function cancelTask(taskId: string): Promise<void> {
  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks/${taskId}`, {
    method: 'DELETE',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Cancel task failed (${response.status}): ${error}`)
  }
}

/**
 * Wait for task to reach a specific status
 */
export async function waitForTaskStatus(
  taskId: string,
  expectedStatus: TaskStatus,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<TaskStatusResult> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const status = await getTaskStatus(taskId)
    if (status.status === expectedStatus) {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`Task ${taskId} did not reach status ${expectedStatus} within ${timeoutMs}ms`)
}

/**
 * List tasks for a function
 */
export async function listTasks(
  functionId: string,
  options?: { status?: TaskStatus; limit?: number }
): Promise<{ tasks: TaskStatusResult[]; total: number }> {
  const params = new URLSearchParams()
  params.set('functionId', functionId)
  if (options?.status) params.set('status', options.status)
  if (options?.limit) params.set('limit', String(options.limit))

  const response = await fetch(`${E2E_CONFIG.baseUrl}/api/tasks?${params}`, {
    method: 'GET',
    headers: {
      ...(E2E_CONFIG.apiKey ? { 'X-API-Key': E2E_CONFIG.apiKey } : {}),
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`List tasks failed (${response.status}): ${error}`)
  }

  return response.json()
}

// ============================================================================
// Test Configuration
// ============================================================================

/** Extended timeout for human function deploy operations */
export const HUMAN_DEPLOY_TIMEOUT = 60_000

/** Timeout for human function invoke operations */
export const HUMAN_INVOKE_TIMEOUT = 30_000

/** Full flow timeout (deploy + invoke + complete) */
export const HUMAN_FULL_FLOW_TIMEOUT = 120_000
