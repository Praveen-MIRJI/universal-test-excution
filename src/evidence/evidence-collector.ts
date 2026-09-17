import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const evidenceTypes = [
  'SCREENSHOT',
  'REQUEST',
  'RESPONSE',
  'EXECUTION_LOG',
  'STATE_SNAPSHOT',
  'HEALING',
  'ERROR',
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

export interface EvidenceItem {
  id: string;
  executionId: string;
  type: EvidenceType;
  stepId?: string;
  timestamp: string;
  path?: string;
  description: string;
  data?: Record<string, unknown>;
}

export interface EvidenceCollectorOptions {
  artifactRoot?: string;
  now?: () => Date;
  createEvidenceId?: () => string;
}

export class EvidenceCollector {
  private readonly items = new Map<string, EvidenceItem[]>();
  private readonly artifactRoot: string;
  private readonly now: () => Date;
  private readonly createEvidenceId: () => string;

  public constructor(options: EvidenceCollectorOptions = {}) {
    this.artifactRoot = resolve(options.artifactRoot ?? 'artifacts');
    this.now = options.now ?? (() => new Date());
    this.createEvidenceId = options.createEvidenceId ?? randomUUID;
  }

  public record(
    input: Omit<EvidenceItem, 'id' | 'timestamp'> & { timestamp?: string },
  ): EvidenceItem {
    const item: EvidenceItem = {
      ...input,
      id: this.createEvidenceId(),
      timestamp: input.timestamp ?? this.now().toISOString(),
    };
    const executionItems = this.items.get(item.executionId) ?? [];
    executionItems.push(structuredClone(item));
    this.items.set(item.executionId, executionItems);
    return structuredClone(item);
  }

  public getExecutionEvidence(executionId: string): EvidenceItem[] {
    return structuredClone(this.items.get(executionId) ?? []);
  }

  public getExecutionDirectory(executionId: string): string {
    return this.safeExecutionPath(executionId);
  }

  public async persist(executionId: string): Promise<string> {
    const directory = this.safeExecutionPath(executionId);
    const evidencePath = resolve(directory, 'metadata', 'evidence.json');
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(
      evidencePath,
      `${JSON.stringify(this.getExecutionEvidence(executionId), null, 2)}\n`,
    );
    return evidencePath;
  }

  private safeExecutionPath(executionId: string): string {
    const safeId = executionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const directory = resolve(this.artifactRoot, 'executions', safeId);
    const root = resolve(this.artifactRoot, 'executions') + sep;
    if (!directory.startsWith(root)) {
      throw new Error('Execution artifact path is outside the artifact directory.');
    }
    return directory;
  }
}
