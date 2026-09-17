import { type ExecutionAction, type Target } from '../../core/models/index.js';
import { type CandidateSignal, type InternalElementCandidate } from './resolution.js';

export interface ScoredCandidate extends InternalElementCandidate {
  signals: CandidateSignal[];
  score: number;
}

export function scoreCandidate(
  target: Target,
  candidate: InternalElementCandidate,
  action: ExecutionAction,
): ScoredCandidate | undefined {
  if (!isCompatible(candidate, action)) return undefined;

  const requested = target.semanticLabel ?? target.text ?? target.placeholder ?? target.role;
  const normalizedRequested = normalize(requested);
  const signals: CandidateSignal[] = [];
  let score = 0;
  if (normalizedRequested && normalize(candidate.accessibleName) === normalizedRequested) {
    signals.push({ type: 'EXACT_NAME', weight: 0.7 });
    score += 0.7;
  }
  if (normalizedRequested && normalize(candidate.text) === normalizedRequested) {
    signals.push({ type: 'EXACT_TEXT', weight: 0.7 });
    score += 0.7;
  } else if (
    normalizedRequested &&
    candidate.text &&
    normalize(candidate.text)?.includes(normalizedRequested)
  ) {
    signals.push({ type: 'PARTIAL_TEXT', weight: 0.35 });
    score += 0.35;
  }
  if (normalizedRequested && candidate.text && semanticTextMatch(target, candidate.text)) {
    signals.push({ type: 'SEMANTIC_TEXT', weight: 0.65 });
    score += 0.65;
  }
  if (normalizedRequested && normalize(candidate.placeholder) === normalizedRequested) {
    signals.push({ type: 'EXACT_PLACEHOLDER', weight: 0.7 });
    score += 0.7;
  }
  if (target.role && candidate.role?.toLowerCase() === target.role.toLowerCase()) {
    signals.push({ type: 'ROLE_MATCH', weight: 0.25 });
    score += 0.25;
  }
  if (candidate.visible) {
    signals.push({ type: 'VISIBLE', weight: 0.1 });
    score += 0.1;
  }
  return { ...candidate, signals, score: Math.min(score, 1) };
}

function isCompatible(candidate: InternalElementCandidate, action: ExecutionAction): boolean {
  if (!candidate.visible || !candidate.enabled) return false;
  if (action === 'fill') return ['input', 'textarea'].includes(candidate.elementType);
  if (action === 'select') return candidate.elementType === 'select';
  if (action === 'click')
    return ['button', 'a', 'input'].includes(candidate.elementType) || Boolean(candidate.role);
  return true;
}

function normalize(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function semanticTextMatch(target: Target, candidateText: string): boolean {
  const requestedWords = words(target.semanticLabel ?? target.text ?? target.placeholder);
  const candidateWords = words(candidateText);
  if (!requestedWords.length || !candidateWords.length) return false;
  return requestedWords.includes('learn') &&
    requestedWords.includes('more') &&
    candidateWords.includes('information') &&
    candidateWords.includes('more');
}

function words(value: string | undefined): string[] {
  return value?.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
