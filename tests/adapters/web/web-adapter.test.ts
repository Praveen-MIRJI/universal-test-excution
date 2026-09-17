import { describe, expect, it } from 'vitest';
import { WebAdapter } from '../../../src/adapters/web/web-adapter.js';
import { BrowserSession } from '../../../src/adapters/web/browser-session.js';
import { TargetResolver } from '../../../src/adapters/web/target-resolver.js';
import { type ExecutionStep } from '../../../src/core/models/index.js';

const page = {
  goto: async () => undefined,
  getByLabel: () => ({
    fill: async () => undefined,
    or: () => ({ fill: async () => undefined }),
  }),
  getByPlaceholder: () => ({ fill: async () => undefined }),
  getByText: () => ({ click: async () => undefined }),
  waitForTimeout: async () => undefined,
  url: () => 'https://example.test',
} as unknown as Awaited<ReturnType<BrowserSession['getPage']>>;

const session = {
  getPage: async () => page,
  close: async () => undefined,
} as unknown as BrowserSession;

describe('WebAdapter', () => {
  it('can be created with an isolated browser session', () => {
    expect(new WebAdapter({ browserSession: session })).toBeInstanceOf(WebAdapter);
  });

  it('executes navigate and returns a structured result', async () => {
    const adapter = new WebAdapter({ browserSession: session });
    const step: ExecutionStep = {
      id: 'STEP-001',
      action: 'navigate',
      target: { url: 'https://example.test' },
    };

    const result = await adapter.execute(step);

    expect(result).toMatchObject({ stepId: 'STEP-001', status: 'PASSED', action: 'navigate' });
  });

  it('reports invalid steps as failures', async () => {
    const adapter = new WebAdapter({ browserSession: session });
    const result = await adapter.execute({
      id: 'STEP-002',
      action: 'navigate',
      target: { semanticLabel: 'Missing URL' },
    });

    expect(result).toMatchObject({
      stepId: 'STEP-002',
      status: 'FAILED',
      error: { code: 'INVALID_STEP', message: 'Navigate requires target.url.' },
    });
  });

  it('reports unsupported runtime actions as failures', async () => {
    const adapter = new WebAdapter({ browserSession: session });
    const result = await adapter.execute({
      id: 'STEP-003',
      action: 'unsupported' as ExecutionStep['action'],
      target: { text: 'Anything' },
    });

    expect(result).toMatchObject({
      stepId: 'STEP-003',
      status: 'FAILED',
      error: { code: 'UNSUPPORTED_ACTION', message: 'Unsupported web action: unsupported' },
    });
  });

  it('reports a missing target with a structured failure code', async () => {
    const missingTargetPage = {
      ...page,
      getByText: () => ({
        click: async () => {
          throw new Error('locator timed out');
        },
      }),
    } as unknown as Awaited<ReturnType<BrowserSession['getPage']>>;
    const adapter = new WebAdapter({
      browserSession: {
        getPage: async () => missingTargetPage,
        close: async () => undefined,
      } as unknown as BrowserSession,
    });

    const result = await adapter.execute({
      id: 'STEP-004',
      action: 'click',
      target: { text: 'Missing target' },
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      error: { code: 'TARGET_NOT_FOUND' },
    });
  });

  it('reports assertion failures with a structured failure code', async () => {
    const assertionPage = {
      ...page,
      getByText: () => ({
        filter: () => ({
          first: () => ({
            waitFor: async () => {
              throw new Error('expected text was not visible');
            },
          }),
        }),
      }),
    } as unknown as Awaited<ReturnType<BrowserSession['getPage']>>;
    const adapter = new WebAdapter({
      browserSession: {
        getPage: async () => assertionPage,
        close: async () => undefined,
      } as unknown as BrowserSession,
    });

    const result = await adapter.execute({
      id: 'STEP-005',
      action: 'assert',
      target: { text: 'Missing text' },
      expected: { visible: true },
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      error: { code: 'ASSERTION_FAILED' },
    });
  });

  it('extracts text from all matching targets', async () => {
    const extractionPage = {
      ...page,
      getByText: () => ({ allTextContents: async () => ['Protocols', 'HTTP'] }),
    } as unknown as Awaited<ReturnType<BrowserSession['getPage']>>;
    const adapter = new WebAdapter({
      browserSession: {
        getPage: async () => extractionPage,
        close: async () => undefined,
      } as unknown as BrowserSession,
    });

    const result = await adapter.execute({
      id: 'STEP-006',
      action: 'extract',
      target: { text: 'Protocol' },
      expected: { collect: 'text' },
    });

    expect(result).toMatchObject({
      status: 'PASSED',
      metadata: { extracted: ['Protocols', 'HTTP'] },
    });
  });

  it('resolves semantic labels through accessibility-oriented locators', () => {
    const resolver = new TargetResolver();
    const resolved = resolver.resolve(page, { semanticLabel: 'Username' });

    expect(resolved).toBeDefined();
  });

  it('closes the browser session cleanly', async () => {
    let closed = false;
    const adapter = new WebAdapter({
      browserSession: {
        getPage: async () => page,
        close: async () => {
          closed = true;
        },
      } as unknown as BrowserSession,
    });

    await adapter.close();

    expect(closed).toBe(true);
  });
});
