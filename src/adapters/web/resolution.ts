import { type Target } from '../../core/models/index.js';

export type ResolutionStrategy = 'semanticLabel' | 'role' | 'text' | 'placeholder' | 'attributes';

export interface ResolutionResult {
  status: 'RESOLVED' | 'NOT_FOUND';
  strategy: ResolutionStrategy;
  confidence: number;
  target?: Target;
  reason?: string;
}

export interface CandidateSignal {
  type:
    | 'EXACT_NAME'
    | 'EXACT_TEXT'
    | 'EXACT_PLACEHOLDER'
    | 'ROLE_MATCH'
    | 'PARTIAL_TEXT'
    | 'SEMANTIC_TEXT'
    | 'VISIBLE';
  weight: number;
}

export interface ElementCandidate {
  elementType: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  placeholder?: string;
  attributes: Record<string, string>;
  visible: boolean;
  enabled: boolean;
  signals: CandidateSignal[];
  score: number;
}

export interface HealingResult {
  attempted: true;
  status: 'HEALED' | 'FAILED' | 'AMBIGUOUS';
  originalTarget: Target;
  strategy?: string;
  candidate?: ElementCandidate;
  candidates?: ElementCandidate[];
  confidence?: number;
  signals?: CandidateSignal[];
  retrySucceeded: boolean;
  reason?: string;
}

export interface InternalElementCandidate extends ElementCandidate {
  locatorIndex: number;
}
