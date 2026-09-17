export interface OpenAICompatibleProviderOptions {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const defaultTimeoutMs = 30_000;

export class OpenAICompatibleProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly request: typeof fetch;

  public constructor(options: OpenAICompatibleProviderOptions) {
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.request = options.fetch ?? fetch;
  }

  public async createNormalizedIntent(userRequest: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(this.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: normalizedIntentPrompt },
            { role: 'user', content: userRequest },
          ],
        }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(`LLM provider returned HTTP ${response.status}: ${extractError(payload)}`);
      }
      return parseIntent(extractContent(payload));
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        throw new Error(`LLM provider timed out after ${this.timeoutMs} ms.`);
      }
      if (error instanceof Error) throw error;
      throw new Error('LLM provider failed unexpectedly.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const normalizedIntentPrompt = `Convert the user's request into exactly one JSON object with this shape:
{
  "id": "stable identifier",
  "description": "short test description",
  "domain": "web or api",
  "steps": [
    {
      "id": "step identifier",
      "action": "request | navigate | click | fill | select | wait | assert",
      "target": "an object using semanticLabel, role, text, placeholder, url, method, headers, query, body, or attributes",
      "value": "optional value",
      "expected": "optional assertion object"
    }
  ]
}

Use technology-independent targets. For web actions, prefer semanticLabel, role, text, or placeholder. For API requests, include target.url and target.method. Include an expected assertion whenever the user asks to verify an outcome. Return JSON only; never return Markdown or explanations.`;

function extractContent(payload: unknown): string {
  const payloadRecord = asRecord(payload);
  const choices = Array.isArray(payloadRecord?.choices) ? payloadRecord.choices : [];
  const choice = choices[0];
  const message = asRecord(choice)?.message;
  const content = asRecord(message)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => asRecord(part)?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('');
    if (text) return text;
  }
  throw new Error('LLM provider response did not contain message content.');
}

function parseIntent(content: string): unknown {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    throw new Error('LLM provider returned invalid JSON for the execution intent.');
  }
}

function extractError(payload: unknown): string {
  const error = asRecord(asRecord(payload)?.error)?.message;
  return typeof error === 'string' ? error : 'unknown provider error';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}