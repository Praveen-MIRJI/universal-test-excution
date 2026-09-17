import { describe, expect, it } from 'vitest';
import { ApiAdapter } from '../../../src/adapters/api/api-adapter.js';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-test': 'ok' },
  });
}

describe('ApiAdapter', () => {
  it('executes a request and evaluates status and body fields', async () => {
    const adapter = new ApiAdapter({ fetch: async () => response(200, { id: 1, name: 'Ada' }) });

    const result = await adapter.execute({
      id: 'STEP-001',
      action: 'request',
      target: { url: 'http://example.test/users/1', method: 'GET' },
      expected: { status: 200, bodyField: { path: 'name', equals: 'Ada' } },
    });

    expect(result).toMatchObject({
      status: 'PASSED',
      metadata: { responseStatus: 200, responseBody: { id: 1, name: 'Ada' } },
    });
  });

  it('supports JSON request bodies and query parameters', async () => {
    let requestUrl = '';
    let requestBody = '';
    const adapter = new ApiAdapter({
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestBody = String(init?.body);
        return response(201, { created: true });
      },
    });

    const result = await adapter.execute({
      id: 'STEP-002',
      action: 'request',
      target: {
        url: 'http://example.test/users',
        method: 'POST',
        query: { source: 'test' },
        headers: { 'content-type': 'application/json', Authorization: 'secret' },
        body: { name: 'Ada' },
      },
      expected: { status: 201, bodyContains: { created: true } },
    });

    expect(result.status).toBe('PASSED');
    expect(requestUrl).toContain('source=test');
    expect(requestBody).toBe(JSON.stringify({ name: 'Ada' }));
    expect(JSON.stringify(result.metadata)).not.toContain('secret');
  });

  it('returns structured failures for invalid steps, assertions, connections, and timeouts', async () => {
    const invalid = await new ApiAdapter().execute({
      id: 'STEP-003',
      action: 'click',
      target: { text: 'not an api request' },
    });
    expect(invalid.error?.code).toBe('INVALID_API_STEP');

    const unsupported = await new ApiAdapter().execute({
      id: 'STEP-003B',
      action: 'request',
      target: { url: 'http://example.test', method: 'TRACE' as never },
    });
    expect(unsupported.error?.code).toBe('UNSUPPORTED_HTTP_METHOD');

    const invalidUrl = await new ApiAdapter().execute({
      id: 'STEP-003C',
      action: 'request',
      target: { url: 'not a url', method: 'GET' },
    });
    expect(invalidUrl.error?.code).toBe('INVALID_URL');

    const assertion = await new ApiAdapter({
      fetch: async () => response(200, { ok: false }),
    }).execute({
      id: 'STEP-004',
      action: 'request',
      target: { url: 'http://example.test', method: 'GET' },
      expected: { status: 201 },
    });
    expect(assertion.error?.code).toBe('RESPONSE_ASSERTION_FAILED');

    const connection = await new ApiAdapter({
      fetch: async () => {
        throw new TypeError('socket closed');
      },
    }).execute({
      id: 'STEP-005',
      action: 'request',
      target: { url: 'http://example.test', method: 'GET' },
    });
    expect(connection.error?.code).toBe('CONNECTION_FAILED');

    const timeout = await new ApiAdapter({
      timeoutMs: 1,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    }).execute({
      id: 'STEP-006',
      action: 'request',
      target: { url: 'http://example.test', method: 'GET' },
    });
    expect(timeout.error?.code).toBe('TIMEOUT');
  });
});
