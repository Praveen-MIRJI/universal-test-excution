import { describe, expect, it } from 'vitest';
import { createDefaultAdapterRegistry } from '../../../src/adapters/adapter-registry.js';
import { ApiAdapter } from '../../../src/adapters/api/api-adapter.js';
import { ExecutionService } from '../../../src/core/execution/execution-service.js';
import { handleExecuteIntent } from '../../../src/mcp/tools/execute-intent.js';
import { handleGetExecutionState } from '../../../src/mcp/tools/get-execution-state.js';
import { handleListAvailableAdapters } from '../../../src/mcp/tools/list-available-adapters.js';
import { createMcpServer } from '../../../src/mcp/server.js';
import { AdapterRegistry } from '../../../src/adapters/adapter-registry.js';

const passingAdapter = {
  name: 'web',
  execute: async (step: (typeof intent.steps)[number]) => ({
    stepId: step.id,
    status: 'PASSED' as const,
    action: step.action,
    durationMs: 1,
  }),
  close: async () => undefined,
};

const intent = {
  id: 'INTENT-001',
  description: 'Create an employee',
  domain: 'web',
  steps: [
    {
      id: 'STEP-001',
      action: 'click' as const,
      target: { semanticLabel: 'Add Employee button' },
    },
    {
      id: 'STEP-002',
      action: 'assert' as const,
      target: { text: 'Employee created' },
      expected: { visible: true },
    },
  ],
};

describe('MCP tool application handlers', () => {
  it('registers exactly the three initial MCP tools', () => {
    const server = createMcpServer();

    expect(
      ['execute_intent', 'get_execution_state', 'list_available_adapters'].map((name) =>
        server.toolInputSchemaJson(name),
      ),
    ).not.toContain(undefined);
  });

  it('returns an executed response for a valid intent', async () => {
    const service = new ExecutionService({
      createExecutionId: () => 'execution-001',
      adapterRegistry: new AdapterRegistry([
        {
          descriptor: { name: 'web', status: 'available', framework: 'test' },
          adapter: passingAdapter,
        },
      ]),
    });

    const response = await handleExecuteIntent(service, intent);

    expect(response.structuredContent).toMatchObject({
      executionId: 'execution-001',
      status: 'PASSED',
      intent,
      plan: intent.steps,
      executionPlan: {
        executionId: 'execution-001',
        adapterName: 'web',
        domain: 'web',
        status: 'PLANNED',
      },
      totalSteps: 2,
      passed: 2,
      failed: 0,
      results: [
        {
          stepId: 'STEP-001',
          status: 'PASSED',
          action: 'click',
        },
        {
          stepId: 'STEP-002',
          status: 'PASSED',
          action: 'assert',
        },
      ],
    });
    expect(response.isError).toBeUndefined();
  });

  it('returns a structured error for an invalid intent', async () => {
    const response = await handleExecuteIntent(new ExecutionService(), {
      ...intent,
      action: 'bad',
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      error: { code: 'INVALID_EXECUTION_INTENT' },
    });
  });

  it('returns existing and unknown execution states', async () => {
    const service = new ExecutionService({
      createExecutionId: () => 'execution-001',
      adapterRegistry: new AdapterRegistry([
        {
          descriptor: { name: 'web', status: 'available', framework: 'test' },
          adapter: passingAdapter,
        },
      ]),
    });
    await handleExecuteIntent(service, intent);

    const existing = handleGetExecutionState(service, { executionId: 'execution-001' });
    const unknown = handleGetExecutionState(service, { executionId: 'missing-execution' });

    expect(existing.structuredContent).toMatchObject({
      executionId: 'execution-001',
      status: 'PASSED',
    });
    expect(
      (existing.structuredContent as { telemetry: { type: string }[] }).telemetry.map(
        (event) => event.type,
      ),
    ).toEqual([
      'EXECUTION_CREATED',
      'EXECUTION_PLANNED',
      'EXECUTION_STARTED',
      'STEP_STARTED',
      'STEP_PASSED',
      'STEP_STARTED',
      'STEP_PASSED',
      'EXECUTION_PASSED',
    ]);
    expect(unknown).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'EXECUTION_NOT_FOUND' } },
    });
  });

  it('lists the available web adapter with the generic registry shape', () => {
    const response = handleListAvailableAdapters(createDefaultAdapterRegistry(passingAdapter));

    expect(response.structuredContent).toEqual({
      adapters: [{ name: 'web', status: 'available', framework: 'playwright' }],
    });
  });

  it('lists both genuinely implemented web and api adapters', () => {
    const response = handleListAvailableAdapters(
      createDefaultAdapterRegistry(passingAdapter, new ApiAdapter()),
    );

    expect(response.structuredContent).toEqual({
      adapters: [
        { name: 'web', status: 'available', framework: 'playwright' },
        { name: 'api', status: 'available', framework: 'fetch' },
      ],
    });
  });
});
