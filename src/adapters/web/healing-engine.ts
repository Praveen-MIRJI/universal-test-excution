import { type Page } from 'playwright';
import { type ExecutionAction, type Target } from '../../core/models/index.js';
import { CandidateDiscovery } from './candidate-discovery.js';
import { scoreCandidate, type ScoredCandidate } from './candidate-scorer.js';
import {
  type ElementCandidate,
  type HealingResult,
  type InternalElementCandidate,
} from './resolution.js';

export const DEFAULT_HEALING_CONFIDENCE_THRESHOLD = 0.75;
export const DEFAULT_AMBIGUITY_MARGIN = 0.05;

export interface HealingDecision {
  result: HealingResult;
  candidate?: InternalElementCandidate;
}

export interface HealingEngineOptions {
  discovery?: CandidateDiscovery;
  confidenceThreshold?: number;
  ambiguityMargin?: number;
}

export class HealingEngine {
  private readonly discovery: CandidateDiscovery;
  private readonly confidenceThreshold: number;
  private readonly ambiguityMargin: number;

  public constructor(options: HealingEngineOptions = {}) {
    this.discovery = options.discovery ?? new CandidateDiscovery();
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_HEALING_CONFIDENCE_THRESHOLD;
    this.ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
  }

  public async heal(page: Page, target: Target, action: ExecutionAction): Promise<HealingDecision> {
    const discovered = await this.discovery.discover(page);
    const scored = discovered
      .map((candidate) => scoreCandidate(target, candidate, action))
      .filter((candidate): candidate is ScoredCandidate => candidate !== undefined)
      .sort((left, right) => right.score - left.score);
    const publicCandidates = scored.map((candidate) => toPublicCandidate(candidate));
    const best = scored[0];
    if (!best || best.score < this.confidenceThreshold) {
      return {
        result: {
          attempted: true,
          status: 'FAILED',
          originalTarget: target,
          candidates: publicCandidates,
          retrySucceeded: false,
          reason: 'No candidate exceeded the healing confidence threshold.',
        },
      };
    }
    const second = scored[1];
    if (second && best.score - second.score < this.ambiguityMargin) {
      return {
        result: {
          attempted: true,
          status: 'AMBIGUOUS',
          originalTarget: target,
          candidates: publicCandidates.slice(0, 5),
          confidence: best.score,
          retrySucceeded: false,
          reason: 'Multiple candidates have indistinguishable confidence scores.',
        },
      };
    }
    const candidate = toPublicCandidate(best);
    return {
      candidate: best,
      result: {
        attempted: true,
        status: 'HEALED',
        originalTarget: target,
        strategy: best.signals[0]?.type ?? 'CANDIDATE_MATCH',
        candidate,
        candidates: publicCandidates,
        confidence: best.score,
        signals: best.signals,
        retrySucceeded: false,
      },
    };
  }
}

function toPublicCandidate(candidate: InternalElementCandidate): ElementCandidate {
  const publicCandidate = { ...candidate } as Partial<InternalElementCandidate>;
  delete publicCandidate.locatorIndex;
  return publicCandidate as ElementCandidate;
}
