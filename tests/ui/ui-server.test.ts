import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runTestCases } from '../../src/ui/ui-server.js';

describe('UI execution bridge', () => {
  it('runs all supplied cases against the requested website URL', async () => {
    const html = await readFile(new URL('../fixtures/web-test-page.html', import.meta.url), 'utf8');
    const server: Server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('UI fixture did not start.');

    try {
      const result = await runTestCases({
        url: `http://127.0.0.1:${address.port}/`,
        testCases: [
          {
            id: 'UI-CASE-001',
            description: 'Submit the local form',
            steps: [
              { id: 'STEP-001', action: 'click', target: { role: 'button', semanticLabel: 'Submit' } },
              { id: 'STEP-002', action: 'assert', target: { text: 'Submitted successfully' }, expected: { visible: true } },
            ],
          },
          {
            id: 'UI-CASE-002',
            description: 'Verify the form heading',
            steps: [{ id: 'STEP-001', action: 'assert', target: { text: 'Test Form' }, expected: { visible: true } }],
          },
          {
            id: 'UI-CASE-INVALID',
            description: 'Unsupported extraction case',
            steps: [{ id: 'STEP-001', action: 'unsupported', target: { role: 'link' } }],
          },
          {
            id: 'UI-CASE-003',
            description: 'Runs after the invalid case',
            steps: [{ id: 'STEP-001', action: 'assert', target: { text: 'Test Form' }, expected: { visible: true } }],
          },
        ],
      });

      expect(result.status).toBe('FAILED');
      expect(result.totalCases).toBe(4);
      expect(result.passedCases).toBe(3);
      expect(result.failedCases).toBe(1);
      expect(result.totalSteps).toBe(6);
      expect(result.cases[2]).toMatchObject({
        id: 'UI-CASE-INVALID',
        status: 'FAILED',
        error: { code: 'INVALID_TEST_CASE' },
      });
      expect(result.cases[3]).toMatchObject({ id: 'UI-CASE-003', status: 'PASSED' });
      expect(result.cases.filter((testCase) => testCase.executionId)).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }, 30_000);

  it('rejects a run without a real website URL or test cases', async () => {
    await expect(runTestCases({ url: 'file:///tmp/test.html', testCases: [] })).rejects.toThrow(
      'valid http:// or https:// website URL',
    );
  });
});