import { z } from 'zod';
import { type ExecutionService } from '../../core/execution/execution-service.js';
import { createToolResult, toolOutputSchema, type StructuredToolResult } from './tool-result.js';
import { type ToolErrorResponse } from './execute-intent.js';
import { type McpServer } from '@modelcontextprotocol/server';

export const getExecutionStateInputSchema = z.object({
  executionId: z.string().trim().min(1),
});

export function handleGetExecutionState(
  service: ExecutionService,
  input: unknown,
): StructuredToolResult<unknown> {
  const parsedInput = getExecutionStateInputSchema.safeParse(input);

  if (!parsedInput.success) {
    const error: ToolErrorResponse = {
      error: {
        code: 'INVALID_INPUT',
        message: 'executionId must be a non-empty string.',
        details: parsedInput.error.issues,
      },
    };
    return createToolResult(error, true);
  }

  const result = service.getExecutionState(parsedInput.data.executionId);

  if (!result.ok) {
    return createToolResult({ error: result.error }, true);
  }

  return createToolResult(result.state);
}

export function registerGetExecutionStateTool(server: McpServer, service: ExecutionService): void {
  server.registerTool(
    'get_execution_state',
    {
      description:
        'Return the serializable execution state, step statuses, checkpoints, and telemetry.',
      inputSchema: getExecutionStateInputSchema,
      outputSchema: toolOutputSchema,
    },
    async (input) => handleGetExecutionState(service, input),
  );
}
