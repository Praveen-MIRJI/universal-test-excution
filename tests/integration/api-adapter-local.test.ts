import { createServer, type Server } from 'node:http';
import { access } from 'node:fs/promises';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDefaultAdapterRegistry } from '../../src/adapters/adapter-registry.js';
import { ApiAdapter } from '../../src/adapters/api/api-adapter.js';
import { ExecutionService } from '../../src/core/execution/execution-service.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && request.url === '/users') {
        response.writeHead(200);
        response.end(JSON.stringify([{ id: 1, name: 'Ada' }]));
        return;
      }
      if (request.method === 'GET' && request.url === '/users/1') {
        response.writeHead(200);
        response.end(JSON.stringify({ id: 1, name: 'Ada' }));
        return;
      }
      if (request.method === 'POST' && request.url === '/users') {
        response.writeHead(201);
        response.end(JSON.stringify({ created: true, received: JSON.parse(body) }));
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not determine fixture address.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function service(executionId: string): ExecutionService {
  return new ExecutionService({
    createExecutionId: () => executionId,
    adapterRegistry: createDefaultAdapterRegistry(
      new (class {
        readonly name = 'web';
        async execute() {
          return {
            stepId: 'unused',
            status: 'PASSED' as const,
            action: 'wait' as const,
            durationMs: 0,
          };
        }
        async close() {}
      })(),
      new ApiAdapter(),
    ),
  });
}

describe('APIAdapter local integration', () => {
  it('executes GET, POST, body assertion, wrong status, and invalid endpoint cases', async () => {
    const getService = service('api-get-001');
    getService.planExecution({
      id: 'API-GET',
      description: 'List users',
      domain: 'api',
      steps: [
        {
          id: 'STEP-001',
          action: 'request',
          target: { url: `${baseUrl}/users`, method: 'GET' },
          expected: { status: 200 },
        },
      ],
    });
    expect((await getService.executeExecution('api-get-001')).status).toBe('PASSED');
    const getState = getService.getExecutionState('api-get-001');
    expect(getState).toMatchObject({
      ok: true,
      state: {
        status: 'PASSED',
        stepStates: [{ stepId: 'STEP-001', status: 'PASSED' }],
      },
    });
    expect(getState.ok && getState.state.telemetry.map((event) => event.type)).toContain(
      'EXECUTION_PASSED',
    );
    expect(
      getState.ok
        ? getState.state.telemetry.find((event) => event.type === 'STEP_PASSED')?.metadata
        : undefined,
    ).toMatchObject({ responseStatus: 200 });
    await access('artifacts/executions/api-get-001/metadata/evidence.json');
    await access('artifacts/executions/api-get-001/reports/report.json');
    await access('artifacts/executions/api-get-001/reports/report.html');

    const postService = service('api-post-001');
    postService.planExecution({
      id: 'API-POST',
      description: 'Create user',
      domain: 'api',
      steps: [
        {
          id: 'STEP-001',
          action: 'request',
          target: { url: `${baseUrl}/users`, method: 'POST', body: { name: 'Grace' } },
          expected: { status: 201, bodyContains: { created: true } },
        },
      ],
    });
    expect((await postService.executeExecution('api-post-001')).status).toBe('PASSED');

    const bodyService = service('api-body-001');
    bodyService.planExecution({
      id: 'API-BODY',
      description: 'Read user',
      domain: 'api',
      steps: [
        {
          id: 'STEP-001',
          action: 'request',
          target: { url: `${baseUrl}/users/1`, method: 'GET' },
          expected: { bodyField: { path: 'name', equals: 'Ada' } },
        },
      ],
    });
    expect((await bodyService.executeExecution('api-body-001')).status).toBe('PASSED');

    const failureService = service('api-failure-001');
    failureService.planExecution({
      id: 'API-FAILURE',
      description: 'Wrong status',
      domain: 'api',
      steps: [
        {
          id: 'STEP-001',
          action: 'request',
          target: { url: `${baseUrl}/users`, method: 'GET' },
          expected: { status: 404 },
        },
      ],
    });
    expect((await failureService.executeExecution('api-failure-001')).results[0]?.error?.code).toBe(
      'RESPONSE_ASSERTION_FAILED',
    );

    const invalidService = service('api-invalid-001');
    invalidService.planExecution({
      id: 'API-INVALID',
      description: 'Missing endpoint',
      domain: 'api',
      steps: [
        {
          id: 'STEP-001',
          action: 'request',
          target: { url: `${baseUrl}/does-not-exist`, method: 'GET' },
          expected: { status: 404 },
        },
      ],
    });
    expect((await invalidService.executeExecution('api-invalid-001')).status).toBe('PASSED');
  }, 30_000);
});
