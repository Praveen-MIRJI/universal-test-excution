import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ExecutionState } from '../state/execution-state-manager.js';
import { type TelemetryEvent } from '../telemetry/telemetry-manager.js';
import { type EvidenceItem } from '../evidence/evidence-collector.js';

export interface ExecutionReport {
  executionId: string;
  status: ExecutionState['status'];
  intent: ExecutionState['intent'];
  domain: string;
  adapter: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  summary: { total: number; passed: number; failed: number; healed: number };
  steps: ExecutionState['stepStates'];
  results: ExecutionState['results'];
  errors: Array<{ stepId?: string; code: string; message: string }>;
  healing: Array<NonNullable<ExecutionState['results'][number]['healing']>>;
  evidence: EvidenceItem[];
  timeline: TelemetryEvent[];
  reportJsonPath?: string;
  reportHtmlPath?: string;
}

export interface ReportGeneratorOptions {
  artifactRoot?: string;
}

export class ReportGenerator {
  private readonly artifactRoot: string;
  private readonly reports = new Map<string, ExecutionReport>();

  public constructor(options: ReportGeneratorOptions = {}) {
    this.artifactRoot = resolve(options.artifactRoot ?? 'artifacts');
  }

  public async generate(
    state: ExecutionState,
    telemetry: TelemetryEvent[],
    evidence: EvidenceItem[],
  ): Promise<ExecutionReport> {
    const baseReport = this.createReport(state, telemetry, evidence);
    const directory = resolve(
      this.artifactRoot,
      'executions',
      safeId(state.executionId),
      'reports',
    );
    await mkdir(directory, { recursive: true });
    const reportJsonPath = resolve(directory, 'report.json');
    const reportHtmlPath = resolve(directory, 'report.html');
    const report: ExecutionReport = {
      ...baseReport,
      reportJsonPath,
      reportHtmlPath,
    };
    await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(reportHtmlPath, this.toHtml(report));
    this.reports.set(state.executionId, structuredClone(report));
    return report;
  }

  public getReport(executionId: string): ExecutionReport | undefined {
    const report = this.reports.get(executionId);
    return report ? structuredClone(report) : undefined;
  }

  public createReport(
    state: ExecutionState,
    telemetry: TelemetryEvent[],
    evidence: EvidenceItem[],
  ): ExecutionReport {
    const results = state.results;
    return {
      executionId: state.executionId,
      status: state.status,
      intent: state.intent,
      domain: state.executionPlan.domain,
      adapter: state.executionPlan.adapterName,
      startTime: state.createdAt,
      endTime: state.updatedAt,
      durationMs: results.reduce((total, result) => total + result.durationMs, 0),
      summary: {
        total: state.plan.length,
        passed: results.filter((result) => result.status === 'PASSED').length,
        failed: results.filter((result) => result.status === 'FAILED').length,
        healed: results.filter((result) => result.healed).length,
      },
      steps: state.stepStates,
      results,
      errors: results.flatMap((result) =>
        result.error ? [{ stepId: result.stepId, ...result.error }] : [],
      ),
      healing: results.flatMap((result) => (result.healing ? [result.healing] : [])),
      evidence,
      timeline: telemetry,
    };
  }

  private toHtml(report: ExecutionReport): string {
    const stepRows = report.steps
      .map((step) => {
        const result = report.results.find((item) => item.stepId === step.stepId);
        return `<tr><td>${escapeHtml(step.stepId)}</td><td>${escapeHtml(step.action)}</td><td>${escapeHtml(step.status)}</td><td>${step.durationMs ?? ''}</td><td>${result?.healed ? 'HEALED' : ''}</td><td>${escapeHtml(step.error?.message ?? '')}</td></tr>`;
      })
      .join('');
    const timeline = report.timeline
      .map(
        (event) =>
          `<li>${escapeHtml(event.timestamp)} ${escapeHtml(event.type)}${event.stepId ? ` (${escapeHtml(event.stepId)})` : ''}</li>`,
      )
      .join('');
    const evidence = report.evidence
      .map(
        (item) =>
          `<li>${escapeHtml(item.type)}: ${escapeHtml(item.description)}${item.path ? ` <a href="${escapeHtml(item.path)}">artifact</a>` : ''}</li>`,
      )
      .join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Execution ${escapeHtml(report.executionId)}</title><style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202124}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.5rem;text-align:left}th{background:#f3f4f6}.status{font-weight:700;color:${report.status === 'PASSED' ? '#176b3a' : '#a32020'}}</style></head><body><h1>Execution Report</h1><p>Execution ID: <strong>${escapeHtml(report.executionId)}</strong></p><p>Status: <span class="status">${escapeHtml(report.status)}</span></p><p>Domain: ${escapeHtml(report.domain)} | Adapter: ${escapeHtml(report.adapter)} | Duration: ${report.durationMs} ms</p><h2>Summary</h2><p>${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed, ${report.summary.healed} healed</p><h2>Step Results</h2><table><thead><tr><th>Step</th><th>Action</th><th>Status</th><th>Duration (ms)</th><th>Recovery</th><th>Error</th></tr></thead><tbody>${stepRows}</tbody></table><h2>Healing / Recovery</h2><pre>${escapeHtml(JSON.stringify(report.healing, null, 2))}</pre><h2>Timeline</h2><ol>${timeline}</ol><h2>Errors</h2><pre>${escapeHtml(JSON.stringify(report.errors, null, 2))}</pre><h2>Evidence</h2><ul>${evidence}</ul></body></html>`;
  }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
