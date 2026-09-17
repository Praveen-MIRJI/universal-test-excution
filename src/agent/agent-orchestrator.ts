import { ExecutionIntentSchema } from '../core/models/index.js';
import { type AgentMcpClient } from './mcp-client.js';
import { type LLMProvider } from './llm-provider.js';

export interface AgentRequest {
  userRequest: string;
  intent?: unknown;
}

export interface AgentExecutionResponse {
  status: 'PASSED' | 'FAILED';
  executionId?: string;
  domain?: string;
  summary: string;
  healed: boolean;
  healingAttempted: boolean;
  failedStep?: string;
  error?: unknown;
  state?: unknown;
  report?: unknown;
  evidence: unknown[];
  artifact?: string;
  iterations: number;
}

export interface AgentOrchestratorOptions {
  maxIterations?: number;
}

export class AgentOrchestrator {
  private readonly maxIterations: number;

  public constructor(
    private readonly client: AgentMcpClient,
    private readonly provider: LLMProvider,
    options: AgentOrchestratorOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? 5;
  }

  public async run(request: AgentRequest): Promise<AgentExecutionResponse> {
    let iterations = 0;
    const intent = request.intent ?? (await this.provider.createNormalizedIntent(request.userRequest));
    const parsedIntent = ExecutionIntentSchema.safeParse(intent);
    if (!parsedIntent.success) {
      return {
        status: 'FAILED',
        summary: 'The request could not be represented as a valid normalized execution intent.',
        healed: false,
        healingAttempted: false,
        error: { code: 'INVALID_EXECUTION_INTENT', details: parsedIntent.error.issues },
        evidence: [],
        iterations,
      };
    }

    const adapters = await this.call(() => this.client.listAvailableAdapters(), () => (iterations += 1));
    const adapterList = asRecord(adapters)?.adapters;
    if (!Array.isArray(adapterList) || !adapterList.some((adapter) => asRecord(adapter)?.name === parsedIntent.data.domain)) {
      return {
        status: 'FAILED',
        domain: parsedIntent.data.domain,
        summary: `No available adapter was found for domain "${parsedIntent.data.domain}".`,
        healed: false,
        healingAttempted: false,
        error: { code: 'ADAPTER_UNAVAILABLE' },
        evidence: [],
        iterations,
      };
    }

    const execution = await this.call(
      () => this.client.executeIntent(parsedIntent.data),
      () => (iterations += 1),
    );
    const executionRecord = asRecord(execution);
    const executionId = stringValue(executionRecord?.executionId);
    if (!executionId) {
      return {
        status: 'FAILED',
        domain: parsedIntent.data.domain,
        summary: 'The MCP execution tool did not return an execution ID.',
        healed: false,
        healingAttempted: false,
        error: execution,
        evidence: [],
        iterations,
      };
    }

    const state = await this.call(() => this.client.getExecutionState(executionId), () => (iterations += 1));
    const evidenceResult = await this.call(() => this.client.getExecutionEvidence(executionId), () => (iterations += 1));
    const report = await this.call(() => this.client.getExecutionReport(executionId), () => (iterations += 1));
    const results = arrayValue(executionRecord?.results);
    const healed = results.some((result) => asRecord(result)?.healed === true);
    const healingAttempted = healed || results.some((result) => asRecord(result)?.healing !== undefined);
    const evidence = arrayValue(asRecord(evidenceResult)?.evidence);
    const artifact = evidence
      .map((item) => asRecord(item))
      .find((item) => item?.type === 'EXECUTION_LOG' && typeof item.path === 'string')?.path as string | undefined;
    const failedStep = arrayValue(asRecord(state)?.stepStates)
      .map((step) => asRecord(step))
      .find((step) => step?.status === 'FAILED')?.stepId as string | undefined;
    const passed = executionRecord?.status === 'PASSED';
    return {
      status: passed ? 'PASSED' : 'FAILED',
      executionId,
      domain: parsedIntent.data.domain,
      summary: passed
        ? healingAttempted
          ? 'Execution passed with deterministic target healing.'
          : 'Execution passed.'
        : failedStep
          ? `Execution failed at step ${failedStep}. Evidence and report were collected.`
          : 'Execution failed. Evidence and report were collected.',
      healed,
      healingAttempted,
      ...(failedStep ? { failedStep } : {}),
      ...(passed ? {} : { error: firstFailure(results) }),
      state,
      report,
      evidence,
      ...(artifact ? { artifact } : {}),
      iterations,
    };
  }

  private async call<T>(operation: () => Promise<T>, increment: () => number): Promise<T> {
    if (increment() > this.maxIterations) {
      throw new Error(`Agent orchestration exceeded the maximum of ${this.maxIterations} iterations.`);
    }
    return operation();
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstFailure(results: unknown[]): unknown {
  return results.map((result) => asRecord(result)).find((result) => result?.error)?.error;
}