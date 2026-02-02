/**
 * E2E Tests: Human Function Form Input
 *
 * Tests for form input handling, callback completion, and task cancellation.
 */

import { describe, it, expect, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  generateTestFunctionId,
  shouldRunE2E,
  deleteFunction,
} from './config'
import {
  deployHumanFunction,
  invokeHumanFunction,
  getTaskStatus,
  submitTaskResponse,
  cancelTask,
  FormResponse,
  HUMAN_DEPLOY_TIMEOUT,
  HUMAN_INVOKE_TIMEOUT,
  HUMAN_FULL_FLOW_TIMEOUT,
} from './helpers/human'

describe.skipIf(!shouldRunE2E())('E2E: Human Function Forms', () => {
  const deployedFunctions: string[] = []
  const createdTasks: string[] = []

  afterAll(async () => {
    if (!E2E_CONFIG.skipCleanup) {
      for (const taskId of createdTasks) {
        try {
          await cancelTask(taskId)
        } catch {
          // Ignore cleanup errors
        }
      }

      for (const functionId of deployedFunctions) {
        try {
          await deleteFunction(functionId)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  })

  // ============================================================================
  // Callback Completion
  // ============================================================================

  describe('Callback Completion', () => {
    it('completes task when response is submitted', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Completion Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      await submitTaskResponse(invokeResult.taskId, {
        approved: true,
        comment: 'Looks good!',
      })

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect(finalStatus.completedAt).toBeDefined()
      expect(finalStatus.response).toEqual({
        approved: true,
        comment: 'Looks good!',
      })
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('stores response data correctly', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Response Data Test',
          form: [
            { name: 'field1', type: 'text', required: true },
            { name: 'field2', type: 'number', required: false },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const responseData = {
        field1: 'test value',
        field2: 42,
        nested: { a: 1, b: 2 },
        array: [1, 2, 3],
      }

      await submitTaskResponse(invokeResult.taskId, responseData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect(finalStatus.response).toEqual(responseData)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects response submission for already completed task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Double Submit Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      await submitTaskResponse(invokeResult.taskId, { approved: true })

      await expect(
        submitTaskResponse(invokeResult.taskId, { approved: false })
      ).rejects.toThrow(/already.*completed|cannot.*respond/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects response submission for non-existent task', async () => {
      await expect(
        submitTaskResponse('non-existent-task-id', { data: 'test' })
      ).rejects.toThrow(/404|not found/i)
    }, HUMAN_INVOKE_TIMEOUT)
  })

  // ============================================================================
  // Form Input
  // ============================================================================

  describe('Form Input', () => {
    it('accepts form data submission', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Contact Form',
          description: 'Please fill out your contact information',
          form: [
            { name: 'firstName', type: 'text', label: 'First Name', required: true },
            { name: 'lastName', type: 'text', label: 'Last Name', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'phone', type: 'text', label: 'Phone', required: false },
            { name: 'message', type: 'textarea', label: 'Message', required: true },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '+1-555-123-4567',
          message: 'I would like to learn more about your services.',
        },
        submittedBy: 'john.doe@example.com',
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)

      expect(finalStatus.status).toBe('completed')
      expect((finalStatus.response as FormResponse).data.firstName).toBe('John')
      expect((finalStatus.response as FormResponse).data.email).toBe('john.doe@example.com')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('validates required form fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Required Fields Test',
          form: [
            { name: 'required1', type: 'text', label: 'Required Field 1', required: true },
            { name: 'required2', type: 'text', label: 'Required Field 2', required: true },
            { name: 'optional', type: 'text', label: 'Optional Field', required: false },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const incompleteData: FormResponse = {
        data: {
          required1: 'value1',
          optional: 'optional value',
        },
      }

      await expect(
        submitTaskResponse(invokeResult.taskId, incompleteData)
      ).rejects.toThrow(/required|missing|validation/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles select field with options', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Survey Form',
          form: [
            {
              name: 'department',
              type: 'select',
              label: 'Department',
              required: true,
              options: [
                { label: 'Engineering', value: 'eng' },
                { label: 'Marketing', value: 'mkt' },
                { label: 'Sales', value: 'sales' },
                { label: 'Support', value: 'support' },
              ],
            },
            {
              name: 'experience',
              type: 'select',
              label: 'Years of Experience',
              options: [
                { label: '0-2 years', value: 'junior' },
                { label: '3-5 years', value: 'mid' },
                { label: '6+ years', value: 'senior' },
              ],
            },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          department: 'eng',
          experience: 'senior',
        },
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.department).toBe('eng')
      expect((finalStatus.response as FormResponse).data.experience).toBe('senior')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles checkbox fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Preferences',
          form: [
            { name: 'newsletter', type: 'checkbox', label: 'Subscribe to newsletter' },
            { name: 'terms', type: 'checkbox', label: 'Accept terms and conditions', required: true },
            { name: 'marketing', type: 'checkbox', label: 'Receive marketing emails' },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          newsletter: true,
          terms: true,
          marketing: false,
        },
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.newsletter).toBe(true)
      expect((finalStatus.response as FormResponse).data.terms).toBe(true)
      expect((finalStatus.response as FormResponse).data.marketing).toBe(false)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles date fields', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Schedule Meeting',
          form: [
            { name: 'date', type: 'date', label: 'Meeting Date', required: true },
            { name: 'notes', type: 'textarea', label: 'Meeting Notes' },
          ],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const formData: FormResponse = {
        data: {
          date: '2025-06-15',
          notes: 'Quarterly review meeting',
        },
      }

      await submitTaskResponse(invokeResult.taskId, formData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.date).toBe('2025-06-15')
    }, HUMAN_FULL_FLOW_TIMEOUT)
  })

  // ============================================================================
  // Task Cancellation
  // ============================================================================

  describe('Task Cancellation', () => {
    it('cancels a pending task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Cancellation Test',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)

      await cancelTask(invokeResult.taskId)

      const taskStatus = await getTaskStatus(invokeResult.taskId)

      expect(taskStatus.status).toBe('cancelled')
      expect(taskStatus.cancelledAt).toBeDefined()
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects cancellation of completed task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Already Completed',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)

      await submitTaskResponse(invokeResult.taskId, { approved: true })

      await expect(cancelTask(invokeResult.taskId)).rejects.toThrow(
        /already.*completed|cannot.*cancel/i
      )
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('rejects response submission to cancelled task', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Submit to Cancelled',
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)

      await cancelTask(invokeResult.taskId)

      await expect(
        submitTaskResponse(invokeResult.taskId, { approved: true })
      ).rejects.toThrow(/cancelled|cannot.*respond/i)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('returns 404 when cancelling non-existent task', async () => {
      await expect(cancelTask('non-existent-task-id')).rejects.toThrow(/404|not found/i)
    }, HUMAN_INVOKE_TIMEOUT)
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles special characters in UI text', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Special "Characters" & <Tags>',
          description: "It's a test with `code` and emoji test",
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const taskStatus = await getTaskStatus(invokeResult.taskId)
      expect(taskStatus.ui.title).toBe('Special "Characters" & <Tags>')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles unicode in form data', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Unicode Test',
          form: [{ name: 'message', type: 'textarea', required: true }],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const unicodeData: FormResponse = {
        data: {
          message: 'Hello in Japanese: Konnichiwa. Hello in Chinese: Ni hao. Hello in Arabic: Marhaba',
        },
      }

      await submitTaskResponse(invokeResult.taskId, unicodeData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.message).toContain('Konnichiwa')
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles large response data', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'input',
        ui: {
          title: 'Large Data Test',
          form: [{ name: 'content', type: 'textarea', required: true }],
        },
      })

      const invokeResult = await invokeHumanFunction(functionId)
      createdTasks.push(invokeResult.taskId)

      const largeContent = 'x'.repeat(100 * 1024)
      const largeData: FormResponse = {
        data: {
          content: largeContent,
        },
      }

      await submitTaskResponse(invokeResult.taskId, largeData)

      const finalStatus = await getTaskStatus(invokeResult.taskId)
      expect((finalStatus.response as FormResponse).data.content).toHaveLength(100 * 1024)
    }, HUMAN_FULL_FLOW_TIMEOUT)

    it('handles concurrent task operations', async () => {
      const functionId = generateTestFunctionId()
      deployedFunctions.push(functionId)

      await deployHumanFunction({
        id: functionId,
        interactionType: 'approval',
        ui: {
          title: 'Concurrent Test',
        },
      })

      const invokePromises = Array.from({ length: 5 }, (_, i) =>
        invokeHumanFunction(functionId, { index: i })
      )

      const results = await Promise.all(invokePromises)
      results.forEach((r) => createdTasks.push(r.taskId))

      const taskIds = results.map((r) => r.taskId)
      expect(new Set(taskIds).size).toBe(5)

      const completePromises = results.map((r, i) =>
        submitTaskResponse(r.taskId, { approved: i % 2 === 0 })
      )

      await Promise.all(completePromises)

      const statusPromises = results.map((r) => getTaskStatus(r.taskId))
      const statuses = await Promise.all(statusPromises)

      statuses.forEach((status) => {
        expect(status.status).toBe('completed')
      })
    }, HUMAN_FULL_FLOW_TIMEOUT * 2)
  })
})
