import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio';

export interface AgentMcpClient {
  listAvailableAdapters(): Promise<unknown>;
  executeIntent(intent: unknown): Promise<unknown>;
  getExecutionState(executionId: string): Promise<unknown>;
  getExecutionEvidence(executionId: string): Promise<unknown>;
  getExecutionReport(executionId: string): Promise<unknown>;
  close(): Promise<void>;
}

export class SdkMcpClient implements AgentMcpClient {
  private readonly client: Client;

  public constructor(client: Client = new Client({ name: 'universal-test-execution-agent', version: '0.1.0' })) {
    this.client = client;
  }

  public async connect(transport: Parameters<Client['connect']>[0]): Promise<void> {
    await this.client.connect(transport);
  }

  public listAvailableAdapters(): Promise<unknown> {
    return this.call('list_available_adapters', {});
  }

  public executeIntent(intent: unknown): Promise<unknown> {
    return this.call('execute_intent', intent);
  }

  public getExecutionState(executionId: string): Promise<unknown> {
    return this.call('get_execution_state', { executionId });
  }

  public getExecutionEvidence(executionId: string): Promise<unknown> {
    return this.call('get_execution_evidence', { executionId });
  }

  public getExecutionReport(executionId: string): Promise<unknown> {
    return this.call('get_execution_report', { executionId });
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private async call(name: string, args: unknown): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args as Record<string, unknown> });
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = result.content.find((item) => item.type === 'text');
    return text?.type === 'text' ? JSON.parse(text.text) : result;
  }
}

export async function createStdioAgentMcpClient(
  server: StdioServerParameters = { command: 'node', args: ['dist/mcp/server.js'] },
): Promise<SdkMcpClient> {
  const client = new SdkMcpClient();
  await client.connect(new StdioClientTransport(server));
  return client;
}