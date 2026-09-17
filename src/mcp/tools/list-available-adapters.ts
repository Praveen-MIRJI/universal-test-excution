import { z } from 'zod';
import { type AdapterRegistry } from '../../adapters/adapter-registry.js';
import { createToolResult, toolOutputSchema } from './tool-result.js';
import { type McpServer } from '@modelcontextprotocol/server';

export function handleListAvailableAdapters(registry: AdapterRegistry) {
  return createToolResult({ adapters: registry.list() });
}

export function registerListAvailableAdaptersTool(
  server: McpServer,
  registry: AdapterRegistry,
): void {
  server.registerTool(
    'list_available_adapters',
    {
      description: 'List the execution adapters currently registered with the system.',
      inputSchema: z.object({}),
      outputSchema: toolOutputSchema,
    },
    async () => handleListAvailableAdapters(registry),
  );
}
