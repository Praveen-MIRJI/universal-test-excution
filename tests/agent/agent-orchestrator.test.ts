import { describe, expect, it } from 'vitest';
import { AgentOrchestrator } from '../../src/agent/agent-orchestrator.js';
import { DeterministicMockLLMProvider } from '../../src/agent/llm-provider.js';
import { type AgentMcpClient } from '../../src/agent/mcp-client.js';

const intent = {
  id: 'AGENT-001',
  description: 'Run a web check',
  domain: 'web',
  steps: [{ id: 'STEP-001', action: 'click' as const, target: { text: 'Submit' } }],
};

class FakeMcpClient implements AgentMcpClient {
  public calls: string[] = [];
  public constructor(private readonly result: Record<string, unknown>) {}
  public async listAvailableAdapters() { this.calls.push('list_available_adapters'); return { adapters: [{ name: 'web', status: 'available' }] }; }
  public async executeIntent() { this.calls.push('execute_intent'); return this.result; }
  public async getExecutionState() { this.calls.push('get_execution_state'); return { status: this.result.status, stepStates: [] }; }
  public async getExecutionEvidence() { this.calls.push('get_execution_evidence'); return { evidence: [{ type: 'EXECUTION_LOG', path: 'artifacts/playwright-test.spec.ts' }] }; }
  public async getExecutionReport() { this.calls.push('get_execution_report'); return { executionId: 'execution-001', summary: { total: 1 } }; }
  public async close() {}
}

describe('AgentOrchestrator', () => {
  it('uses MCP tools for successful execution and reports evidence', async () => {
    const client = new FakeMcpClient({
      executionId: 'execution-001',
      status: 'PASSED',
      results: [{ stepId: 'STEP-001', status: 'PASSED', healed: false }],
    });
    const agent = new AgentOrchestrator(
      client,
      new DeterministicMockLLMProvider(() => intent),
    );

    const result = await agent.run({ userRequest: 'Run the web check.' });

    expect(result).toMatchObject({ status: 'PASSED', executionId: 'execution-001', healed: false, artifact: 'artifacts/playwright-test.spec.ts' });
    expect(client.calls).toEqual([
      'list_available_adapters',
      'execute_intent',
      'get_execution_state',
      'get_execution_evidence',
      'get_execution_report',
    ]);
  });

  it('reports healed execution transparently and does not retry failures', async () => {
    const client = new FakeMcpClient({
      executionId: 'execution-002',
      status: 'PASSED',
      results: [{ stepId: 'STEP-001', status: 'PASSED', healed: true, healing: { confidence: 0.8 } }],
    });
    const agent = new AgentOrchestrator(client, new DeterministicMockLLMProvider(() => intent));

    const result = await agent.run({ userRequest: 'Run the web check.' });

    expect(result).toMatchObject({ status: 'PASSED', healed: true, healingAttempted: true });
    expect(client.calls.filter((call) => call === 'execute_intent')).toHaveLength(1);
  });

  it('returns failed execution details without blindly retrying', async () => {
    const client = new FakeMcpClient({
      executionId: 'execution-003',
      status: 'FAILED',
      results: [{ stepId: 'STEP-001', status: 'FAILED', error: { code: 'ASSERTION_FAILED', message: 'No match.' } }],
    });
    const agent = new AgentOrchestrator(client, new DeterministicMockLLMProvider(() => intent));

    const result = await agent.run({ userRequest: 'Run the web check.' });

    expect(result).toMatchObject({ status: 'FAILED', error: { code: 'ASSERTION_FAILED' } });
    expect(client.calls.filter((call) => call === 'execute_intent')).toHaveLength(1);
  });

  it('rejects invalid generated intents and enforces the iteration bound', async () => {
    const client = new FakeMcpClient({ executionId: 'execution-004', status: 'PASSED', results: [] });
    const invalidAgent = new AgentOrchestrator(client, new DeterministicMockLLMProvider(() => ({ nope: true })));
    expect((await invalidAgent.run({ userRequest: 'Missing details' })).status).toBe('FAILED');

    const boundedAgent = new AgentOrchestrator(client, new DeterministicMockLLMProvider(() => intent), { maxIterations: 2 });
    await expect(boundedAgent.run({ userRequest: 'Run it' })).rejects.toThrow('maximum of 2 iterations');
  });
});
