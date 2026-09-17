import { describe, expect, it } from 'vitest';
import { createDefaultAdapterRegistry } from '../../src/adapters/adapter-registry.js';
import { ExecutionService } from '../../src/core/execution/execution-service.js';
import { WebAdapter } from '../../src/adapters/web/web-adapter.js';

const healingUrl = new URL('../fixtures/healing-test-page.html', import.meta.url).href;
const ambiguousUrl = new URL('../fixtures/ambiguous-healing-page.html', import.meta.url).href;

describe('WebAdapter deterministic healing', () => {
  it('recovers a changed semantic representation and retries once', async () => {
    const adapter = new WebAdapter();
    const service = new ExecutionService({
      createExecutionId: () => 'healed-execution-001',
      adapterRegistry: createDefaultAdapterRegistry(adapter),
    });

    try {
      service.planExecution({
        id: 'HEAL-001',
        description: 'Recover a changed login label',
        domain: 'web',
        steps: [
          { id: 'STEP-001', action: 'navigate', target: { url: healingUrl } },
          { id: 'STEP-002', action: 'click', target: { role: 'button', semanticLabel: 'Login' } },
          {
            id: 'STEP-003',
            action: 'assert',
            target: { text: 'Welcome' },
            expected: { visible: true },
          },
        ],
      });

      const result = await service.executeExecution('healed-execution-001');
      const state = service.getExecutionState('healed-execution-001');

      expect(result.status).toBe('PASSED');
      expect(result.results[1]).toMatchObject({
        healed: true,
        healing: { status: 'HEALED', retrySucceeded: true },
      });
      expect(state.ok && state.state.telemetry.map((event) => event.type)).toContain(
        'HEALING_SUCCEEDED',
      );
      expect(result.results[1]?.metadata?.screenshotPath).toEqual(expect.any(String));
    } finally {
      await adapter.close();
    }
  }, 30_000);

  it('rejects equally strong candidates without choosing one', async () => {
    const adapter = new WebAdapter();
    const service = new ExecutionService({
      createExecutionId: () => 'ambiguous-execution-001',
      adapterRegistry: createDefaultAdapterRegistry(adapter),
    });

    try {
      service.planExecution({
        id: 'HEAL-002',
        description: 'Reject ambiguous submit buttons',
        domain: 'web',
        steps: [
          { id: 'STEP-001', action: 'navigate', target: { url: ambiguousUrl } },
          { id: 'STEP-002', action: 'click', target: { text: 'Submit' } },
        ],
      });

      const result = await service.executeExecution('ambiguous-execution-001');
      const state = service.getExecutionState('ambiguous-execution-001');

      expect(result.status).toBe('FAILED');
      expect(result.results[0]).toMatchObject({ status: 'PASSED' });
      expect(result.results[1]).toMatchObject({ error: { code: 'AMBIGUOUS_TARGET' } });
      expect(state.ok && state.state.telemetry.map((event) => event.type)).toContain(
        'HEALING_FAILED',
      );
    } finally {
      await adapter.close();
    }
  }, 30_000);

  it('fails safely when no candidate reaches the threshold', async () => {
    const adapter = new WebAdapter();
    const service = new ExecutionService({
      createExecutionId: () => 'low-confidence-execution-001',
      adapterRegistry: createDefaultAdapterRegistry(adapter),
    });

    try {
      service.planExecution({
        id: 'HEAL-003',
        description: 'Reject an unrelated target',
        domain: 'web',
        steps: [
          { id: 'STEP-001', action: 'navigate', target: { url: healingUrl } },
          { id: 'STEP-002', action: 'click', target: { text: 'Delete account' } },
        ],
      });

      const result = await service.executeExecution('low-confidence-execution-001');

      expect(result.status).toBe('FAILED');
      expect(result.results[1]).toMatchObject({ error: { code: 'TARGET_NOT_FOUND' } });
    } finally {
      await adapter.close();
    }
  }, 30_000);
});
