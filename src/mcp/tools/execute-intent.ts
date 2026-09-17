import { z } from 'zod';
import { ExecutionIntentSchema } from '../../core/models/index.js';
import {
  type ExecutionService,
  type ExecutionStatus,
} from '../../core/execution/execution-service.js';
import { createToolResult, toolOutputSchema, type StructuredToolResult } from './tool-result.js';
import { type McpServer } from '@modelcontextprotocol/server';

export const executeIntentInputSchema = ExecutionIntentSchema;

export interface ExecuteIntentResponse {
  executionId: string;
  status: ExecutionStatus;
  intent: z.infer<typeof ExecutionIntentSchema>;
  plan: z.infer<typeof ExecutionIntentSchema>['steps'];
  executionPlan: ReturnType<ExecutionService['getExecutionPlan']>;
  timestamp: string;
  totalSteps: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: Awaited<ReturnType<ExecutionService['executeExecution']>> extends infer Result
    ? Result extends { results: infer StepResults }
      ? StepResults
      : never
    : never;
}

export interface ToolErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export async function handleExecuteIntent(
  service: ExecutionService,
  input: unknown,
): Promise<StructuredToolResult<ExecuteIntentResponse | ToolErrorResponse>> {
  const result = service.planExecution(input);

  if (!result.ok) {
    return createToolResult({ error: result.error }, true);
  }

  try {
    const execution = await service.executeExecution(result.state.executionId);
    return createToolResult({
      executionId: execution.executionId,
      status: execution.status,
      intent: result.state.intent,
      plan: result.state.plan,
      executionPlan: service.getExecutionPlan(execution.executionId),
      timestamp: result.state.createdAt,
      totalSteps: execution.totalSteps,
      passed: execution.passed,
      failed: execution.failed,
      durationMs: execution.durationMs,
      results: execution.results,
    });
  } catch (error: unknown) {
    return createToolResult(
      {
        error: {
          code: 'EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Execution failed.',
        },
      },
      true,
    );
  }
}

export function registerExecuteIntentTool(server: McpServer, service: ExecutionService): void {
  server.registerTool(
    'execute_intent',
    {
      description: 'Validate and execute a normalized test intent through its registered adapter.',
      inputSchema: executeIntentInputSchema,
      outputSchema: toolOutputSchema,
    },
    async (input) => handleExecuteIntent(service, input),
  );
}
