/**
 * Human Functions - Human-in-the-loop execution
 *
 * Human functions require human input to complete. They enable:
 * - Approval workflows
 * - Manual review and verification
 * - Data entry and annotation
 * - Escalation from AI to human
 * - Complex decisions requiring judgment
 *
 * Implementation: human-in-the-loop primitive
 *
 * Typical timeout: 24 hours (configurable)
 * Typical use: Approvals, reviews, sensitive operations, edge cases
 */

import type {
  FunctionDefinition,
  FunctionResult,
  FunctionExecutor,
  ExecutionContext,
  JsonSchema,
} from '../types.js'

// =============================================================================
// HUMAN FUNCTION DEFINITION
// =============================================================================

export interface HumanFunctionDefinition<
  TInput = unknown,
  TOutput = unknown,
  TConfig = HumanFunctionConfig,
> extends FunctionDefinition<TInput, TOutput, TConfig> {
  type: 'human'

  /** Type of human interaction */
  interactionType: HumanInteractionType

  /** UI configuration */
  ui: HumanUI

  /** Who can respond */
  assignees?: AssigneeConfig

  /** Reminder configuration */
  reminders?: ReminderConfig

  /** Escalation configuration */
  escalation?: EscalationConfig

  /** SLA configuration */
  sla?: SLAConfig
}

export type HumanInteractionType =
  | 'approval'       // Yes/No/Reject decision
  | 'review'         // Review and provide feedback
  | 'input'          // Provide data/information
  | 'selection'      // Choose from options
  | 'annotation'     // Label/annotate data
  | 'verification'   // Verify correctness
  | 'custom'         // Custom form

// =============================================================================
// UI CONFIGURATION
// =============================================================================

export interface HumanUI {
  /** Title shown to human */
  title: string

  /** Description/instructions */
  description?: string

  /** Rich context to display */
  context?: UIContext[]

  /** Form fields for input */
  form?: FormField[]

  /** Quick actions (for approval type) */
  quickActions?: QuickAction[]

  /** Priority indicator */
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

export interface UIContext {
  /** Context type */
  type: 'text' | 'code' | 'json' | 'table' | 'image' | 'link' | 'diff'

  /** Label for this context */
  label: string

  /** Content to display */
  content: unknown

  /** Whether collapsible */
  collapsible?: boolean
}

export interface FormField {
  /** Field name (key in output) */
  name: string

  /** Display label */
  label: string

  /** Field type */
  type: FormFieldType

  /** Whether required */
  required?: boolean

  /** Default value */
  defaultValue?: unknown

  /** Placeholder text */
  placeholder?: string

  /** Help text */
  helpText?: string

  /** Validation schema */
  validation?: JsonSchema

  /** Options (for select, radio, checkbox) */
  options?: Array<{ value: unknown; label: string }>
}

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'url'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'file'
  | 'json'
  | 'code'

export interface QuickAction {
  /** Action ID */
  id: string

  /** Button label */
  label: string

  /** Button variant */
  variant: 'primary' | 'secondary' | 'danger'

  /** Output value when clicked */
  value: unknown

  /** Confirmation required */
  confirmMessage?: string

  /** Keyboard shortcut */
  shortcut?: string
}

// =============================================================================
// ASSIGNEE CONFIGURATION
// =============================================================================

export interface AssigneeConfig {
  /** Specific user IDs */
  users?: string[]

  /** Team/group IDs */
  teams?: string[]

  /** Role-based assignment */
  roles?: string[]

  /** Auto-assignment rules */
  autoAssign?: AutoAssignRule

  /** Round-robin assignment */
  roundRobin?: boolean
}

export interface AutoAssignRule {
  /** Field to match */
  field: string

  /** Mapping from value to assignee */
  mapping: Record<string, string | string[]>

  /** Default assignee if no match */
  default?: string | string[]
}

// =============================================================================
// REMINDER & ESCALATION
// =============================================================================

export interface ReminderConfig {
  /** When to send first reminder (from creation) */
  firstReminder?: string  // Duration e.g., "1h", "4h"

  /** Reminder interval after first */
  interval?: string

  /** Maximum reminders */
  maxReminders?: number

  /** Reminder channels */
  channels?: ReminderChannel[]
}

export type ReminderChannel = 'email' | 'slack' | 'sms' | 'push'

export interface EscalationConfig {
  /** Escalation tiers */
  tiers: EscalationTier[]

  /** What triggers escalation */
  trigger: 'timeout' | 'rejection' | 'both'
}

export interface EscalationTier {
  /** Time after which to escalate */
  after: string  // Duration

  /** Who to escalate to */
  assignees: AssigneeConfig

  /** Notification message */
  message?: string
}

export interface SLAConfig {
  /** Target response time */
  responseTime: string  // Duration

  /** Target resolution time */
  resolutionTime: string  // Duration

  /** What happens on breach */
  onBreach?: 'notify' | 'escalate' | 'auto-approve' | 'auto-reject'

  /** Notification on approaching breach */
  warningThreshold?: number  // Percentage of time remaining
}

// =============================================================================
// HUMAN FUNCTION CONFIG
// =============================================================================

export interface HumanFunctionConfig {
  /** Override assignees */
  assignees?: AssigneeConfig

  /** Override SLA */
  sla?: Partial<SLAConfig>

  /** Additional context to show */
  additionalContext?: UIContext[]

  /** Pre-fill form values */
  prefillValues?: Record<string, unknown>

  /** Skip (auto-approve) conditions */
  skipConditions?: SkipCondition[]
}

export interface SkipCondition {
  /** Condition field */
  field: string

  /** Operator */
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'matches'

  /** Value to compare */
  value: unknown

  /** Output if condition matches */
  output: unknown
}

// =============================================================================
// HUMAN FUNCTION RESULT
// =============================================================================

export interface HumanFunctionResult<TOutput = unknown>
  extends FunctionResult<TOutput> {
  /** Human-specific execution info */
  humanExecution: HumanExecutionInfo
}

export interface HumanExecutionInfo {
  /** Who responded */
  respondedBy: ResponderInfo

  /** When task was assigned */
  assignedAt: number

  /** When response was received */
  respondedAt: number

  /** Time to respond (ms) */
  responseTimeMs: number

  /** Whether SLA was met */
  slaMet?: boolean

  /** Reminders sent */
  remindersSent: number

  /** Escalations that occurred */
  escalations: EscalationRecord[]

  /** Whether task was skipped (auto-approved) */
  skipped: boolean

  /** Skip reason if skipped */
  skipReason?: string
}

export interface ResponderInfo {
  /** User ID */
  userId: string

  /** User email */
  email?: string

  /** User name */
  name?: string

  /** How they responded */
  channel: 'web' | 'email' | 'slack' | 'api'
}

export interface EscalationRecord {
  /** Escalation tier */
  tier: number

  /** When escalation occurred */
  escalatedAt: number

  /** Who was notified */
  notified: string[]
}

// =============================================================================
// HUMAN FUNCTION EXECUTOR
// =============================================================================

export interface HumanFunctionExecutor<
  TInput = unknown,
  TOutput = unknown,
> extends FunctionExecutor<TInput, TOutput, HumanFunctionConfig> {
  /** Create a task for human */
  createTask(
    definition: HumanFunctionDefinition<TInput, TOutput>,
    input: TInput,
    config?: HumanFunctionConfig
  ): Promise<HumanTask>

  /** Get task status */
  getTask(taskId: string): Promise<HumanTask | null>

  /** Cancel a task */
  cancelTask(taskId: string, reason?: string): Promise<void>
}

export interface HumanTask {
  /** Task ID */
  id: string

  /** Task status */
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'expired'

  /** Current assignee */
  assignee?: ResponderInfo

  /** When created */
  createdAt: number

  /** When expires */
  expiresAt: number

  /** URL to complete task */
  taskUrl: string
}

// =============================================================================
// HELPER: Define a human function
// =============================================================================

export function defineHumanFunction<TInput, TOutput>(
  options: Omit<HumanFunctionDefinition<TInput, TOutput>, 'type'>
): HumanFunctionDefinition<TInput, TOutput> {
  return {
    ...options,
    type: 'human',
    timeout: options.timeout ?? '24h',
  }
}

// =============================================================================
// HELPER: Quick approval function
// =============================================================================

export function approvalFunction<TInput>(
  id: string,
  title: string,
  options?: {
    description?: string
    assignees?: AssigneeConfig
    context?: UIContext[]
    sla?: SLAConfig
  }
): HumanFunctionDefinition<TInput, { approved: boolean; comment?: string }> {
  return defineHumanFunction({
    id,
    name: title,
    version: '1.0.0',
    interactionType: 'approval',
    ui: {
      title,
      description: options?.description,
      context: options?.context,
      quickActions: [
        {
          id: 'approve',
          label: 'Approve',
          variant: 'primary',
          value: { approved: true },
          shortcut: 'a',
        },
        {
          id: 'reject',
          label: 'Reject',
          variant: 'danger',
          value: { approved: false },
          confirmMessage: 'Are you sure you want to reject?',
          shortcut: 'r',
        },
      ],
      form: [
        {
          name: 'comment',
          label: 'Comment',
          type: 'textarea',
          placeholder: 'Optional comment...',
        },
      ],
    },
    assignees: options?.assignees,
    sla: options?.sla,
  })
}

// =============================================================================
// HELPER: Quick input function
// =============================================================================

export function inputFunction<TOutput>(
  id: string,
  title: string,
  form: FormField[],
  options?: {
    description?: string
    assignees?: AssigneeConfig
    context?: UIContext[]
  }
): HumanFunctionDefinition<unknown, TOutput> {
  return defineHumanFunction({
    id,
    name: title,
    version: '1.0.0',
    interactionType: 'input',
    ui: {
      title,
      description: options?.description,
      context: options?.context,
      form,
    },
    assignees: options?.assignees,
  })
}
