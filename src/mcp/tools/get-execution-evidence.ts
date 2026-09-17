import { z } from 'zod';
import { type ExecutionService } from '../../core/execution/execution-service.js';
import { createToolResult, toolOutputSchema } from './tool-result.js';
import { type McpServer } from '@modelcontextprotocol/server';

export const getExecutionEvidenceInputSchema = z.object({ executionId: z.string().trim().min(1) });

export function registerGetExecutionEvidenceTool(server: McpServer, service: ExecutionService): void {
  server.registerTool(
    'get_execution_evidence',
    {
      description: 'Return serializable evidence references and metadata for an execution.',
      inputSchema: getExecutionEvidenceInputSchema,
      outputSchema: toolOutputSchema,
    },
    async (input) => {
      const parsed = getExecutionEvidenceInputSchema.safeParse(input);
      if (!parsed.success) {
        return createToolResult({ error: { code: 'INVALID_INPUT', message: 'executionId must be a non-empty string.' } }, true);
      }
      return createToolResult({ executionId: parsed.data.executionId, evidence: service.getExecutionEvidence(parsed.data.executionId) });
    },
  );
}