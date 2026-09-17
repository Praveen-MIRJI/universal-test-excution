import { type AdapterExecutionResult } from '../adapters/adapter.js';
import { type ExecutionPlan } from '../core/execution/execution-plan.js';
import { type ExecutionStep } from '../core/models/index.js';

export const executionStatuses = ['CREATED', 'PLANNED', 'RUNNING', 'PASSED', 'FAILED'] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];
export const stepStatuses = ['PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED'] as const;
export type StepStatus = (typeof stepStatuses)[number];

export interface ExecutionStateError {
  code: string;
  message: string;
  details?: unknown;
}

export interface StepExecutionState {
  stepId: string;
  action: ExecutionStep['action'];
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: {
    code: string;
    message: string;
  };
}

export interface ExecutionCheckpoint {
  currentStepId?: string;
  completedSteps: string[];
  capturedAt: string;
}

export interface ExecutionState {
  executionId: string;
  status: ExecutionStatus;
  intent: ExecutionPlan['intent'];
  plan: ExecutionStep[];
  executionPlan: ExecutionPlan;
  createdAt: string;
  updatedAt: string;
  currentStepId?: string;
  currentStep?: ExecutionStep;
  lastCompletedStep?: ExecutionStep;
  completedSteps: string[];
  stepStates: StepExecutionState[];
  results: AdapterExecutionResult[];
  checkpoint?: ExecutionCheckpoint;
  error?: ExecutionStateError;
}

export class ExecutionStateManager {
  private readonly executions = new Map<string, ExecutionState>();
  private readonly now: () => Date;

  public constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  public createExecution(plan: ExecutionPlan): ExecutionState {
    const state: ExecutionState = {
      executionId: plan.executionId,
      status: 'CREATED',
      intent: plan.intent,
      plan: [...plan.steps],
      executionPlan: { ...plan, steps: [...plan.steps] },
      createdAt: plan.createdAt,
      updatedAt: plan.createdAt,
      completedSteps: [],
      stepStates: plan.steps.map((step) => ({
        stepId: step.id,
        action: step.action,
        status: 'PENDING',
      })),
      results: [],
    };
    this.executions.set(state.executionId, state);
    return this.snapshot(state);
  }

  public markPlanned(executionId: string): ExecutionState {
    return this.update(executionId, (state) => {
      state.status = 'PLANNED';
    });
  }

  public markRunning(executionId: string): ExecutionState {
    return this.update(executionId, (state) => {
      state.status = 'RUNNING';
      delete state.error;
    });
  }

  public markStepRunning(executionId: string, stepId: string): ExecutionState {
    return this.update(executionId, (state) => {
      const stepState = this.findStepState(state, stepId);
      const currentStep = state.plan.find((step) => step.id === stepId);
      if (!currentStep) {
        throw new Error(`No step exists with id "${stepId}".`);
      }
      const startedAt = this.now().toISOString();
      stepState.status = 'RUNNING';
      stepState.startedAt = startedAt;
      state.currentStepId = stepId;
      state.currentStep = currentStep;
    });
  }

  public recordStepResult(executionId: string, result: AdapterExecutionResult): ExecutionState {
    return this.update(executionId, (state) => {
      const stepState = this.findStepState(state, result.stepId);
      const completedAt = this.now().toISOString();
      stepState.status = result.status;
      stepState.completedAt = completedAt;
      stepState.durationMs = result.durationMs;
      if (result.error) {
        stepState.error = { ...result.error };
      } else {
        delete stepState.error;
      }
      state.results.push({ ...result, ...(result.error ? { error: { ...result.error } } : {}) });
      if (result.status === 'PASSED') {
        state.completedSteps.push(result.stepId);
        const completedStep = state.plan.find((step) => step.id === result.stepId);
        if (completedStep) {
          state.lastCompletedStep = completedStep;
        }
        state.checkpoint = {
          currentStepId: result.stepId,
          completedSteps: [...state.completedSteps],
          capturedAt: completedAt,
        };
      }
    });
  }

  public markPassed(executionId: string): ExecutionState {
    return this.update(executionId, (state) => {
      state.status = 'PASSED';
      delete state.error;
    });
  }

  public markFailed(executionId: string, error?: ExecutionStateError): ExecutionState {
    return this.update(executionId, (state) => {
      state.status = 'FAILED';
      for (const stepState of state.stepStates) {
        if (stepState.status === 'PENDING') {
          stepState.status = 'SKIPPED';
        }
      }
      if (error) {
        state.error = { ...error };
      }
    });
  }

  public getExecution(executionId: string): ExecutionState | undefined {
    const state = this.executions.get(executionId);
    return state ? this.snapshot(state) : undefined;
  }

  public getStepState(executionId: string, stepId: string): StepExecutionState | undefined {
    const state = this.executions.get(executionId);
    const stepState = state?.stepStates.find((step) => step.stepId === stepId);
    return stepState
      ? { ...stepState, ...(stepState.error ? { error: { ...stepState.error } } : {}) }
      : undefined;
  }

  private update(executionId: string, mutation: (state: ExecutionState) => void): ExecutionState {
    const state = this.executions.get(executionId);
    if (!state) {
      throw new Error(`No execution exists with id "${executionId}".`);
    }
    mutation(state);
    state.updatedAt = this.now().toISOString();
    return this.snapshot(state);
  }

  private findStepState(state: ExecutionState, stepId: string): StepExecutionState {
    const stepState = state.stepStates.find((step) => step.stepId === stepId);
    if (!stepState) {
      throw new Error(`No step exists with id "${stepId}".`);
    }
    return stepState;
  }

  private snapshot(state: ExecutionState): ExecutionState {
    return structuredClone(state);
  }
}
