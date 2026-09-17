import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDefaultAdapterRegistry } from '../../src/adapters/adapter-registry.js';
import { ExecutionService } from '../../src/core/execution/execution-service.js';
import { WebAdapter } from '../../src/adapters/web/web-adapter.js';

const fixtureUrl = new URL('../fixtures/web-test-page.html', import.meta.url);

describe('WebAdapter local page integration', () => {
  it('executes a generic form flow against a local HTML page', async () => {
    await readFile(fileURLToPath(fixtureUrl), 'utf8');
    const intent = {
      id: 'LOCAL-FORM-001',
      description: 'Submit the local generic form',
      domain: 'web',
      steps: [
        {
          id: 'STEP-001',
          action: 'navigate' as const,
          target: { url: fixtureUrl.href },
        },
        {
          id: 'STEP-002',
          action: 'fill' as const,
          target: { semanticLabel: 'Username' },
          value: 'Ada Lovelace',
        },
        {
          id: 'STEP-003',
          action: 'select' as const,
          target: { semanticLabel: 'Department' },
          value: 'engineering',
        },
        {
          id: 'STEP-004',
          action: 'click' as const,
          target: { role: 'button', semanticLabel: 'Submit' },
        },
        {
          id: 'STEP-005',
          action: 'assert' as const,
          target: { text: 'Submitted successfully' },
          expected: { visible: true },
        },
      ],
    };
    const adapter = new WebAdapter();
    const service = new ExecutionService({
      createExecutionId: () => 'local-execution-001',
      adapterRegistry: createDefaultAdapterRegistry(adapter),
    });

    try {
      const planned = service.planExecution(intent);
      expect(planned.ok).toBe(true);
      const result = await service.executeExecution('local-execution-001');

      expect(result, JSON.stringify(result, null, 2)).toMatchObject({
        executionId: 'local-execution-001',
        status: 'PASSED',
        totalSteps: 5,
        passed: 5,
        failed: 0,
      });
      await access('artifacts/executions/local-execution-001/reports/report.json');
      await access('artifacts/executions/local-execution-001/reports/report.html');
      await access('artifacts/executions/local-execution-001/generated/playwright-test.spec.ts');
    } finally {
      await adapter.close();
    }
  }, 30_000);

  it('captures a failed step and stops subsequent execution', async () => {
    const intent = {
      id: 'LOCAL-FAILURE-001',
      description: 'Fail on a missing result',
      domain: 'web',
      steps: [
        {
          id: 'STEP-001',
          action: 'navigate' as const,
          target: { url: fixtureUrl.href },
        },
        {
          id: 'STEP-002',
          action: 'assert' as const,
          target: { text: 'Text that is not present' },
          expected: { exists: true },
        },
        {
          id: 'STEP-003',
          action: 'click' as const,
          target: { role: 'button', semanticLabel: 'Submit' },
        },
      ],
    };
    const adapter = new WebAdapter();
    const service = new ExecutionService({
      createExecutionId: () => 'local-failure-001',
      adapterRegistry: createDefaultAdapterRegistry(adapter),
    });

    try {
      service.planExecution(intent);
      const result = await service.executeExecution('local-failure-001');
      const state = service.getExecutionState('local-failure-001');

      expect(result).toMatchObject({ status: 'FAILED', passed: 1, failed: 1 });
      expect(state).toMatchObject({
        ok: true,
        state: {
          status: 'FAILED',
          completedSteps: ['STEP-001'],
          stepStates: [
            { stepId: 'STEP-001', status: 'PASSED' },
            { stepId: 'STEP-002', status: 'FAILED', error: { code: 'ASSERTION_FAILED' } },
            { stepId: 'STEP-003', status: 'SKIPPED' },
          ],
        },
      });
      expect(
        (state.ok ? state.state.telemetry : []).map(
          (event) => `${event.type}:${event.stepId ?? ''}`,
        ),
      ).toContain('STEP_FAILED:STEP-002');
      expect((state.ok ? state.state.telemetry : []).map((event) => event.type)).toContain(
        'EXECUTION_FAILED',
      );
      const screenshotPath = result.results[1]?.metadata?.screenshotPath;
      expect(typeof screenshotPath).toBe('string');
      await access(screenshotPath as string);
    } finally {
      await adapter.close();
    }
  }, 30_000);
});
