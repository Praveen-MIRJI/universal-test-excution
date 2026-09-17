import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createStdioAgentMcpClient } from '../../src/agent/mcp-client.js';
import { AgentOrchestrator } from '../../src/agent/agent-orchestrator.js';
import { DeterministicMockLLMProvider } from '../../src/agent/llm-provider.js';

const webUrl = new URL('../fixtures/web-test-page.html', import.meta.url).href;

async function createClient() {
  return createStdioAgentMcpClient({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/mcp/server.ts'],
    cwd: process.cwd(),
    stderr: 'ignore',
  });
}

describe('Agent to MCP integration', () => {
  it('executes a Web intent through the real stdio MCP boundary', async () => {
    const client = await createClient();
    try {
      const agent = new AgentOrchestrator(
        client,
        new DeterministicMockLLMProvider(() => ({
          id: 'AGENT-WEB-001',
          description: 'Submit the local form',
          domain: 'web',
          steps: [
            { id: 'STEP-001', action: 'navigate', target: { url: webUrl } },
            { id: 'STEP-002', action: 'click', target: { role: 'button', semanticLabel: 'Submit' } },
            { id: 'STEP-003', action: 'assert', target: { text: 'Submitted successfully' }, expected: { visible: true } },
          ],
        })),
      );

      const result = await agent.run({ userRequest: 'Run the local web form test.' });

      expect(result.status).toBe('PASSED');
      expect(result.executionId).toBeDefined();
      expect(result.report).toBeDefined();
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.artifact).toContain('playwright-test.spec.ts');
    } finally {
      await client.close();
    }
  }, 45_000);

  it('executes an API intent through the same MCP boundary', async () => {
    const server: Server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true, name: 'local-api' }));
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('API fixture did not start.');

    const client = await createClient();
    try {
      const agent = new AgentOrchestrator(
        client,
        new DeterministicMockLLMProvider(() => ({
          id: 'AGENT-API-001',
          description: 'Check the local API',
          domain: 'api',
          steps: [{ id: 'STEP-001', action: 'request', target: { url: `http://127.0.0.1:${address.port}/health`, method: 'GET' }, expected: { status: 200, bodyField: { path: 'name', equals: 'local-api' } } }],
        })),
      );

      const result = await agent.run({ userRequest: 'Run the local API health test.' });

      expect(result.status).toBe('PASSED');
      expect(result.report).toBeDefined();
      expect(result.evidence.map((item) => (item as { type?: string }).type)).toContain('REQUEST');
      expect(result.evidence.map((item) => (item as { type?: string }).type)).toContain('RESPONSE');
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    }
  }, 45_000);
});
