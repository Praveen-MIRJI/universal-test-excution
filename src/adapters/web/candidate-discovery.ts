import { type Page } from 'playwright';
import { type InternalElementCandidate } from './resolution.js';

export const DEFAULT_MAX_CANDIDATES = 40;
export const INTERACTIVE_CANDIDATE_SELECTOR =
  'a,button,input,textarea,select,[role],[aria-label],[placeholder],label,[data-testid],[name]';

interface DiscoveredElement {
  elementType: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  placeholder?: string;
  attributes: Record<string, string>;
  visible: boolean;
  enabled: boolean;
}

export class CandidateDiscovery {
  private readonly maxCandidates: number;

  public constructor(maxCandidates = DEFAULT_MAX_CANDIDATES) {
    this.maxCandidates = maxCandidates;
  }

  public async discover(page: Page): Promise<InternalElementCandidate[]> {
    const locator = page.locator(INTERACTIVE_CANDIDATE_SELECTOR);
    const elements = await locator.evaluateAll<DiscoveredElement[], number>((nodes, limit) =>
      nodes.slice(0, limit).map((node) => {
        const element = node as HTMLElement;
        const attributes: Record<string, string> = {};
        for (const attribute of ['id', 'name', 'data-testid', 'type', 'role', 'aria-label']) {
          const value = element.getAttribute(attribute);
          if (value) attributes[attribute] = value;
        }
        const role =
          element.getAttribute('role') ??
          (element.tagName.toLowerCase() === 'button'
            ? 'button'
            : element.tagName.toLowerCase() === 'a'
              ? 'link'
              : element.tagName.toLowerCase() === 'select'
              ? 'combobox'
              : ['input', 'textarea'].includes(element.tagName.toLowerCase())
                ? 'textbox'
                : undefined);
        return {
          elementType: element.tagName.toLowerCase(),
          ...(role ? { role } : {}),
          ...(element.getAttribute('aria-label')
            ? { accessibleName: element.getAttribute('aria-label')! }
            : {}),
          ...(element.textContent?.trim()
            ? { text: element.textContent.trim().slice(0, 200) }
            : {}),
          ...(element.getAttribute('placeholder')
            ? { placeholder: element.getAttribute('placeholder')! }
            : {}),
          attributes,
          visible: Boolean(
            element.offsetWidth || element.offsetHeight || element.getClientRects().length,
          ),
          enabled:
            !(
              element instanceof HTMLButtonElement ||
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement
            ) || !element.disabled,
        };
      }, this.maxCandidates),
    );

    return elements.slice(0, this.maxCandidates).map((candidate, locatorIndex) => ({
      ...candidate,
      locatorIndex,
      signals: [],
      score: 0,
    }));
  }
}
