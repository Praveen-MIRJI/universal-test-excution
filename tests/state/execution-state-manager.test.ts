import { describe, expect, it } from 'vitest';
import { DeterministicExecutionPlanner } from '../../src/core/execution/execution-plan.js';
import { ExecutionStateManager } from '../../src/state/execution-state-manager.js';

const plan = new DeterministicExecutionPlanner().createPlan(
  {
    id: 'INTENT-001',
    description: 'Run one step',
    domain: 'web',
    steps: [{ id: 'STEP-001', action: 'click', target: { text: 'Submit' } }],
  },
  'execution-001',
  'web',
  '2026-09-16T12:00:00.000Z',
);

describe('ExecutionStateManager', () => {
  it('tracks execution and step lifecycle transitions', () => {
    const manager = new ExecutionStateManager(() => new Date('2026-09-16T12:01:00.000Z'));

    expect(manager.createExecution(plan).status).toBe('CREATED');
    expect(manager.markPlanned('execution-001').status).toBe('PLANNED');
    expect(manager.markRunning('execution-001').status).toBe('RUNNING');
    expect(manager.markStepRunning('execution-001', 'STEP-001').stepStates[0]?.status).toBe(
      'RUNNING',
    );

    const state = manager.recordStepResult('execution-001', {
      stepId: 'STEP-001',
      status: 'PASSED',
      action: 'click',
      durationMs: 12,
    });

    expect(state).toMatchObject({
      completedSteps: ['STEP-001'],
      checkpoint: { currentStepId: 'STEP-001', completedSteps: ['STEP-001'] },
      stepStates: [{ stepId: 'STEP-001', status: 'PASSED', durationMs: 12 }],
    });
    expect(manager.markPassed('execution-001').status).toBe('PASSED');
  });

  it('returns snapshots without exposing mutable internal state', () => {
    const manager = new ExecutionStateManager();
    manager.createExecution(plan);
    const snapshot = manager.getExecution('execution-001');

    snapshot?.completedSteps.push('MUTATED');

    expect(manager.getExecution('execution-001')?.completedSteps).toEqual([]);
  });
});
