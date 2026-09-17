import { type ExecutionAdapter } from './adapter.js';

export const adapterStatuses = ['planned', 'available'] as const;
export type AdapterStatus = (typeof adapterStatuses)[number];

export interface AdapterDescriptor {
  name: string;
  status: AdapterStatus;
  framework: string;
}

export interface RegisteredAdapter {
  descriptor: AdapterDescriptor;
  adapter?: ExecutionAdapter;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, RegisteredAdapter>();

  public constructor(initialAdapters: readonly RegisteredAdapter[] = []) {
    for (const adapter of initialAdapters) {
      this.register(adapter);
    }
  }

  public register(adapter: RegisteredAdapter): void {
    this.adapters.set(adapter.descriptor.name, adapter);
  }

  public list(): AdapterDescriptor[] {
    return [...this.adapters.values()].map(({ descriptor }) => descriptor);
  }

  public get(name: string): ExecutionAdapter | undefined {
    return this.adapters.get(name)?.adapter;
  }

  public getDescriptor(name: string): AdapterDescriptor | undefined {
    return this.adapters.get(name)?.descriptor;
  }
}

export function createDefaultAdapterRegistry(
  adapter?: ExecutionAdapter,
  apiAdapter?: ExecutionAdapter,
): AdapterRegistry {
  const adapters: RegisteredAdapter[] = [
    {
      descriptor: {
        name: 'web',
        status: adapter ? 'available' : 'planned',
        framework: 'playwright',
      },
      ...(adapter ? { adapter } : {}),
    },
  ];
  if (apiAdapter) {
    adapters.push({
      descriptor: { name: 'api', status: 'available', framework: 'fetch' },
      adapter: apiAdapter,
    });
  }
  return new AdapterRegistry(adapters);
}
