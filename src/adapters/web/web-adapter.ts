import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ExecutionStep } from '../../core/models/index.js';
import { type Locator } from 'playwright';
import {
  type AdapterErrorCode,
  type AdapterExecutionResult,
  type ExecutionAdapter,
} from '../adapter.js';
import { BrowserSession } from './browser-session.js';
import { TargetResolver } from './target-resolver.js';
import { HealingEngine } from './healing-engine.js';
import { type HealingResult, type InternalElementCandidate } from './resolution.js';

export interface WebAdapterOptions {
  browserSession?: BrowserSession;
  targetResolver?: TargetResolver;
  healingEngine?: HealingEngine;
  artifactRoot?: string;
  captureScreenshotsOnFailure?: boolean;
  captureScreenshotsOnHealing?: boolean;
}

export class WebAdapter implements ExecutionAdapter {
  public readonly name = 'web';
  private readonly browserSession: BrowserSession;
  private readonly targetResolver: TargetResolver;
  private readonly healingEngine: HealingEngine;
  private readonly artifactRoot: string;
  private readonly captureScreenshotsOnFailure: boolean;
  private readonly captureScreenshotsOnHealing: boolean;
  private executionId = 'unscoped';

  public constructor(options: WebAdapterOptions = {}) {
    this.browserSession = options.browserSession ?? new BrowserSession();
    this.targetResolver = options.targetResolver ?? new TargetResolver();
    this.healingEngine = options.healingEngine ?? new HealingEngine();
    this.artifactRoot = resolve(options.artifactRoot ?? 'artifacts');
    this.captureScreenshotsOnFailure = options.captureScreenshotsOnFailure ?? true;
    this.captureScreenshotsOnHealing = options.captureScreenshotsOnHealing ?? true;
  }

  public setExecutionId(executionId: string): void {
    this.executionId = executionId;
  }

  public async execute(step: ExecutionStep): Promise<AdapterExecutionResult> {
    const startedAt = performance.now();

    try {
      const page = await this.browserSession.getPage();
      const metadata = await this.executeStep(page, step);

      return {
        stepId: step.id,
        status: 'PASSED',
        action: step.action,
        durationMs: Math.round(performance.now() - startedAt),
        healed: false,
        ...(metadata ? { metadata } : {}),
      };
    } catch (error: unknown) {
      const page = await this.browserSession.getPage();
      if (this.canHeal(step) && typeof page.locator === 'function') {
        const decision = await this.healingEngine.heal(page, step.target, step.action);
        if (decision.candidate) {
          try {
            await this.executeStep(page, step, decision.candidate);
            const healing = { ...decision.result, retrySucceeded: true };
            const screenshotPath = this.captureScreenshotsOnHealing
              ? await this.captureScreenshot(page, step, 'healed')
              : undefined;
            return {
              stepId: step.id,
              status: 'PASSED',
              action: step.action,
              durationMs: Math.round(performance.now() - startedAt),
              healed: true,
              healing,
              ...(screenshotPath ? { metadata: { screenshotPath } } : {}),
            };
          } catch (retryError: unknown) {
            return await this.failedResult(page, step, startedAt, retryError, {
              ...decision.result,
              retrySucceeded: false,
            });
          }
        }
        return await this.failedResult(page, step, startedAt, error, decision.result);
      }
      const screenshotPath = this.captureScreenshotsOnFailure
        ? await this.captureScreenshot(page, step, 'failure')
        : undefined;
      return {
        stepId: step.id,
        status: 'FAILED',
        action: step.action,
        durationMs: Math.round(performance.now() - startedAt),
        error: {
          code: this.getErrorCode(step, error),
          message: this.getErrorMessage(error),
        },
        ...(screenshotPath ? { metadata: { screenshotPath } } : {}),
      };
    }
  }

  public close(): Promise<void> {
    return this.browserSession.close();
  }

  private async executeStep(
    page: Awaited<ReturnType<BrowserSession['getPage']>>,
    step: ExecutionStep,
    recoveredCandidate?: InternalElementCandidate,
  ): Promise<Record<string, unknown> | undefined> {
    switch (step.action) {
      case 'navigate':
        if (!step.target.url) {
          throw new Error('Navigate requires target.url.');
        }
        await page.goto(step.target.url);
        return undefined;
      case 'click':
        await (await this.resolveLocator(page, step, recoveredCandidate)).click();
        return undefined;
      case 'fill':
        await (await this.resolveLocator(page, step, recoveredCandidate)).fill(step.value ?? '');
        return undefined;
      case 'select':
        await (
          await this.resolveLocator(page, step, recoveredCandidate)
        ).selectOption(step.value ?? '');
        return undefined;
      case 'wait':
        await page.waitForTimeout(this.getWaitDuration(step.value));
        return undefined;
      case 'assert':
        await this.assertExpected(page, step, recoveredCandidate);
        return undefined;
      case 'extract': {
        const locator = await this.resolveLocator(page, step, recoveredCandidate);
        const values = await locator.allTextContents();
        return { extracted: values };
      }
      default:
        throw new Error(`Unsupported web action: ${step.action}`);
    }
  }

  private async assertExpected(
    page: Awaited<ReturnType<BrowserSession['getPage']>>,
    step: ExecutionStep,
    recoveredCandidate?: InternalElementCandidate,
  ): Promise<void> {
    const expected = step.expected;
    if (!expected) {
      throw new Error('Assert requires expected.');
    }

    if (expected.url) {
      if (page.url() !== expected.url) {
        throw new Error(`Expected URL "${expected.url}" but received "${page.url()}".`);
      }
      return;
    }

    if (expected.status !== undefined) {
      throw new Error('The web adapter cannot assert HTTP status directly.');
    }

    const locator = await this.resolveLocator(page, step, recoveredCandidate);
    if (expected.visible !== undefined) {
      if (expected.visible) {
        await locator.waitFor({ state: 'visible' });
      } else {
        await locator.waitFor({ state: 'hidden' });
      }
    }
    if (expected.hidden !== undefined) {
      if (expected.hidden) {
        await locator.waitFor({ state: 'hidden' });
      } else {
        await locator.waitFor({ state: 'visible' });
      }
    }
    if (expected.exists !== undefined) {
      const exists = (await locator.count()) > 0;
      if (exists !== expected.exists) {
        throw new Error(`Expected target existence to be ${expected.exists}.`);
      }
    }
    if (expected.text) {
      await locator.filter({ hasText: expected.text }).first().waitFor({ state: 'visible' });
    }
  }

  private async resolveLocator(
    page: Awaited<ReturnType<BrowserSession['getPage']>>,
    step: ExecutionStep,
    recoveredCandidate?: InternalElementCandidate,
  ): Promise<Locator> {
    const locator = recoveredCandidate
      ? this.targetResolver.resolveCandidate(page, recoveredCandidate.locatorIndex)
      : this.targetResolver.resolve(page, step.target);
    if (!recoveredCandidate && typeof locator.count === 'function') {
      const count = await locator.count();
      if (count === 0) {
        throw new Error('Target could not be resolved.');
      }
    }
    return locator;
  }

  private canHeal(step: ExecutionStep): boolean {
    return ['click', 'fill', 'select', 'assert'].includes(step.action);
  }

  private async failedResult(
    page: Awaited<ReturnType<BrowserSession['getPage']>>,
    step: ExecutionStep,
    startedAt: number,
    error: unknown,
    healing: HealingResult,
  ): Promise<AdapterExecutionResult> {
    const screenshotPath = this.captureScreenshotsOnFailure
      ? await this.captureScreenshot(page, step, 'failure')
      : undefined;
    return {
      stepId: step.id,
      status: 'FAILED',
      action: step.action,
      durationMs: Math.round(performance.now() - startedAt),
      healing,
      error: {
        code: healing.status === 'AMBIGUOUS' ? 'AMBIGUOUS_TARGET' : this.getErrorCode(step, error),
        message: healing.reason ?? this.getErrorMessage(error),
      },
      ...(screenshotPath ? { metadata: { screenshotPath } } : {}),
    };
  }

  private async captureScreenshot(
    page: Awaited<ReturnType<BrowserSession['getPage']>>,
    step: ExecutionStep,
    kind: 'failure' | 'healed',
  ): Promise<string | undefined> {
    if (typeof page.screenshot !== 'function') return undefined;
    const directory = resolve(
      this.artifactRoot,
      'executions',
      this.safeId(this.executionId),
      'screenshots',
    );
    const path = resolve(directory, `${this.safeId(step.id)}-${kind}.png`);
    try {
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path });
      return path;
    } catch {
      return undefined;
    }
  }

  private safeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private getWaitDuration(value: string | undefined): number {
    const duration = Number(value ?? 0);
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error('Wait value must be a non-negative duration in milliseconds.');
    }
    return duration;
  }

  private getErrorCode(step: ExecutionStep, error: unknown): AdapterErrorCode {
    const message = this.getErrorMessage(error);
    if (message.startsWith('Unsupported web action:')) {
      return 'UNSUPPORTED_ACTION';
    }
    if (message === 'Navigate requires target.url.' || message.startsWith('Wait value must be')) {
      return 'INVALID_STEP';
    }
    if (step.action === 'navigate') {
      return 'NAVIGATION_FAILED';
    }
    if (step.action === 'assert') {
      return 'ASSERTION_FAILED';
    }
    return 'TARGET_NOT_FOUND';
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown web adapter error.';
  }
}
