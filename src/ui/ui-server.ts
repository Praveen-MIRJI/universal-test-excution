import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterRegistry } from '../adapters/adapter-registry.js';
import { WebAdapter } from '../adapters/web/web-adapter.js';
import { ExecutionService } from '../core/execution/execution-service.js';
import { ExecutionIntentSchema, type ExecutionIntent } from '../core/models/index.js';

const uiRoot = resolve(fileURLToPath(new URL('../../ui/', import.meta.url)));
const defaultPort = 4173;

export interface UiRunRequest {
  url: string;
  testCases: unknown[];
}

export interface UiCaseResult {
  id: string;
  description: string;
  executionId?: string;
  status: 'PASSED' | 'FAILED';
  durationMs: number;
  passed: number;
  failed: number;
  totalSteps: number;
  results: unknown[];
  evidence: unknown[];
  report?: unknown;
  telemetry: unknown[];
  error?: { code: string; message: string };
}

export interface UiRunResponse {
  url: string;
  startedAt: string;
  completedAt: string;
  status: 'PASSED' | 'FAILED';
  totalCases: number;
  passedCases: number;
  failedCases: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  cases: UiCaseResult[];
}

export function createUiServer(): ReturnType<typeof createServer> {
  return createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error: unknown) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unexpected UI server error.',
      });
    }
  });
}

export async function startUiServer(port = Number(process.env.UI_PORT ?? defaultPort)): Promise<void> {
  const server = createUiServer();
  await new Promise<void>((resolveServer) => server.listen(port, '127.0.0.1', resolveServer));
  console.log(`Universal Test Execution UI: http://127.0.0.1:${port}`);
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'POST' && requestUrl.pathname === '/api/run') {
    const body = await readJson(request);
    const result = await runTestCases(body);
    sendJson(response, 200, result);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  await serveStatic(requestUrl.pathname, response, request.method === 'HEAD');
}

export async function runTestCases(input: unknown): Promise<UiRunResponse> {
  const request = parseRunRequest(input);
  const startedAt = new Date().toISOString();
  const adapter = new WebAdapter();
  const service = new ExecutionService({
    closeAdapterAfterExecution: false,
    adapterRegistry: new AdapterRegistry([
      {
        descriptor: { name: 'web', status: 'available', framework: 'playwright' },
        adapter,
      },
    ]),
  });
  const cases: UiCaseResult[] = [];
  let initialNavigationPending = true;

  for (const testCase of request.testCases) {
    let intent: ExecutionIntent;
    try {
      intent = withUrl(testCase, request.url, initialNavigationPending);
    } catch (error: unknown) {
      cases.push({
        id: getCaseId(testCase),
        description: getCaseDescription(testCase),
        status: 'FAILED',
        durationMs: 0,
        passed: 0,
        failed: 1,
        totalSteps: getStepCount(testCase),
        results: [],
        evidence: [],
        telemetry: [],
        error: {
          code: 'INVALID_TEST_CASE',
          message: error instanceof Error ? error.message : 'The test case is invalid.',
        },
      });
      continue;
    }
    initialNavigationPending = false;

    const planned = service.planExecution(intent);
    if (!planned.ok) {
      cases.push({
        id: intent.id,
        description: intent.description,
        status: 'FAILED',
        durationMs: 0,
        passed: 0,
        failed: 1,
        totalSteps: intent.steps.length,
        results: [],
        evidence: [],
        telemetry: [],
        error: planned.error,
      });
      continue;
    }

    try {
      const execution = await service.executeExecution(planned.state.executionId);
      const state = service.getExecutionState(execution.executionId);
      const failedResult = execution.results.find((result) => result.error);
      cases.push({
        id: planned.state.intent.id,
        description: planned.state.intent.description,
        executionId: execution.executionId,
        status: execution.status === 'PASSED' ? 'PASSED' : 'FAILED',
        durationMs: execution.durationMs,
        passed: execution.passed,
        failed: execution.failed,
        totalSteps: execution.totalSteps,
        results: execution.results,
        evidence: service.getExecutionEvidence(execution.executionId),
        report: service.getExecutionReport(execution.executionId),
        telemetry: state.ok ? state.state.telemetry : [],
        ...(execution.error
          ? { error: execution.error }
          : failedResult?.error
            ? { error: failedResult.error }
            : {}),
      });
    } catch (error: unknown) {
      cases.push({
        id: planned.state.intent.id,
        description: planned.state.intent.description,
        executionId: planned.state.executionId,
        status: 'FAILED',
        durationMs: 0,
        passed: 0,
        failed: 1,
        totalSteps: planned.state.plan.length,
        results: [],
        evidence: service.getExecutionEvidence(planned.state.executionId),
        telemetry: service.getTelemetry(planned.state.executionId),
        error: {
          code: 'EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Execution failed.',
        },
      });
    }
  }

  await adapter.close();

  const completedAt = new Date().toISOString();
  const passedCases = cases.filter((testCase) => testCase.status === 'PASSED').length;
  return {
    url: request.url,
    startedAt,
    completedAt,
    status: passedCases === cases.length ? 'PASSED' : 'FAILED',
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    totalSteps: cases.reduce((total, testCase) => total + testCase.totalSteps, 0),
    passedSteps: cases.reduce((total, testCase) => total + testCase.passed, 0),
    failedSteps: cases.reduce((total, testCase) => total + testCase.failed, 0),
    cases,
  };
}

function parseRunRequest(input: unknown): UiRunRequest {
  if (typeof input !== 'object' || input === null) throw new Error('Run request must be a JSON object.');
  const record = input as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) {
    throw new Error('A valid http:// or https:// website URL is required.');
  }
  const testCases = Array.isArray(record.testCases) ? record.testCases : [];
  if (testCases.length === 0) throw new Error('At least one test case is required.');
  return { url, testCases };
}

function withUrl(testCase: unknown, url: string, includeNavigation: boolean): ExecutionIntent {
  if (typeof testCase !== 'object' || testCase === null) {
    throw new Error('Each test case must be a JSON object.');
  }
  const candidate = testCase as Record<string, unknown>;
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];
  const intent = {
    ...candidate,
    domain: 'web',
    steps: [
      ...(!includeNavigation || (steps[0] && typeof steps[0] === 'object' && (steps[0] as Record<string, unknown>).action === 'navigate')
        ? []
        : [{ id: `${String(candidate.id ?? 'CASE')}-NAVIGATE`, action: 'navigate', target: { url } }]),
      ...steps,
    ],
  };
  const parsed = ExecutionIntentSchema.safeParse(intent);
  if (!parsed.success) {
    throw new Error(`Invalid test case ${getCaseId(testCase)}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return parsed.data;
}

function getCaseId(testCase: unknown): string {
  return typeof testCase === 'object' && testCase !== null && typeof (testCase as Record<string, unknown>).id === 'string'
    ? (testCase as Record<string, unknown>).id as string
    : 'UNNAMED-CASE';
}

function getCaseDescription(testCase: unknown): string {
  return typeof testCase === 'object' && testCase !== null && typeof (testCase as Record<string, unknown>).description === 'string'
    ? (testCase as Record<string, unknown>).description as string
    : 'Unnamed test case';
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('Request body must contain valid JSON.');
  }
}

async function serveStatic(pathname: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(uiRoot, `.${normalize(requested)}`);
  if (!filePath.startsWith(`${uiRoot}\\`) && !filePath.startsWith(`${uiRoot}/`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  try {
    await access(filePath);
    response.writeHead(200, { 'content-type': contentType(extname(filePath)) });
    if (headOnly) response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

function contentType(extension: string): string {
  return { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[extension] ?? 'application/octet-stream';
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startUiServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'UI server failed to start.');
    process.exitCode = 1;
  });
}

function getStepCount(testCase: unknown): number {
  if (typeof testCase !== 'object' || testCase === null) return 0;
  const steps = (testCase as Record<string, unknown>).steps;
  return Array.isArray(steps) ? steps.length : 0;
}