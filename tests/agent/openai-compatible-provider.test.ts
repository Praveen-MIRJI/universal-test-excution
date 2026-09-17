import { describe, expect, it } from 'vitest';
import {
  normalizedIntentPrompt,
  OpenAICompatibleProvider,
} from '../../src/agent/openai-compatible-provider.js';

const intent = {
  id: 'LLM-001',
  description: 'Check the health endpoint',
  domain: 'api',
  steps: [
    {
      id: 'STEP-001',
      action: 'request',
      target: { url: 'http://localhost/health', method: 'GET' },
      expected: { status: 200 },
    },
  ],
};

describe('OpenAI-compatible provider', () => {
  it('converts a JSON chat completion into a normalized intent', async () => {
    let request: Request | undefined;
    const provider = new OpenAICompatibleProvider({
      endpoint: 'https://llm.test/v1/chat/completions',
      model: 'test-model',
      apiKey: 'secret',
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(intent)}\n\`\`\`` } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    await expect(provider.createNormalizedIntent('Check the health endpoint.')).resolves.toEqual(intent);
    expect(request?.headers.get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(await request!.text())).toMatchObject({
      model: 'test-model',
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  });

  it('rejects provider responses that are not JSON intents', async () => {
    const provider = new OpenAICompatibleProvider({
      endpoint: 'https://llm.test/v1/chat/completions',
      model: 'test-model',
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), {
          status: 200,
        }),
    });

    await expect(provider.createNormalizedIntent('Invalid response')).rejects.toThrow(
      'invalid JSON',
    );
  });

  it('constrains the model to the normalized execution contract', () => {
    expect(normalizedIntentPrompt).toContain('technology-independent targets');
    expect(normalizedIntentPrompt).toContain('Return JSON only');
  });
});