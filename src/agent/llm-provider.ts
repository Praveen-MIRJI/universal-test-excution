export interface LLMProvider {
  createNormalizedIntent(userRequest: string): Promise<unknown>;
}

export type IntentFactory = (userRequest: string) => unknown | Promise<unknown>;

export class DeterministicMockLLMProvider implements LLMProvider {
  private readonly factory: IntentFactory;

  public constructor(factory: IntentFactory) {
    this.factory = factory;
  }

  public createNormalizedIntent(userRequest: string): Promise<unknown> {
    return Promise.resolve(this.factory(userRequest));
  }
}