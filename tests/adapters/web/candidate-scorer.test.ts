import { describe, expect, it } from 'vitest';
import { scoreCandidate } from '../../../src/adapters/web/candidate-scorer.js';
import { type InternalElementCandidate } from '../../../src/adapters/web/resolution.js';

const candidate: InternalElementCandidate = {
  locatorIndex: 0,
  elementType: 'button',
  text: 'Log in',
  attributes: {},
  visible: true,
  enabled: true,
  signals: [],
  score: 0,
};

describe('candidate scoring', () => {
  it('scores normalized exact text higher than a partial match', () => {
    const exact = scoreCandidate({ text: 'Login' }, candidate, 'click');
    const partial = scoreCandidate(
      { text: 'Log' },
      { ...candidate, text: 'Log in to continue' },
      'click',
    );

    expect(exact?.score).toBeGreaterThan(partial?.score ?? 0);
    expect(exact?.signals.map((signal) => signal.type)).toContain('EXACT_TEXT');
  });

  it('rejects incompatible candidates for actions', () => {
    expect(
      scoreCandidate({ text: 'Log in' }, { ...candidate, elementType: 'button' }, 'fill'),
    ).toBeUndefined();
  });

  it('rejects invisible and disabled candidates', () => {
    expect(
      scoreCandidate({ text: 'Log in' }, { ...candidate, visible: false }, 'click'),
    ).toBeUndefined();
    expect(
      scoreCandidate({ text: 'Log in' }, { ...candidate, enabled: false }, 'click'),
    ).toBeUndefined();
  });

  it('recognizes equivalent link wording for deterministic healing', () => {
    const result = scoreCandidate(
      { text: 'Learn more' },
      { ...candidate, elementType: 'a', text: 'More information...' },
      'click',
    );

    expect(result?.score).toBeGreaterThanOrEqual(0.75);
    expect(result?.signals.map((signal) => signal.type)).toContain('SEMANTIC_TEXT');
  });
});
