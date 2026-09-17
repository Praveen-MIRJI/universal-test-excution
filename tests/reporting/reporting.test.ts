import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArtifactGenerator } from '../../src/artifact/artifact-generator.js';
import { EvidenceCollector } from '../../src/evidence/evidence-collector.js';
import { ReportGenerator } from '../../src/reporting/report-generator.js';
import { DeterministicExecutionPlanner } from '../../src/core/execution/execution-plan.js';
import { ExecutionStateManager } from '../../src/state/execution-state-manager.js';
import { TelemetryManager } from '../../src/telemetry/telemetry-manager.js';

describe('Phase 7 reporting and evidence', () => {
  it('isolates evidence and rejects unsafe execution path values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'universal-test-evidence-'));
    const collector = new EvidenceCollector({
      artifactRoot: root,
      createEvidenceId: () => 'evidence-001',
    });
    collector.record({ executionId: '../outside', type: 'ERROR', description: 'safe path test' });
    const evidencePath = await collector.persist('../outside');

    expect(evidencePath).toContain(join(root, 'executions'));
    expect(collector.getExecutionEvidence('../outside')).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  it('generates deterministic Playwright TypeScript from the normalized plan', async () => {
    const plan = new DeterministicExecutionPlanner().createPlan(
      {
        id: 'WEB-001',
        description: 'Submit form',
        domain: 'web',
        steps: [
          { id: 'STEP-001', action: 'navigate', target: { url: 'http://local.test' } },
          { id: 'STEP-002', action: 'fill', target: { semanticLabel: 'Username' }, value: 'Ada' },
          { id: 'STEP-003', action: 'click', target: { role: 'button', semanticLabel: 'Submit' } },
          {
            id: 'STEP-004',
            action: 'assert',
            target: { text: 'Done' },
            expected: { visible: true },
          },
        ],
      },
      'execution-001',
      'web',
      '2026-09-16T12:00:00.000Z',
    );
    const generator = new ArtifactGenerator();
    const first = generator.generateWebPlaywrightSource(plan);
    const second = generator.generateWebPlaywrightSource(plan);

    expect(first).toBe(second);
    expect(first).toContain('page.goto');
    expect(first).toContain('getByLabel("Username").fill');
    expect(first).toContain('getByRole("button", { name: "Submit" }).click');
    expect(first).toContain('toBeVisible');
  });

  it('generates JSON and HTML reports with timeline, errors, healing, and evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'universal-test-report-'));
    const plan = new DeterministicExecutionPlanner().createPlan(
      {
        id: 'WEB-002',
        description: 'Failing test',
        domain: 'web',
        steps: [{ id: 'STEP-001', action: 'click', target: { text: 'Submit' } }],
      },
      'execution-report-001',
      'web',
      '2026-09-16T12:00:00.000Z',
    );
    const stateManager = new ExecutionStateManager(() => new Date('2026-09-16T12:00:01.000Z'));
    stateManager.createExecution(plan);
    stateManager.markPlanned(plan.executionId);
    stateManager.markRunning(plan.executionId);
    stateManager.markStepRunning(plan.executionId, 'STEP-001');
    stateManager.recordStepResult(plan.executionId, {
      stepId: 'STEP-001',
      action: 'click',
      status: 'FAILED',
      durationMs: 12,
      error: { code: 'TARGET_NOT_FOUND', message: 'Target missing.' },
      healing: {
        attempted: true,
        status: 'FAILED',
        originalTarget: { text: 'Submit' },
        retrySucceeded: false,
      },
    });
    stateManager.markFailed(plan.executionId, {
      code: 'TARGET_NOT_FOUND',
      message: 'Target missing.',
    });
    const telemetry = new TelemetryManager(() => new Date('2026-09-16T12:00:01.000Z'));
    telemetry.record({ executionId: plan.executionId, type: 'EXECUTION_FAILED', status: 'FAILED' });
    const evidence = new EvidenceCollector({ artifactRoot: root });
    evidence.record({
      executionId: plan.executionId,
      type: 'ERROR',
      description: 'Target missing.',
    });
    const report = await new ReportGenerator({ artifactRoot: root }).generate(
      stateManager.getExecution(plan.executionId)!,
      telemetry.getEvents(plan.executionId),
      evidence.getExecutionEvidence(plan.executionId),
    );
    const reportDirectory = join(root, 'executions', 'execution-report-001', 'reports');
    const json = await readFile(join(reportDirectory, 'report.json'), 'utf8');
    const html = await readFile(join(reportDirectory, 'report.html'), 'utf8');

    expect(report.summary.failed).toBe(1);
    expect(report.healing).toHaveLength(1);
    expect(json).toContain('execution-report-001');
    expect(html).toContain('STEP-001');
    expect(html).toContain('Target missing.');
    await access(join(reportDirectory, 'report.html'));
    await rm(root, { recursive: true, force: true });
  });
});
