import { describe, expect, it } from 'vitest';
import { ExecutionService } from '../../../src/core/execution/execution-service.js';
import { AdapterRegistry } from '../../../src/adapters/adapter-registry.js';

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
  ],
};

describe('ExecutionService', () => {
  it('plans a valid intent with a generated execution id', () => {
    const service = new ExecutionService({
      createExecutionId: () => 'execution-001',
      now: () => new Date('2026-09-10T12:00:00.000Z'),
    });

    const result = service.planExecution(intent);

    expect(result).toMatchObject({
      ok: true,
      state: {
        executionId: 'execution-001',
        status: 'PLANNED',
        intent,
        plan: intent.steps,
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
        executionPlan: {
          executionId: 'execution-001',
          domain: 'web',
          adapterName: 'web',
          status: 'PLANNED',
          steps: intent.steps,
        },
        completedSteps: [],
        stepStates: [{ stepId: 'STEP-001', status: 'PENDING' }],
        results: [],
      },
    });
  });

  it('rejects invalid intents without storing them', () => {
    const service = new ExecutionService({ createExecutionId: () => 'execution-001' });

    const result = service.planExecution({ ...intent, steps: [] });

    expect(result.ok).toBe(false);
    expect(service.getExecutionState('execution-001').ok).toBe(false);
  });

  it('returns an existing execution state', () => {
    const service = new ExecutionService({ createExecutionId: () => 'execution-001' });
    service.planExecution(intent);

    const result = service.getExecutionState('execution-001');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe('PLANNED');
      expect(result.state.plan).toHaveLength(1);
    }
  });

  it('executes ordered steps through the registered adapter', async () => {
    const executed: string[] = [];
    const adapter = {
      name: 'web',
      execute: async (step: (typeof intent.steps)[number]) => {
        executed.push(step.id);
        return { stepId: step.id, status: 'PASSED' as const, action: step.action, durationMs: 1 };
      },
      close: async () => undefined,
    };
    const service = new ExecutionService({
      createExecutionId: () => 'execution-001',
      adapterRegistry: new AdapterRegistry([
        { descriptor: { name: 'web', status: 'available', framework: 'test' }, adapter },
      ]),
    });
    service.planExecution(intent);

    const result = await service.executeExecution('execution-001');

    expect(result.status).toBe('PASSED');
    expect(result).toMatchObject({ totalSteps: 1, passed: 1, failed: 0, durationMs: 1 });
    expect(executed).toEqual(['STEP-001']);
  });

  it('stops on a failed adapter result and records the failure', async () => {
    const service = new ExecutionService({
      createExecutionId: () => 'execution-001',
      adapterRegistry: new AdapterRegistry([
        {
          descriptor: { name: 'web', status: 'available', framework: 'test' },
          adapter: {
            name: 'web',
            execute: async (step: (typeof intent.steps)[number]) => ({
              stepId: step.id,
              status: 'FAILED' as const,
              action: step.action,
              durationMs: 2,
              error: { code: 'TARGET_NOT_FOUND' as const, message: 'Target not found.' },
            }),
            close: async () => undefined,
          },
        },
      ]),
    });
    service.planExecution(intent);

    const result = await service.executeExecution('execution-001');

    expect(result).toMatchObject({
      status: 'FAILED',
      totalSteps: 1,
      passed: 0,
      failed: 1,
      results: [{ error: { code: 'TARGET_NOT_FOUND' } }],
    });
  });

  it('returns a structured failure for an unsupported domain', async () => {
    const service = new ExecutionService({
      createExecutionId: () => 'execution-001',
      adapterRegistry: new AdapterRegistry(),
    });
    service.planExecution({ ...intent, domain: 'api' });

    const result = await service.executeExecution('execution-001');

    expect(result).toMatchObject({
      status: 'FAILED',
      error: { code: 'UNSUPPORTED_APPLICATION' },
    });
  });

  it('returns a structured error for an unknown execution', () => {
    const result = new ExecutionService().getExecutionState('missing-execution');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'EXECUTION_NOT_FOUND',
        message: 'No execution exists with id "missing-execution".',
      },
    });
  });

  it('executes web and api domains through the same generic service', async () => {
    const executedDomains: string[] = [];
    const registry = new AdapterRegistry([
      {
        descriptor: { name: 'web', status: 'available', framework: 'test' },
        adapter: {
          name: 'web',
          execute: async (step: (typeof intent.steps)[number]) => {
            executedDomains.push('web');
            return {
              stepId: step.id,
              status: 'PASSED' as const,
              action: step.action,
              durationMs: 1,
            };
          },
          close: async () => undefined,
        },
      },
      {
        descriptor: { name: 'api', status: 'available', framework: 'test' },
        adapter: {
          name: 'api',
          execute: async (step: (typeof intent.steps)[number]) => {
            executedDomains.push('api');
            return {
              stepId: step.id,
              status: 'PASSED' as const,
              action: step.action,
              durationMs: 1,
            };
          },
          close: async () => undefined,
        },
      },
    ]);
    const service = new ExecutionService({
      createExecutionId: (() => {
        let count = 0;
        return () => `execution-${++count}`;
      })(),
      adapterRegistry: registry,
    });

    service.planExecution(intent);
    service.planExecution({ ...intent, id: 'INTENT-API', domain: 'api' });
    await service.executeExecution('execution-1');
    await service.executeExecution('execution-2');

    expect(executedDomains).toEqual(['web', 'api']);
  });
});
