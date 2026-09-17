import { type ExecutionStep } from '../../core/models/index.js';
import { type AdapterExecutionResult, type ExecutionAdapter } from '../adapter.js';

export interface ApiAdapterOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const defaultTimeoutMs = 5_000;
const maxEvidenceBodyCharacters = 10_000;
const sensitiveHeaderPattern = /authorization|api[-_]?key|cookie|password|token/i;

export class ApiAdapter implements ExecutionAdapter {
  public readonly name = 'api';
  private readonly timeoutMs: number;
  private readonly request: typeof fetch;

  public constructor(options: ApiAdapterOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.request = options.fetch ?? fetch;
  }

  public async execute(step: ExecutionStep): Promise<AdapterExecutionResult> {
    const startedAt = performance.now();
    let evidenceMetadata: Record<string, unknown> | undefined;
    try {
      if (step.action !== 'request') {
        throw new ApiAdapterError('INVALID_API_STEP', 'API adapter requires action "request".');
      }
      const target = step.target;
      if (!target.url || !target.method) {
        throw new ApiAdapterError(
          'INVALID_API_STEP',
          'API request requires target.url and target.method.',
        );
      }
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(target.method)) {
        throw new ApiAdapterError(
          'UNSUPPORTED_HTTP_METHOD',
          `Unsupported HTTP method: ${target.method}.`,
        );
      }

      const url = new URL(target.url);
      for (const [key, value] of Object.entries(target.query ?? {})) {
        url.searchParams.set(key, value);
      }
      evidenceMetadata = {
        method: target.method,
        url: url.toString(),
        requestHeaders: this.safeRequestHeaders(target.headers),
        requestBody: sanitizeValue(target.body),
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        const requestInit: RequestInit = { method: target.method, signal: controller.signal };
        if (target.headers) requestInit.headers = target.headers;
        if (target.body !== undefined) {
          requestInit.body = JSON.stringify(target.body);
        }
        response = await this.request(url, requestInit);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          throw new ApiAdapterError('TIMEOUT', `API request timed out after ${this.timeoutMs} ms.`);
        }
        throw new ApiAdapterError(
          'CONNECTION_FAILED',
          error instanceof Error
            ? `API connection failed: ${error.message}`
            : 'API connection failed.',
        );
      } finally {
        clearTimeout(timeout);
      }

      const body = await this.readBody(response);
      evidenceMetadata = {
        ...evidenceMetadata,
        responseStatus: response.status,
        responseHeaders: this.safeHeaders(response.headers),
        responseBody: sanitizeValue(body),
      };
      this.assertExpected(step, response.status, body);
      return {
        stepId: step.id,
        status: 'PASSED',
        action: step.action,
        durationMs: Math.round(performance.now() - startedAt),
        metadata: {
          ...evidenceMetadata,
          responseStatus: response.status,
          responseHeaders: this.safeHeaders(response.headers),
          responseBody: sanitizeValue(body),
        },
      };
    } catch (error: unknown) {
      const apiError = this.toApiError(error);
      return {
        stepId: step.id,
        status: 'FAILED',
        action: step.action,
        durationMs: Math.round(performance.now() - startedAt),
        ...(evidenceMetadata ? { metadata: evidenceMetadata } : {}),
        error: { code: apiError.code, message: apiError.message },
      };
    }
  }

  public async close(): Promise<void> {
    return Promise.resolve();
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private assertExpected(step: ExecutionStep, status: number, body: unknown): void {
    const expected = step.expected;
    if (!expected) return;
    if (expected.status !== undefined && expected.status !== status) {
      throw new ApiAdapterError(
        'RESPONSE_ASSERTION_FAILED',
        `Expected response status ${expected.status} but received ${status}.`,
      );
    }
    if (expected.bodyContains && !contains(body, expected.bodyContains)) {
      throw new ApiAdapterError(
        'RESPONSE_ASSERTION_FAILED',
        'Response body did not contain the expected values.',
      );
    }
    if (expected.bodyField) {
      const actual = expected.bodyField.path.split('.').reduce<unknown>((value, key) => {
        if (typeof value !== 'object' || value === null) return undefined;
        return (value as Record<string, unknown>)[key];
      }, body);
      if (!deepEqual(actual, expected.bodyField.equals)) {
        throw new ApiAdapterError(
          'RESPONSE_ASSERTION_FAILED',
          `Expected response field "${expected.bodyField.path}" to equal the requested value.`,
        );
      }
    }
    if (expected.text && !String(body).includes(expected.text)) {
      throw new ApiAdapterError(
        'RESPONSE_ASSERTION_FAILED',
        'Response body did not contain the expected text.',
      );
    }
  }

  private safeHeaders(headers: Headers): Record<string, string> {
    const safe: Record<string, string> = {};
    headers.forEach((value, key) => {
      if (!sensitiveHeaderPattern.test(key)) safe[key] = value;
    });
    return safe;
  }

  private safeRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers ?? {}).map(([key, value]) => [
        key,
        sensitiveHeaderPattern.test(key) ? '[REDACTED]' : value,
      ]),
    );
  }

  private toApiError(error: unknown): ApiAdapterError {
    if (error instanceof ApiAdapterError) return error;
    if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      return new ApiAdapterError('INVALID_URL', 'The API request URL is invalid.');
    }
    return new ApiAdapterError('UNEXPECTED_EXECUTION_ERROR', 'Unexpected API execution error.');
  }
}

class ApiAdapterError extends Error {
  public constructor(
    public readonly code: Extract<
      import('../adapter.js').AdapterErrorCode,
      | 'INVALID_API_STEP'
      | 'UNSUPPORTED_HTTP_METHOD'
      | 'INVALID_URL'
      | 'CONNECTION_FAILED'
      | 'TIMEOUT'
      | 'RESPONSE_ASSERTION_FAILED'
      | 'UNEXPECTED_EXECUTION_ERROR'
    >,
    message: string,
  ) {
    super(message);
  }
}

function contains(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.entries(expected).every(([key, value]) => {
    const actualValue = (actual as Record<string, unknown>)[key];
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? contains(actualValue, value as Record<string, unknown>)
      : deepEqual(actualValue, value);
  });
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sanitizeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxEvidenceBodyCharacters) return value;
  return {
    truncated: true,
    preview: serialized.slice(0, maxEvidenceBodyCharacters),
  };
}
