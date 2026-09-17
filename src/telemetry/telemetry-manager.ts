import { type AdapterExecutionResult } from '../adapters/adapter.js';

export const telemetryEventTypes = [
  'EXECUTION_CREATED',
  'EXECUTION_PLANNED',
  'EXECUTION_STARTED',
  'STEP_STARTED',
  'STEP_PASSED',
  'STEP_FAILED',
  'HEALING_STARTED',
  'HEALING_CANDIDATE_FOUND',
  'HEALING_CANDIDATE_SELECTED',
  'HEALING_SUCCEEDED',
  'HEALING_FAILED',
  'EXECUTION_PASSED',
  'EXECUTION_FAILED',
] as const;
export type TelemetryEventType = (typeof telemetryEventTypes)[number];

export interface TelemetryEvent {
  executionId: string;
  type: TelemetryEventType;
  timestamp: string;
  stepId?: string;
  status?: 'CREATED' | 'PLANNED' | 'RUNNING' | 'PASSED' | 'FAILED';
  action?: AdapterExecutionResult['action'];
  durationMs?: number;
  metadata?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  healing?: {
    status: 'HEALED' | 'FAILED' | 'AMBIGUOUS';
    confidence?: number;
    strategy?: string;
    candidate?: unknown;
    candidates?: unknown[];
    retrySucceeded: boolean;
  };
}

export class TelemetryManager {
  private readonly events = new Map<string, TelemetryEvent[]>();
  private readonly now: () => Date;

  public constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  public record(event: Omit<TelemetryEvent, 'timestamp'> & { timestamp?: string }): TelemetryEvent {
    const recorded: TelemetryEvent = {
      ...event,
      timestamp: event.timestamp ?? this.now().toISOString(),
    };
    const executionEvents = this.events.get(recorded.executionId) ?? [];
    executionEvents.push(recorded);
    this.events.set(recorded.executionId, executionEvents);
    return { ...recorded, ...(recorded.error ? { error: { ...recorded.error } } : {}) };
  }

  public getEvents(executionId: string): TelemetryEvent[] {
    return (this.events.get(executionId) ?? []).map((event) => ({
      ...event,
      ...(event.error ? { error: { ...event.error } } : {}),
    }));
  }
}
