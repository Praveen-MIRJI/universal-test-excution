import { describe, expect, it } from 'vitest';
import { type Page } from 'playwright';
import { HealingEngine } from '../../../src/adapters/web/healing-engine.js';
import { type CandidateDiscovery } from '../../../src/adapters/web/candidate-discovery.js';
import { type InternalElementCandidate } from '../../../src/adapters/web/resolution.js';

function discovery(candidates: InternalElementCandidate[]): CandidateDiscovery {
  return { discover: async () => candidates } as unknown as CandidateDiscovery;
}

const button = (text: string, locatorIndex: number): InternalElementCandidate => ({
  locatorIndex,
  elementType: 'button',
  text,
  attributes: {},
  visible: true,
  enabled: true,
  signals: [],
  score: 0,
});

describe('HealingEngine', () => {
  it('selects a high-confidence compatible candidate', async () => {
    const engine = new HealingEngine({ discovery: discovery([button('Log in', 0)]) });

    const decision = await engine.heal({} as Page, { semanticLabel: 'Login' }, 'click');

    expect(decision.result).toMatchObject({ status: 'HEALED', confidence: expect.any(Number) });
    expect(decision.candidate?.locatorIndex).toBe(0);
  });

  it('rejects ambiguous candidates', async () => {
    const engine = new HealingEngine({
      discovery: discovery([button('Submit', 0), button('Submit', 1)]),
    });

    const decision = await engine.heal({} as Page, { text: 'Submit' }, 'click');

    expect(decision.result).toMatchObject({ status: 'AMBIGUOUS', retrySucceeded: false });
  });

  it('rejects candidates below the configured threshold', async () => {
    const engine = new HealingEngine({
      discovery: discovery([button('Continue', 0)]),
      confidenceThreshold: 0.9,
    });

    const decision = await engine.heal({} as Page, { text: 'Login' }, 'click');

    expect(decision.result).toMatchObject({ status: 'FAILED', retrySucceeded: false });
  });
});
