import { randomUUID } from 'node:crypto';
import { ExecutionIntentSchema } from '../models/index.js';
import { type AdapterExecutionResult } from '../../adapters/adapter.js';
import { type AdapterRegistry } from '../../adapters/adapter-registry.js';
import {
  DeterministicExecutionPlanner,
  type ExecutionPlan,
  type ExecutionPlanner,
} from './execution-plan.js';
import {
  executionStatuses,
  ExecutionStateManager,
  type ExecutionState,
  type ExecutionStatus,
} from '../../state/execution-state-manager.js';
import { TelemetryManager, type TelemetryEvent } from '../../telemetry/telemetry-manager.js';
import { EvidenceCollector } from '../../evidence/evidence-collector.js';
import { ArtifactGenerator } from '../../artifact/artifact-generator.js';
import { ReportGenerator } from '../../reporting/report-generator.js';

export { executionStatuses };
export type { ExecutionState, ExecutionStatus };

export type ExecutionErrorCode =
  | 'INVALID_EXECUTION_INTENT'
  | 'EXECUTION_NOT_FOUND'
  | 'UNSUPPORTED_APPLICATION'
  | 'ADAPTER_UNAVAILABLE'
  | 'UNEXPECTED_EXECUTION_ERROR';

export interface ExecutionError {
  code: ExecutionErrorCode;
  message: string;
  details?: unknown;
}

export type PlanExecutionResult =
  { ok: true; state: ExecutionState } | { ok: false; error: ExecutionError };

export type GetExecutionResult =
  | { ok: true; state: ExecutionState & { telemetry: TelemetryEvent[] } }
  | { ok: false; error: ExecutionError };

export interface ExecutionServiceOptions {
  createExecutionId?: () => string;
  now?: () => Date;
  adapterRegistry?: AdapterRegistry;
  planner?: ExecutionPlanner;
  stateManager?: ExecutionStateManager;
  telemetryManager?: TelemetryManager;
  evidenceCollector?: EvidenceCollector;
  artifactGenerator?: ArtifactGenerator;
  reportGenerator?: ReportGenerator;
  artifactRoot?: string;
  closeAdapterAfterExecution?: boolean;
}

export interface ExecutionRunResult {
  executionId: string;
  status: ExecutionStatus;
  results: AdapterExecutionResult[];
  totalSteps: number;
  passed: number;
  failed: number;
  durationMs: number;
  updatedAt: string;
  error?: ExecutionError;
}

export class ExecutionService {
  private readonly createExecutionId: () => string;
  private readonly now: () => Date;
  private readonly adapterRegistry: AdapterRegistry | undefined;
  private readonly planner: ExecutionPlanner;
  private readonly stateManager: ExecutionStateManager;
  private readonly telemetryManager: TelemetryManager;
  private readonly evidenceCollector: EvidenceCollector;
  private readonly artifactGenerator: ArtifactGenerator;
  private readonly reportGenerator: ReportGenerator;
  private readonly closeAdapterAfterExecution: boolean;

  public constructor(options: ExecutionServiceOptions = {}) {
    this.createExecutionId = options.createExecutionId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.adapterRegistry = options.adapterRegistry;
    this.planner = options.planner ?? new DeterministicExecutionPlanner();
    this.stateManager = options.stateManager ?? new ExecutionStateManager(this.now);
    this.telemetryManager = options.telemetryManager ?? new TelemetryManager(this.now);
    this.evidenceCollector =
      options.evidenceCollector ??
      new EvidenceCollector({
        now: this.now,
        ...(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {}),
      });
    this.artifactGenerator =
      options.artifactGenerator ??
      new ArtifactGenerator(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {});
    this.reportGenerator =
      options.reportGenerator ??
      new ReportGenerator(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {});
    this.closeAdapterAfterExecution = options.closeAdapterAfterExecution ?? true;
  }

  public planExecution(input: unknown): PlanExecutionResult {
    const parsedIntent = ExecutionIntentSchema.safeParse(input);
    if (!parsedIntent.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_EXECUTION_INTENT',
          message: 'The execution intent is invalid.',
          details: parsedIntent.error.issues,
        },
      };
    }

    const executionId = this.createExecutionId();
    const timestamp = this.now().toISOString();
    const plan = this.planner.createPlan(
      parsedIntent.data,
      executionId,
      this.adapterRegistry?.getDescriptor(parsedIntent.data.domain)?.name ??
        parsedIntent.data.domain,
      timestamp,
    );
    this.stateManager.createExecution(plan);
    this.telemetryManager.record({ executionId, type: 'EXECUTION_CREATED', status: 'CREATED' });
    this.telemetryManager.record({ executionId, type: 'EXECUTION_PLANNED', status: 'PLANNED' });
    return { ok: true, state: this.stateManager.markPlanned(executionId) };
  }

  public getExecutionState(executionId: string): GetExecutionResult {
    const state = this.stateManager.getExecution(executionId);
    if (!state) {
      return {
        ok: false,
        error: {
          code: 'EXECUTION_NOT_FOUND',
          message: `No execution exists with id "${executionId}".`,
        },
      };
    }
    return {
      ok: true,
      state: { ...state, telemetry: this.telemetryManager.getEvents(executionId) },
    };
  }

  public async executeExecution(executionId: string): Promise<ExecutionRunResult> {
    const state = this.stateManager.getExecution(executionId);
    if (!state) {
      throw new Error(`No execution exists with id "${executionId}".`);
    }

    const descriptor = this.adapterRegistry?.getDescriptor(state.executionPlan.adapterName);
    const adapter = this.adapterRegistry?.get(state.executionPlan.adapterName);
    if (!adapter) {
      const error: ExecutionError = {
        code: descriptor ? 'ADAPTER_UNAVAILABLE' : 'UNSUPPORTED_APPLICATION',
        message: descriptor
          ? `The adapter for execution domain "${state.executionPlan.adapterName}" is unavailable.`
          : `No adapter is registered for execution domain "${state.executionPlan.adapterName}".`,
      };
      this.stateManager.markFailed(executionId, error);
      this.telemetryManager.record({
        executionId,
        type: 'EXECUTION_FAILED',
        status: 'FAILED',
        error,
      });
      await this.finalizeArtifacts(executionId);
      return this.finishExecution(executionId, error);
    }

    adapter.setExecutionId?.(executionId);
    this.stateManager.markRunning(executionId);
    this.telemetryManager.record({ executionId, type: 'EXECUTION_STARTED', status: 'RUNNING' });
    try {
      for (const step of state.executionPlan.steps) {
        this.stateManager.markStepRunning(executionId, step.id);
        this.telemetryManager.record({
          executionId,
          type: 'STEP_STARTED',
          stepId: step.id,
          status: 'RUNNING',
          action: step.action,
        });

        let result: AdapterExecutionResult;
        try {
          result = await adapter.execute(step);
        } catch (error: unknown) {
          result = {
            stepId: step.id,
            status: 'FAILED',
            action: step.action,
            durationMs: 0,
            error: {
              code: 'UNEXPECTED_EXECUTION_ERROR',
              message: error instanceof Error ? error.message : 'Unexpected execution error.',
            },
          };
        }

        this.recordResultEvidence(executionId, result);
        this.stateManager.recordStepResult(executionId, result);
        if (result.healing) {
          this.telemetryManager.record({
            executionId,
            type: 'HEALING_STARTED',
            stepId: result.stepId,
            status: 'RUNNING',
            healing: result.healing,
          });
          if (result.healing.candidates?.length) {
            this.telemetryManager.record({
              executionId,
              type: 'HEALING_CANDIDATE_FOUND',
              stepId: result.stepId,
              status: 'RUNNING',
              healing: result.healing,
            });
          }
          if (result.healing.candidate) {
            this.telemetryManager.record({
              executionId,
              type: 'HEALING_CANDIDATE_SELECTED',
              stepId: result.stepId,
              status: 'RUNNING',
              healing: result.healing,
            });
          }
          this.telemetryManager.record({
            executionId,
            type:
              result.healing.status === 'HEALED'
                ? 'HEALING_SUCCEEDED'
                : result.healing.status === 'AMBIGUOUS'
                  ? 'HEALING_FAILED'
                  : 'HEALING_FAILED',
            stepId: result.stepId,
            status: result.status,
            healing: result.healing,
          });
        }
        if (result.status === 'FAILED') {
          this.telemetryManager.record({
            executionId,
            type: 'STEP_FAILED',
            stepId: result.stepId,
            status: 'FAILED',
            action: result.action,
            durationMs: result.durationMs,
            ...(result.metadata ? { metadata: result.metadata } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
          this.stateManager.markFailed(executionId, result.error);
          this.telemetryManager.record({
            executionId,
            type: 'EXECUTION_FAILED',
            status: 'FAILED',
            ...(result.error ? { error: result.error } : {}),
          });
          await this.finalizeArtifacts(executionId);
          return this.finishExecution(executionId);
        }

        this.telemetryManager.record({
          executionId,
          type: 'STEP_PASSED',
          stepId: result.stepId,
          status: 'PASSED',
          action: result.action,
          durationMs: result.durationMs,
          ...(result.metadata ? { metadata: result.metadata } : {}),
        });
      }

      this.stateManager.markPassed(executionId);
      this.telemetryManager.record({ executionId, type: 'EXECUTION_PASSED', status: 'PASSED' });
      await this.finalizeArtifacts(executionId);
      return this.finishExecution(executionId);
    } finally {
      if (this.closeAdapterAfterExecution) await adapter.close();
    }
  }

  public getTelemetry(executionId: string): TelemetryEvent[] {
    return this.telemetryManager.getEvents(executionId);
  }

  public getExecutionPlan(executionId: string): ExecutionPlan | undefined {
    return this.stateManager.getExecution(executionId)?.executionPlan;
  }

  public getExecutionEvidence(executionId: string) {
    return this.evidenceCollector.getExecutionEvidence(executionId);
  }

  public getExecutionReport(executionId: string) {
    return this.reportGenerator.getReport(executionId);
  }

  private recordResultEvidence(executionId: string, result: AdapterExecutionResult): void {
    const metadata = result.metadata;
    if (metadata?.screenshotPath && typeof metadata.screenshotPath === 'string') {
      this.evidenceCollector.record({
        executionId,
        stepId: result.stepId,
        type: 'SCREENSHOT',
        path: metadata.screenshotPath,
        description: `Web evidence for ${result.stepId}.`,
      });
    }
    if (metadata?.method && metadata?.url) {
      this.evidenceCollector.record({
        executionId,
        stepId: result.stepId,
        type: 'REQUEST',
        description: `API request for ${result.stepId}.`,
        data: {
          method: metadata.method,
          url: metadata.url,
          headers: metadata.requestHeaders,
          body: metadata.requestBody,
        },
      });
      this.evidenceCollector.record({
        executionId,
        stepId: result.stepId,
        type: 'RESPONSE',
        description: `API response for ${result.stepId}.`,
        data: {
          status: metadata.responseStatus,
          headers: metadata.responseHeaders,
          body: metadata.responseBody,
          durationMs: result.durationMs,
        },
      });
    }
    if (result.healing) {
      this.evidenceCollector.record({
        executionId,
        stepId: result.stepId,
        type: 'HEALING',
        description: `Healing attempt for ${result.stepId}.`,
        data: result.healing,
      });
    }
    if (result.error) {
      this.evidenceCollector.record({
        executionId,
        stepId: result.stepId,
        type: 'ERROR',
        description: result.error.message,
        data: result.error,
      });
    }
  }

  private async finalizeArtifacts(executionId: string): Promise<void> {
    try {
      const state = this.stateManager.getExecution(executionId);
      if (!state) return;
      const generatedPath = await this.artifactGenerator.generateWebPlaywrightArtifact(
        state.executionPlan,
      );
      if (generatedPath) {
        this.evidenceCollector.record({
          executionId,
          type: 'EXECUTION_LOG',
          path: generatedPath,
          description: 'Generated Playwright artifact.',
        });
      }
      this.evidenceCollector.record({
        executionId,
        type: 'STATE_SNAPSHOT',
        description: 'Final execution state snapshot.',
        data: state as unknown as Record<string, unknown>,
      });
      await this.evidenceCollector.persist(executionId);
      const finalState = this.stateManager.getExecution(executionId);
      if (finalState) {
        await this.reportGenerator.generate(
          finalState,
          this.telemetryManager.getEvents(executionId),
          this.evidenceCollector.getExecutionEvidence(executionId),
        );
      }
    } catch (error: unknown) {
      this.evidenceCollector.record({
        executionId,
        type: 'ERROR',
        description: 'Artifact generation failed.',
        data: { message: error instanceof Error ? error.message : 'Unknown artifact error.' },
      });
      await this.evidenceCollector.persist(executionId);
    }
  }

  private finishExecution(executionId: string, error?: ExecutionError): ExecutionRunResult {
    const state = this.stateManager.getExecution(executionId);
    if (!state) {
      throw new Error(`No execution exists with id "${executionId}".`);
    }
    const results = state.results;
    return {
      executionId: state.executionId,
      status: state.status,
      results,
      totalSteps: state.plan.length,
      passed: results.filter((result) => result.status === 'PASSED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
      durationMs: results.reduce((total, result) => total + result.durationMs, 0),
      updatedAt: state.updatedAt,
      ...(error ? { error } : {}),
    };
  }
}
