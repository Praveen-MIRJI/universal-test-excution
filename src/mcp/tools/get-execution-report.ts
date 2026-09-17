import { z } from 'zod';
import { type ExecutionService } from '../../core/execution/execution-service.js';
import { createToolResult, toolOutputSchema } from './tool-result.js';
import { type McpServer } from '@modelcontextprotocol/server';

export const getExecutionReportInputSchema = z.object({ executionId: z.string().trim().min(1) });

export function registerGetExecutionReportTool(server: McpServer, service: ExecutionService): void {
  server.registerTool(
    'get_execution_report',
    {
      description: 'Return the generated JSON execution report and local report references.',
      inputSchema: getExecutionReportInputSchema,
      outputSchema: toolOutputSchema,
    },
    async (input) => {
      const parsed = getExecutionReportInputSchema.safeParse(input);
      if (!parsed.success) {
        return createToolResult({ error: { code: 'INVALID_INPUT', message: 'executionId must be a non-empty string.' } }, true);
      }
      const report = service.getExecutionReport(parsed.data.executionId);
      if (!report) {
        return createToolResult({ error: { code: 'EXECUTION_REPORT_NOT_FOUND', message: 'No generated report exists for this execution.' } }, true);
      }
      return createToolResult(report);
    },
  );
}