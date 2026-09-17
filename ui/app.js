/* global document, fetch */

const exampleCases = [
  {
    id: 'CASE-001',
    description: 'Verify the example domain loads',
    steps: [
      { id: 'STEP-001', action: 'assert', target: { text: 'Example Domain' }, expected: { visible: true } }
    ]
  },
  {
    id: 'CASE-002',
    description: 'Verify the page heading exists',
    steps: [
      { id: 'STEP-001', action: 'assert', target: { role: 'heading' }, expected: { exists: true } }
    ]
  }
];

const form = document.querySelector('#run-form');
const urlInput = document.querySelector('#website-url');
const testCasesInput = document.querySelector('#test-cases');
const loadExample = document.querySelector('#load-example');
const runButton = document.querySelector('.run-button');
const runLabel = document.querySelector('#run-label');
const connectionState = document.querySelector('#connection-state');
const runTitle = document.querySelector('#run-title');
const runStatus = document.querySelector('#run-status');
const chatFeed = document.querySelector('#chat-feed');
const chatFooterText = document.querySelector('#chat-footer-text');

loadExample.addEventListener('click', () => {
  testCasesInput.value = JSON.stringify(exampleCases, null, 2);
});
testCasesInput.value = JSON.stringify(exampleCases, null, 2);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let testCases;
  try {
    testCases = JSON.parse(testCasesInput.value);
  } catch {
    showError('Test cases must be valid JSON.');
    return;
  }
  if (!Array.isArray(testCases)) {
    showError('Test cases must be a JSON array.');
    return;
  }

  setRunning(true);
  resetResults();
  addChat('layer', 'ORCHESTRATOR', `Prepared ${testCases.length} test case${testCases.length === 1 ? '' : 's'} for ${urlInput.value}.`);
  addChat('layer', 'MCP SERVER', 'Routing the suite to the WebAdapter through the execution engine...');
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value, testCases })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'The execution server rejected the run.');
    renderResults(payload);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Execution failed.');
  } finally {
    setRunning(false);
  }
});

function setRunning(running) {
  runButton.disabled = running;
  runLabel.textContent = running ? 'RUNNING SUITE...' : 'RUN ALL TESTS';
  connectionState.textContent = running ? 'EXECUTING' : 'READY';
  chatFooterText.textContent = running ? 'Browser execution in progress' : 'Awaiting execution input';
  document.querySelector('.chat-status-dot').classList.toggle('busy', running);
  if (running) {
    runStatus.textContent = 'RUNNING';
    runStatus.className = 'run-badge running';
    runTitle.textContent = 'Executing suite';
  }
}

function resetResults() {
  document.querySelector('#case-list').innerHTML = '<p class="empty-state">Running every case against the live page...</p>';
  document.querySelector('#case-count').textContent = 'RUNNING';
  document.querySelector('#case-chart').className = 'case-chart empty-state';
  document.querySelector('#case-chart').innerHTML = '<span>Collecting step results...</span>';
  document.querySelector('#passed-cases').textContent = '--';
  document.querySelector('#total-steps').textContent = '--';
  document.querySelector('#runtime').textContent = '--';
  document.querySelector('#health-percent').textContent = '--';
  document.querySelector('#donut-passed').textContent = '0';
  document.querySelector('#donut-failed').textContent = '0';
  chatFeed.innerHTML = '';
}

function renderResults(result) {
  const passRate = result.totalCases ? Math.round((result.passedCases / result.totalCases) * 100) : 0;
  const duration = result.cases.reduce((total, testCase) => total + testCase.durationMs, 0);
  runTitle.textContent = result.status === 'PASSED' ? 'Suite completed cleanly' : 'Suite needs attention';
  runStatus.textContent = result.status;
  runStatus.className = `run-badge ${result.status === 'PASSED' ? 'pass' : 'fail'}`;
  document.querySelector('#passed-cases').textContent = `${result.passedCases}/${result.totalCases}`;
  document.querySelector('#passed-cases-note').textContent = result.failedCases ? `${result.failedCases} case${result.failedCases === 1 ? '' : 's'} failed` : 'all journeys passed';
  document.querySelector('#total-steps').textContent = result.totalSteps;
  document.querySelector('#total-steps-note').textContent = `${result.passedSteps} passed / ${result.failedSteps} failed`;
  document.querySelector('#runtime').textContent = formatDuration(duration);
  document.querySelector('#health-percent').textContent = `${passRate}%`;
  document.querySelector('#donut-passed').textContent = result.passedCases;
  document.querySelector('#donut-failed').textContent = result.failedCases;
  document.querySelector('#health-donut').style.background = `conic-gradient(var(--green) ${passRate * 3.6}deg, var(--orange) ${passRate * 3.6}deg 360deg)`;
  renderChart(result.cases);
  renderCases(result.cases);
  addChat('layer', 'PLAYWRIGHT / WEB ADAPTER', `Visited ${result.url} and executed ${result.totalSteps} browser step${result.totalSteps === 1 ? '' : 's'}.`);
  result.cases.forEach((testCase) => {
    const kind = testCase.status === 'PASSED' ? 'success' : 'fail';
    const error = testCase.error ? ` Reason: ${testCase.error.message}` : '';
    const outcome = testCase.error?.code === 'INVALID_TEST_CASE'
      ? 'Skipped before execution'
      : testCase.status === 'PASSED' ? 'Passed' : 'Failed';
    addChat(kind, testCase.id, `${outcome}: ${testCase.description} (${formatDuration(testCase.durationMs)}).${error}`);
    const evidenceCount = testCase.evidence?.length || 0;
    if (evidenceCount) addChat('layer', 'EVIDENCE', `${testCase.id} produced ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'} and a report.`);
  });
  addChat(result.status === 'PASSED' ? 'success' : 'fail', 'RUNROOM / RESULT', result.status === 'PASSED' ? 'All test cases passed. Reports and artifacts are ready on the execution server.' : 'The suite completed with failures. Inspect the case rows and evidence details.');
}

function renderChart(cases) {
  const chart = document.querySelector('#case-chart');
  chart.className = 'case-chart';
  chart.innerHTML = cases.map((testCase) => {
    const total = Math.max(testCase.totalSteps, 1);
    const passedHeight = Math.max((testCase.passed / total) * 88, testCase.passed ? 8 : 2);
    const failedHeight = Math.max((testCase.failed / total) * 88, testCase.failed ? 8 : 2);
    return `<div class="bar-group"><div class="bars"><div class="bar" style="height:${passedHeight}px" title="${testCase.passed} passed"></div><div class="bar fail" style="height:${failedHeight}px" title="${testCase.failed} failed"></div></div><span class="bar-label">${escapeHtml(testCase.id)}</span></div>`;
  }).join('');
}

function renderCases(cases) {
  const list = document.querySelector('#case-list');
  document.querySelector('#case-count').textContent = `${cases.length} CASE${cases.length === 1 ? '' : 'S'}`;
  list.className = 'case-list';
  list.innerHTML = cases.map((testCase) => `<div class="case-row"><span class="case-state ${testCase.status === 'FAILED' ? 'fail' : ''}"></span><div class="case-name">${escapeHtml(testCase.description)}<span class="case-id">${escapeHtml(testCase.id)}${testCase.executionId ? ` / ${escapeHtml(testCase.executionId)}` : ''}</span></div><span class="case-tag ${testCase.status === 'FAILED' ? 'fail' : ''}">${testCase.status}</span><span class="case-duration">${formatDuration(testCase.durationMs)}</span></div>`).join('');
}

function addChat(type, label, message) {
  const element = document.createElement('div');
  element.className = `chat-message ${type}`;
  element.innerHTML = `<span class="chat-avatar">${label.charAt(0)}</span><div><small>${escapeHtml(label)}</small><p>${escapeHtml(message)}</p></div>`;
  chatFeed.appendChild(element);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function showError(message) {
  setRunning(false);
  runStatus.textContent = 'ERROR';
  runStatus.className = 'run-badge fail';
  runTitle.textContent = 'Run could not start';
  addChat('fail', 'RUNROOM / ERROR', message);
}

function formatDuration(milliseconds) {
  if (!milliseconds) return '0 ms';
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}
