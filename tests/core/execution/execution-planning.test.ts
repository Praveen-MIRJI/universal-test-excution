import { describe, expect, it } from 'vitest';
import {
  DeterministicExecutionPlanner,
  type ExecutionPlanner,
} from '../../../src/core/execution/execution-plan.js';

const intent = {
  id: 'INTENT-001',
  description: 'Submit a form',
  domain: 'web',
  steps: [
    { id: 'STEP-001', action: 'navigate' as const, target: { url: 'file:///test.html' } },
    { id: 'STEP-002', action: 'click' as const, target: { text: 'Submit' } },
  ],
};

describe('DeterministicExecutionPlanner', () => {
  it('creates an explicit plan without changing step order', () => {
    const planner: ExecutionPlanner = new DeterministicExecutionPlanner();

    const plan = planner.createPlan(intent, 'execution-001', 'web', '2026-09-16T12:00:00.000Z');

    expect(plan).toEqual({
      executionId: 'execution-001',
      intent,
      domain: 'web',
      adapterName: 'web',
      steps: intent.steps,
      status: 'PLANNED',
      createdAt: '2026-09-16T12:00:00.000Z',
    });
  });
});
