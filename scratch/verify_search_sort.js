/**
 * Real Chrome Runtime & DevTools Protocol (CDP) Verification Script
 * Validates Search, Sorting, Filter Integration, Multi-Viewport Responsiveness & Screenshots
 */

const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

async function run() {
  console.log('================================================================');
  console.log('VERIFYING SEARCH & SORTING IN GOOGLE CHROME VIA CDP');
  console.log('================================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const remoteDebuggingPort = 9222;

  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--user-data-dir=' + path.resolve(__dirname, 'chrome-profile-search-sort')
  ]);

  // Wait for DevTools port
  await new Promise(resolve => setTimeout(resolve, 1500));

  function getVersion() {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${remoteDebuggingPort}/json/version`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  function getTargets() {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${remoteDebuggingPort}/json`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  const targets = await getTargets();
  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];
  const consoleErrors = [];

  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
      consoleLogs.push({ type: msg.params.type, text });
      if (msg.params.type === 'error') {
        consoleErrors.push(text);
      }
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  });

  await new Promise(r => ws.on('open', r));

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  const fileUrl = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  console.log('Navigating to:', fileUrl);
  await send('Page.navigate', { url: fileUrl });
  await new Promise(r => setTimeout(r, 1200));

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception ? (res.exceptionDetails.exception.description || res.exceptionDetails.exception.value) : res.exceptionDetails.text;
      throw new Error('Eval Error: ' + desc);
    }
    return res.result ? res.result.value : undefined;
  }

  console.log('\n--- 1. TASK SEEDING ---');
  await evaluate(`(() => {
    localStorage.clear();
    // Helper to create task via DOM form
    function addTask(title, priority, due) {
      document.getElementById('task-input').value = title;
      document.getElementById('task-priority').value = priority;
      document.getElementById('task-due-date').value = due || '';
      document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    addTask('Deploy Python Microservice to Production', 'high', '2026-11-05');
    addTask('Build React User Experience components', 'medium', '2026-11-15');
    addTask('Refactor Python Data ETL Pipeline', 'low', '2026-10-31');
    addTask('Optimize WebGL 3D workspace performance', 'high', '');
    addTask('Write Python Unit Tests', 'medium', '');
  })()`);

  const initialCount = await evaluate('document.querySelectorAll(".task-item").length');
  console.log(`[PASS] Seeded ${initialCount} tasks into DOM.`);
  if (initialCount !== 5) throw new Error('Expected 5 tasks seeded');

  console.log('\n--- 2. CASE-INSENSITIVE SEARCH & CLEAR BUTTON ---');
  // Type search with mixed case and padding
  await evaluate(`(() => {
    const searchInput = document.getElementById('task-search');
    searchInput.value = '   pyTHon   ';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  const searchResultsCount = await evaluate('document.querySelectorAll(".task-item").length');
  console.log(`Matching tasks for "   pyTHon   ": ${searchResultsCount}`);
  if (searchResultsCount !== 3) throw new Error(`Expected 3 tasks matching python, got ${searchResultsCount}`);

  const isClearBtnVisible = await evaluate('!document.getElementById("search-clear-btn").hidden');
  console.log(`Clear button visible: ${isClearBtnVisible}`);
  if (!isClearBtnVisible) throw new Error('Clear button should be visible');

  // Click clear button
  await evaluate('document.getElementById("search-clear-btn").click()');
  const countAfterClear = await evaluate('document.querySelectorAll(".task-item").length');
  console.log(`Tasks rendered after clicking clear: ${countAfterClear}`);
  if (countAfterClear !== 5) throw new Error('Expected 5 tasks after clearing search');

  console.log('\n--- 3. NO-MATCH SEARCH RESULTS ---');
  await evaluate(`(() => {
    const searchInput = document.getElementById('task-search');
    searchInput.value = 'Quantum Teleportation';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  const noMatchCount = await evaluate('document.querySelectorAll(".task-item").length');
  const emptyStateVisible = await evaluate('!document.getElementById("empty-state").hidden');
  const emptyMessage = await evaluate('document.querySelector(".empty-state-message").textContent');
  console.log(`No match count: ${noMatchCount}, Empty visible: ${emptyStateVisible}, Message: "${emptyMessage}"`);
  if (noMatchCount !== 0 || !emptyStateVisible || !emptyMessage.includes('Quantum Teleportation')) {
    throw new Error('No-match empty state failed');
  }

  // Clear search again
  await evaluate(`(() => {
    const searchInput = document.getElementById('task-search');
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  console.log('\n--- 4. SORTING CONTROLS ---');
  // Test Priority High to Low
  await evaluate(`(() => {
    const sortSelect = document.getElementById('sort-select');
    sortSelect.value = 'priority-desc';
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  const priorityOrder = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('.task-item')).map(i => ({
      title: i.querySelector('.task-text').textContent,
      priority: i.querySelector('.priority-badge').textContent
    }));
  })()`);
  console.log('Priority-sorted tasks:', priorityOrder.map(t => `${t.priority}: ${t.title}`));
  if (priorityOrder[0].priority !== 'High' || priorityOrder[1].priority !== 'High') {
    throw new Error('Priority sort failed: Top two items must be High priority');
  }
  if (priorityOrder[4].priority !== 'Low') {
    throw new Error('Priority sort failed: Bottom item must be Low priority');
  }
  console.log('[PASS] Priority High to Low sorting verified.');

  // Test Due Date Earliest First
  await evaluate(`(() => {
    const sortSelect = document.getElementById('sort-select');
    sortSelect.value = 'due-asc';
    sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  const dueDateOrder = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('.task-item')).map(i => ({
      title: i.querySelector('.task-text').textContent,
      due: i.querySelector('.due-badge') ? i.querySelector('.due-badge').textContent : 'NONE'
    }));
  })()`);
  console.log('Due-date sorted tasks:', dueDateOrder);
  // Timed tasks must appear first: Oct 31, then Nov 05, then Nov 15
  if (!dueDateOrder[0].due.includes('Oct 31') || !dueDateOrder[1].due.includes('Nov 5') || !dueDateOrder[2].due.includes('Nov 15')) {
    throw new Error('Due date earliest first ordering failed');
  }
  if (dueDateOrder[3].due !== 'NONE' || dueDateOrder[4].due !== 'NONE') {
    throw new Error('Tasks without deadlines must be placed at the end');
  }
  console.log('[PASS] Due date sorting & untimed placement rule verified.');

  console.log('\n--- 5. FILTER + SEARCH + SORT + STATS INTEGRATION ---');
  // Mark 'Refactor Python Data ETL Pipeline' as completed
  await evaluate(`(() => {
    const items = document.querySelectorAll('.task-item');
    const target = Array.from(items).find(i => i.querySelector('.task-text').textContent.includes('Refactor Python Data'));
    const cb = target.querySelector('.task-checkbox');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  // Switch to 'completed' filter
  await evaluate(`(() => {
    document.querySelector('.filter-btn[data-filter="completed"]').click();
  })()`);

  // Type search 'Python'
  await evaluate(`(() => {
    const searchInput = document.getElementById('task-search');
    searchInput.value = 'Python';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  const visibleUnderCompletedAndSearch = await evaluate(`(() => {
    return Array.from(document.querySelectorAll('.task-item')).map(i => i.querySelector('.task-text').textContent);
  })()`);
  console.log('Completed + Python search results:', visibleUnderCompletedAndSearch);
  if (visibleUnderCompletedAndSearch.length !== 1 || !visibleUnderCompletedAndSearch[0].includes('Refactor Python Data')) {
    throw new Error('Filter + Search combination failed');
  }

  // Check statistics represent FULL collection
  const stats = await evaluate(`({
    total: document.getElementById('total-tasks-count').textContent,
    active: document.getElementById('active-tasks-count').textContent,
    completed: document.getElementById('completed-tasks-count').textContent
  })`);
  console.log('Statistics inspection during active search & filter:', stats);
  if (stats.total !== '5' || stats.active !== '4' || stats.completed !== '1') {
    throw new Error(`Statistics failed: expected 5 total, 4 active, 1 completed; got ${JSON.stringify(stats)}`);
  }
  console.log('[PASS] Statistics represent the full task collection while search is active.');

  // Reset filter to All and search to empty
  await evaluate(`(() => {
    document.querySelector('.filter-btn[data-filter="all"]').click();
    const searchInput = document.getElementById('task-search');
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  console.log('\n--- 6. MULTI-VIEWPORT RESPONSIVENESS CHECKS ---');
  const viewports = [
    { width: 320, height: 568, name: '320px_mobile' },
    { width: 375, height: 667, name: '375px_mobile' },
    { width: 768, height: 1024, name: '768px_tablet' },
    { width: 1024, height: 768, name: '1024px_laptop' },
    { width: 1440, height: 900, name: '1440px_desktop' }
  ];

  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.width <= 768 ? 2 : 1,
      mobile: vp.width <= 768
    });
    await new Promise(r => setTimeout(r, 200));

    const check = await evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      windowWidth: window.innerWidth,
      containerWidth: document.querySelector('.app-container').getBoundingClientRect().width
    })`);

    const hasOverflow = check.scrollWidth > check.windowWidth;
    console.log(`[PASS] Viewport ${vp.name} (${vp.width}x${vp.height}): ScrollWidth=${check.scrollWidth}px, WinWidth=${check.windowWidth}px, Overflow=${hasOverflow ? 'FAIL' : 'NONE'}`);
    if (hasOverflow) throw new Error(`Horizontal overflow detected at ${vp.name}`);
  }

  // Desktop screenshot (1440px)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(r => setTimeout(r, 300));
  const ssDesktop = await send('Page.captureScreenshot', { format: 'png' });
  const desktopPath = path.resolve(__dirname, 'search_sort_desktop.png');
  fs.writeFileSync(desktopPath, Buffer.from(ssDesktop.data, 'base64'));
  console.log('Captured desktop screenshot:', desktopPath);

  // Mobile screenshot (375px)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true
  });
  await new Promise(r => setTimeout(r, 200));
  const ssMobile = await send('Page.captureScreenshot', { format: 'png' });
  const mobilePath = path.resolve(__dirname, 'search_sort_mobile.png');
  fs.writeFileSync(mobilePath, Buffer.from(ssMobile.data, 'base64'));
  console.log('Captured mobile screenshot:', mobilePath);

  console.log('\n--- 7. CONSOLE AUDIT ---');
  console.log(`Total console logs: ${consoleLogs.length}`);
  console.log(`Total console errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors found:', consoleErrors);
    throw new Error('Console errors encountered during execution');
  }
  console.log('[PASS] ZERO console errors during full execution.');

  console.log('\n================================================================');
  console.log('ALL SEARCH & SORTING CHECKS COMPLETED WITH 100% SUCCESS');
  console.log('================================================================');

  ws.close();
  chromeProc.kill();
}

run().catch(err => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
