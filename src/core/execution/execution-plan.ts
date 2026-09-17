import { type ExecutionIntent, type ExecutionStep } from '../models/index.js';

export interface ExecutionPlan {
  executionId: string;
  intent: ExecutionIntent;
  domain: string;
  adapterName: string;
  steps: ExecutionStep[];
  status: 'PLANNED';
  createdAt: string;
}

export interface ExecutionPlanner {
  createPlan(
    intent: ExecutionIntent,
    executionId: string,
    adapterName: string,
    createdAt: string,
  ): ExecutionPlan;
}

export class DeterministicExecutionPlanner implements ExecutionPlanner {
  public createPlan(
    intent: ExecutionIntent,
    executionId: string,
    adapterName: string,
    createdAt: string,
  ): ExecutionPlan {
    return {
      executionId,
      intent,
      domain: intent.domain,
      adapterName,
      steps: [...intent.steps],
      status: 'PLANNED',
      createdAt,
    };
  }
}
