import { z } from 'zod';
import { type CallToolResult } from '@modelcontextprotocol/server';

export type StructuredToolResult<T> = CallToolResult & {
  structuredContent: T;
  content: [{ type: 'text'; text: string }];
};

export function createToolResult<T>(payload: T, isError = false): StructuredToolResult<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  } as StructuredToolResult<T>;
}

export const toolOutputSchema = z.object({}).passthrough();
