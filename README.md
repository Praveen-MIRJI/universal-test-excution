# Universal Test Execution

An MCP-based universal test execution engine. Users provide a structured JSON test case that follows
the normalized execution model; the engine validates it and executes it through a registered adapter.

Natural-language test generation is not part of the current execution engine.

## Current Phase

Phase 7 adds local evidence, reporting, screenshots, and deterministic Web artifact generation to
the multi-domain execution engine:

```text
JSON test case
	-> Validator
	-> ExecutionPlanner
	-> ExecutionPlan
	-> ExecutionService
	     |- ExecutionStateManager
	     |- TelemetryManager
	     `- AdapterRegistry
	          |- WebAdapter -> Playwright -> local web application
	          `- APIAdapter -> HTTP -> local REST fixture
	-> State + Telemetry + EvidenceCollector
	-> JSON/HTML reports and generated Web artifact
```

The WebAdapter supports `navigate`, `click`, `fill`, `select`, `wait`, `assert`, and `extract`. Targets remain
technology-independent and are resolved through semantic labels, roles, text, placeholders, or
attributes. Users do not provide CSS, XPath, Playwright, or Selenium selectors.

## Commands

```text
npm install       Install dependencies
npm run typecheck Check TypeScript without emitting files
npm run build     Compile src/ to dist/
npm run lint      Run ESLint
npm test          Run Vitest
npm run format:check
```

The project targets Node.js 20 or newer and uses the official `@modelcontextprotocol/server` SDK.
Run `npm run build && npm start` to launch the MCP server over stdio. The `execute_intent` tool
validates and executes a normalized intent, while `get_execution_state` retrieves its in-memory
state and `list_available_adapters` reports registered adapters.

The complete user-facing path is available through the agent entrypoint. Configure an
OpenAI-compatible chat-completions endpoint and run `npm run build && npm run start:agent --
"Run the health check"`. The agent converts natural language into a normalized intent, calls the
MCP server over stdio, and returns execution status, state, evidence, reports, and artifacts:

```text
USER -> AgentOrchestrator -> OpenAI-compatible LLM
					 -> MCP client -> MCP server -> ExecutionService
					 -> WebAdapter/APIAdapter -> application
					 -> healing, telemetry, evidence -> reports/artifacts
```

Required environment variables are `LLM_API_URL` and `LLM_MODEL`; `LLM_API_KEY` is optional for
local providers. `npm run dev:agent -- "Run the health check"` uses the TypeScript source directly.

The local integration fixture in `tests/fixtures/web-test-page.html` is deterministic and requires
no external website or credentials.

## Browser UI

Run the dashboard with `npm run build && npm run start:ui`, then open
`http://127.0.0.1:4173`. The UI is isolated under `ui/`. Enter any reachable HTTP(S) website URL
and a JSON array of normalized Web test cases, then choose **Run all tests**. The server prepends
the URL as a navigation step, executes each case sequentially through Playwright, and returns the
run summary, case results, telemetry, evidence, and report data to the dashboard. Browser
execution happens server-side, so cross-origin pages do not need browser CORS configuration.

## Phase 7 Evidence and Artifacts

Each execution is isolated under:

```text
artifacts/executions/<executionId>/
	screenshots/
	reports/report.json
	reports/report.html
	generated/playwright-test.spec.ts   # Web only
	metadata/evidence.json
```

`EvidenceCollector` stores serializable evidence references for screenshots, API requests and
responses, healing, errors, state snapshots, and generated artifacts. `ReportGenerator` derives a
JSON report and self-contained HTML report from the existing state, telemetry, and evidence. The
report includes step status/duration, errors, healing details, evidence links, and the telemetry
timeline. `ArtifactGenerator` converts the normalized Web execution plan into deterministic,
readable Playwright TypeScript while preserving the original intent. It does not copy runtime
locators or healed targets. API executions generate evidence and reports but no API code artifact.

Web screenshots are enabled by default on failed steps and healed steps; successful-step screenshots
remain disabled. API request/response evidence uses bounded response bodies and redacts sensitive
headers such as Authorization, cookies, API keys, passwords, and tokens. Generated artifacts are
local and in-memory state/persistence remains unchanged; `.env` contents are never read.

The execution engine is domain-independent. Domain-specific behavior is implemented by adapters.
Both WebAdapter and APIAdapter implement the same generic `ExecutionAdapter` contract, and the
same `execute_intent`, `get_execution_state`, and `list_available_adapters` MCP tools serve both.

## Phase 4 Runtime Behavior

`ExecutionPlanner` deterministically wraps the validated JSON intent in an explicit plan. It does
not generate or alter test steps. `ExecutionStateManager` tracks the execution lifecycle
(`CREATED`, `PLANNED`, `RUNNING`, `PASSED`, `FAILED`) and step lifecycle (`PENDING`, `RUNNING`,
`PASSED`, `FAILED`, `SKIPPED`).

After each passed step, an in-memory checkpoint records the current step and completed step IDs.
`TelemetryManager` records typed execution and step events, which are available through
`get_execution_state`. All returned state is JSON serializable and uses defensive snapshots.

State, checkpoints, and telemetry are currently in-memory only. Resume, persistence, external
observability platforms, and AI planning are future extensions.

## API Execution

API requests use the normalized `request` action. Request details are represented generically in the
step target: `url`, `method`, optional `headers`, `query`, and `body`. Existing expectations are
reused for response validation with `status`, `bodyContains`, and `bodyField`.

The APIAdapter uses Node's built-in `fetch`, applies a configurable five-second default timeout,
and returns serializable response metadata. It supports status assertions, nested body containment,
and dotted response-field equality. Network, timeout, invalid-step, invalid-URL, and assertion
failures are returned using the generic structured adapter error model.

Request credentials and sensitive headers are not copied into telemetry. Response headers are
filtered for authorization, API key, cookie, password, and token names. The local API integration
fixture requires no external service.

To add a future adapter: implement `ExecutionAdapter`, register it with `AdapterRegistry`, map its
domain in the normalized intent, and add adapter tests. No MCP or execution-engine redesign is
required. SAP and Desktop adapters remain future extensions. API auto-healing is not implemented.

## Phase 5 Deterministic Healing

The WebAdapter first performs the original `TargetResolver` lookup. If that lookup cannot execute,
the `HealingEngine` performs one bounded recovery attempt:

```text
TargetResolver
	-> not found
	-> CandidateDiscovery
	-> CandidateScoring
	-> action-aware validation
	-> confidence and ambiguity checks
	-> one retry
```

Healing uses deterministic signals only. Exact accessible-name, text, or placeholder matches carry
the strongest score; role matching, partial text, and visibility contribute additional explainable
weights. Candidates must be visible, enabled, and compatible with the requested action. The default
confidence threshold is `0.75`, the ambiguity margin is `0.05`, and discovery is bounded to 40
candidates. Ambiguous or low-confidence candidates are rejected safely with structured details.

Healing results expose the original target, candidate, confidence, signals, retry outcome, and
whether the step was healed. Telemetry records healing start, candidate discovery/selection,
success, and failure events. LLM-based healing is not implemented in this phase.

## Future Adapter Extension

The registry is designed to support future adapters without changing the MCP layer or execution
service:

```text
Execution Engine
	-> Adapter Registry
			 |- WebAdapter (implemented)
			 |- APIAdapter (implemented)
			 |- SAPAdapter (future)
			 `- DesktopAdapter (future)
```

SAP and Desktop adapters, AI planning, checkpoint/resume, advanced external telemetry, API code
generation, and multi-agent execution are intentionally outside the current phase.

## Project map

- `src/mcp/` MCP server and protocol integration boundary
- `src/agent/` autonomous planning and execution boundary
- `src/core/` shared domain orchestration
- `src/adapters/` test framework and environment adapters
- `src/selector/` selector discovery and resolution
- `src/healing/` future selector healing strategies
- `src/state/` execution state and persistence boundary
- `src/telemetry/` metrics, logs, and tracing boundary
- `src/artifact/` reports, screenshots, and other execution artifacts
- `schemas/` external data and contract schemas
- `tests/` Vitest tests
- `data/` local runtime data
- `reports/` generated test reports
- `screenshots/` generated screenshots
