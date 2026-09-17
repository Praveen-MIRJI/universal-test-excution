import { describe, expect, it } from 'vitest';
import { TelemetryManager } from '../../src/telemetry/telemetry-manager.js';

describe('TelemetryManager', () => {
  it('records typed events and returns isolated execution history', () => {
    const telemetry = new TelemetryManager(() => new Date('2026-09-16T12:00:00.000Z'));

    telemetry.record({
      executionId: 'execution-001',
      type: 'EXECUTION_CREATED',
      status: 'CREATED',
    });
    telemetry.record({
      executionId: 'execution-001',
      type: 'STEP_FAILED',
      stepId: 'STEP-001',
      status: 'FAILED',
      durationMs: 18,
      error: { code: 'ASSERTION_FAILED', message: 'Expected text was not visible.' },
    });

    const events = telemetry.getEvents('execution-001');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: 'STEP_FAILED',
      stepId: 'STEP-001',
      error: { code: 'ASSERTION_FAILED' },
    });

    events.pop();
    expect(telemetry.getEvents('execution-001')).toHaveLength(2);
  });
});
