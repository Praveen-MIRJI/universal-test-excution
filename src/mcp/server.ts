import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  createDefaultAdapterRegistry,
  type AdapterRegistry,
} from '../adapters/adapter-registry.js';
import { WebAdapter } from '../adapters/web/web-adapter.js';
import { ApiAdapter } from '../adapters/api/api-adapter.js';
import { ExecutionService } from '../core/execution/execution-service.js';
import { registerExecuteIntentTool } from './tools/execute-intent.js';
import { registerGetExecutionStateTool } from './tools/get-execution-state.js';
import { registerListAvailableAdaptersTool } from './tools/list-available-adapters.js';
import { registerGetExecutionEvidenceTool } from './tools/get-execution-evidence.js';
import { registerGetExecutionReportTool } from './tools/get-execution-report.js';

export interface McpServerDependencies {
  executionService?: ExecutionService;
  adapterRegistry?: AdapterRegistry;
}

export function createMcpServer(dependencies: McpServerDependencies = {}): McpServer {
  const adapterRegistry =
    dependencies.adapterRegistry ??
    createDefaultAdapterRegistry(new WebAdapter(), new ApiAdapter());
  const executionService =
    dependencies.executionService ?? new ExecutionService({ adapterRegistry });
  const server = new McpServer({
    name: 'universal-test-execution',
    version: '0.1.0',
  });

  registerExecuteIntentTool(server, executionService);
  registerGetExecutionStateTool(server, executionService);
  registerListAvailableAdaptersTool(server, adapterRegistry);
  registerGetExecutionEvidenceTool(server, executionService);
  registerGetExecutionReportTool(server, executionService);

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown MCP server error';
    console.error(`MCP server failed to start: ${message}`);
    process.exitCode = 1;
  });
}
