import { type Locator, type Page } from 'playwright';
import { type Target } from '../../core/models/index.js';
import { INTERACTIVE_CANDIDATE_SELECTOR } from './candidate-discovery.js';
import { type ResolutionResult } from './resolution.js';

export class TargetResolver {
  public describe(target: Target): ResolutionResult {
    const strategy = target.semanticLabel
      ? 'semanticLabel'
      : target.role
        ? 'role'
        : target.text
          ? 'text'
          : target.placeholder
            ? 'placeholder'
            : 'attributes';
    return {
      status: 'RESOLVED',
      strategy,
      confidence: 1,
      target,
    };
  }

  public resolve(page: Page, target: Target): Locator {
    if (target.semanticLabel && target.role) {
      return page.getByRole(target.role as never, { name: target.semanticLabel });
    }

    if (target.semanticLabel) {
      return page.getByLabel(target.semanticLabel).or(page.getByPlaceholder(target.semanticLabel));
    }

    if (target.role) {
      return page.getByRole(target.role as never);
    }

    if (target.placeholder) {
      return page.getByPlaceholder(target.placeholder);
    }

    if (target.text) {
      return page.getByText(target.text);
    }

    if (target.attributes) {
      const attributeEntries = Object.entries(target.attributes);
      const selector = attributeEntries
        .map(([name, value]) => `[${name}="${this.escapeAttributeValue(value)}"]`)
        .join('');
      return page.locator(selector);
    }

    throw new Error('The target does not contain a supported resolution property.');
  }

  public resolveCandidate(page: Page, locatorIndex: number): Locator {
    return page.locator(INTERACTIVE_CANDIDATE_SELECTOR).nth(locatorIndex);
  }

  private escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
