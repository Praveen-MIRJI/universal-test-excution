import { type ExecutionStep } from '../core/models/index.js';

export type AdapterExecutionStatus = 'PASSED' | 'FAILED';

export type AdapterErrorCode =
  | 'INVALID_STEP'
  | 'TARGET_NOT_FOUND'
  | 'AMBIGUOUS_TARGET'
  | 'UNSUPPORTED_ACTION'
  | 'NAVIGATION_FAILED'
  | 'ASSERTION_FAILED'
  | 'INVALID_API_STEP'
  | 'UNSUPPORTED_HTTP_METHOD'
  | 'INVALID_URL'
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  | 'RESPONSE_ASSERTION_FAILED'
  | 'UNEXPECTED_EXECUTION_ERROR';

export interface AdapterExecutionResult {
  stepId: string;
  status: AdapterExecutionStatus;
  action: ExecutionStep['action'];
  durationMs: number;
  metadata?: Record<string, unknown>;
  healed?: boolean;
  healing?: {
    attempted: boolean;
    status: 'HEALED' | 'FAILED' | 'AMBIGUOUS';
    originalTarget: unknown;
    strategy?: string;
    candidate?: unknown;
    candidates?: unknown[];
    confidence?: number;
    retrySucceeded: boolean;
    reason?: string;
  };
  error?: {
    code: AdapterErrorCode;
    message: string;
  };
}

export interface ExecutionAdapter {
  readonly name: string;
  setExecutionId?(executionId: string): void;
  execute(step: ExecutionStep): Promise<AdapterExecutionResult>;
  close(): Promise<void>;
}
