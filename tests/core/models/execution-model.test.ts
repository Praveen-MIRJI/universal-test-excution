import { describe, expect, it } from 'vitest';
import {
  ExecutionIntentSchema,
  ExecutionStepSchema,
  ExpectedResultSchema,
  TargetSchema,
} from '../../../src/core/models/index.js';

const validStep = {
  id: 'STEP-001',
  action: 'click' as const,
  target: {
    semanticLabel: 'Add Employee button',
  },
};

describe('normalized execution model', () => {
  it('accepts a valid execution step', () => {
    expect(ExecutionStepSchema.parse(validStep)).toEqual(validStep);
  });

  it('accepts a valid execution intent', () => {
    const intent = {
      id: 'INTENT-001',
      description: 'Create an employee',
      domain: 'employee-management',
      steps: [validStep],
    };

    expect(ExecutionIntentSchema.parse(intent)).toEqual(intent);
  });

  it('rejects unsupported actions', () => {
    const result = ExecutionStepSchema.safeParse({
      ...validStep,
      action: 'pressKey',
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = ExecutionIntentSchema.safeParse({
      id: 'INTENT-001',
      description: 'Create an employee',
      domain: 'employee-management',
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty and technology-specific targets', () => {
    expect(TargetSchema.safeParse({}).success).toBe(false);
    expect(TargetSchema.safeParse({ selector: '.orangehrm-button' }).success).toBe(false);
  });

  it('rejects invalid expected results', () => {
    expect(ExpectedResultSchema.safeParse({}).success).toBe(false);
    expect(ExpectedResultSchema.safeParse({ status: 700 }).success).toBe(false);
    expect(ExpectedResultSchema.safeParse({ xpath: '//button' }).success).toBe(false);
  });

  it('accepts multiple steps', () => {
    const intent = {
      id: 'INTENT-002',
      description: 'Navigate and submit a form',
      domain: 'generic-web',
      steps: [
        {
          id: 'STEP-001',
          action: 'navigate' as const,
          target: { url: '/employees' },
        },
        validStep,
        {
          id: 'STEP-003',
          action: 'assert' as const,
          target: { text: 'Employee created' },
          expected: { visible: true, exists: true },
        },
      ],
    };

    expect(ExecutionIntentSchema.parse(intent).steps).toHaveLength(3);
  });

  it('accepts optional values, expectations, and metadata', () => {
    const step = {
      id: 'STEP-004',
      action: 'fill' as const,
      target: { placeholder: 'Employee name', attributes: { dataTestId: 'name' } },
      value: 'Ada Lovelace',
      expected: { text: 'Ada Lovelace' },
      metadata: { source: 'generated-intent', confidence: 0.98 },
    };

    expect(ExecutionStepSchema.parse(step)).toEqual(step);
  });

  it('accepts a generic API request and response assertions', () => {
    const step = {
      id: 'STEP-API-001',
      action: 'request' as const,
      target: {
        url: 'http://localhost:3000/users',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        query: { source: 'test' },
        body: { name: 'Ada' },
      },
      expected: { status: 201, bodyField: { path: 'name', equals: 'Ada' } },
    };

    expect(ExecutionStepSchema.parse(step)).toEqual(step);
  });
});
