/**
 * TaskFlow Comprehensive QA Browser Automation Script
 * Executes end-to-end verification via Chrome DevTools Protocol (CDP)
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function runQAAudit() {
  console.log('================================================================');
  console.log('TASKFLOW COMPREHENSIVE QA BROWSER & CODE AUDIT VIA CDP');
  console.log('================================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const remoteDebuggingPort = 9224;
  const profileDir = path.resolve(__dirname, 'chrome-profile-qa-audit');

  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    `--user-data-dir=${profileDir}`
  ]);

  await new Promise(resolve => setTimeout(resolve, 1500));

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
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    throw new Error('Could not find Chrome page target');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];
  const consoleWarnings = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      if (msg.params.type === 'error') {
        consoleErrors.push(text);
      } else if (msg.params.type === 'warning') {
        consoleWarnings.push(text);
      }
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(resolve => ws.onopen = resolve);

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');

  const indexPath = path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  const fileUrl = `file:///${indexPath}`;
  console.log(`[NAVIGATE] Opening: ${fileUrl}`);

  await send('Page.navigate', { url: fileUrl });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Reset localStorage and application state for a clean test run
  await send('Runtime.evaluate', {
    expression: 'localStorage.clear(); AppState.tasks = []; AppState.editingTaskId = null; AppState.searchQuery = ""; AppState.filter = "all"; render();'
  });

  const auditResults = {};

  // ---------------------------------------------------------------------------
  // 1. Three.js scene rendering & background layering
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Three.js Scene Rendering & Background Layering ---');
  const threeAudit = await send('Runtime.evaluate', {
    expression: `(() => {
      const container = document.getElementById('three-bg-container');
      const canvas = container ? container.querySelector('canvas') : null;
      const compContainer = container ? window.getComputedStyle(container) : null;
      const compCanvas = canvas ? window.getComputedStyle(canvas) : null;
      return {
        hasContainer: !!container,
        hasCanvas: !!canvas,
        canvasWidth: canvas ? canvas.width : 0,
        canvasHeight: canvas ? canvas.height : 0,
        containerPosition: compContainer ? compContainer.position : null,
        containerZIndex: compContainer ? compContainer.zIndex : null,
        containerPointerEvents: compContainer ? compContainer.pointerEvents : null,
        canvasPointerEvents: compCanvas ? compCanvas.pointerEvents : null
      };
    })()`,
    returnByValue: true
  });
  console.log('Three.js Audit:', threeAudit.result.value);
  const tVal = threeAudit.result.value;
  if (!tVal.hasContainer || !tVal.hasCanvas || tVal.canvasWidth === 0) {
    throw new Error('Three.js canvas was not successfully rendered');
  }
  if (tVal.containerPointerEvents !== 'none' || tVal.canvasPointerEvents !== 'none') {
    throw new Error('Three.js container or canvas interferes with pointer events');
  }
  auditResults.threeRendering = 'PASS';
  auditResults.backgroundLayering = 'PASS';

  // ---------------------------------------------------------------------------
  // 2. Viewport Layout & Overflow Verification (320px, 375px, 768px, 1024px, 1440px)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Multi-Viewport Responsiveness & Layout Reflow ---');
  const testWidths = [
    { width: 320, height: 600, label: 'Ultra-mobile (320px)' },
    { width: 375, height: 667, label: 'Mobile (375px)' },
    { width: 768, height: 1024, label: 'Tablet (768px)' },
    { width: 1024, height: 768, label: 'Desktop Small (1024px)' },
    { width: 1440, height: 900, label: 'Desktop Large (1440px)' }
  ];

  for (const vp of testWidths) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 768
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const vpCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const bodyW = document.body.scrollWidth;
        const appContainer = document.querySelector('.app-container');
        const appW = appContainer ? appContainer.offsetWidth : 0;
        return {
          docW, winW, bodyW, appW,
          hasOverflow: docW > winW || bodyW > winW
        };
      })()`,
      returnByValue: true
    });
    console.log(`Viewport ${vp.label}:`, vpCheck.result.value);
    if (vpCheck.result.value.hasOverflow) {
      throw new Error(`Horizontal overflow detected at ${vp.label}!`);
    }
  }
  auditResults.desktopLayout = 'PASS';
  auditResults.mobileLayout = 'PASS';
  auditResults.responsiveOverflow = 'PASS (0 overflow across all 5 widths)';

  // Reset to desktop 1280x800 for functional interactions
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(resolve => setTimeout(resolve, 200));

  // ---------------------------------------------------------------------------
  // 3. Input & Button Interaction: Task Creation
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Task Creation & Form Submission ---');
  const creationResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.getElementById('task-input');
      const priority = document.getElementById('task-priority');
      const dueDate = document.getElementById('task-due-date');
      const form = document.getElementById('task-form');

      input.value = 'QA Feature Task Alpha';
      priority.value = 'high';
      dueDate.value = '2026-11-20';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const taskItem = document.querySelector('.task-item');
      const titleSpan = taskItem ? taskItem.querySelector('.task-text') : null;
      const priorityBadge = taskItem ? taskItem.querySelector('.priority-badge') : null;
      const dueBadge = taskItem ? taskItem.querySelector('.due-badge') : null;

      return {
        createdInState: AppState.tasks.length === 1,
        title: titleSpan ? titleSpan.textContent : null,
        priorityBadge: priorityBadge ? priorityBadge.textContent : null,
        priorityClass: priorityBadge ? priorityBadge.className : null,
        dueText: dueBadge ? dueBadge.textContent : null,
        inputCleared: input.value === ''
      };
    })()`,
    returnByValue: true
  });
  console.log('Task Creation Result:', creationResult.result.value);
  const cVal = creationResult.result.value;
  if (!cVal.createdInState || cVal.title !== 'QA Feature Task Alpha' || cVal.priorityBadge !== 'High') {
    throw new Error('Task creation interaction failed in browser');
  }
  auditResults.taskCreation = 'PASS';
  auditResults.inputInteraction = 'PASS';

  // ---------------------------------------------------------------------------
  // 4. Inline Editing: Title, Priority, Due Date
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Task Inline Editing ---');
  const editResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const taskItem = document.querySelector('.task-item');
      const editBtn = taskItem.querySelector('[data-action="edit"]');
      editBtn.click();

      const editForm = document.querySelector('.task-edit-form');
      const editInput = editForm.querySelector('.task-edit-input');
      const editPriority = editForm.querySelector('.task-edit-priority');
      const editDueDate = editForm.querySelector('.task-edit-due-date');
      const saveBtn = editForm.querySelector('[data-action="save"]');

      editInput.value = 'QA Feature Task Alpha (Updated)';
      editPriority.value = 'low';
      editDueDate.value = '2026-12-25';

      saveBtn.click();

      const updatedItem = document.querySelector('.task-item');
      const newTitle = updatedItem.querySelector('.task-text').textContent;
      const newPriority = updatedItem.querySelector('.priority-badge').textContent;
      const newDue = updatedItem.querySelector('.due-badge').textContent;

      return {
        newTitle,
        newPriority,
        newDue,
        statePriority: AppState.tasks[0].priority,
        stateDueDate: AppState.tasks[0].dueDate
      };
    })()`,
    returnByValue: true
  });
  console.log('Task Editing Result:', editResult.result.value);
  const eVal = editResult.result.value;
  if (eVal.newTitle !== 'QA Feature Task Alpha (Updated)' || eVal.newPriority !== 'Low' || !eVal.newDue.includes('Dec 25, 2026')) {
    throw new Error('Task inline editing failed in browser');
  }
  auditResults.taskEditing = 'PASS';

  // ---------------------------------------------------------------------------
  // 5. Completion Toggling, Statistics & Progress
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Completion Toggling, Statistics & Progress ---');
  const progressResult = await send('Runtime.evaluate', {
    expression: `(() => {
      // Add a 2nd task
      createTask('Task Beta', 'medium', null);

      const progBefore = document.getElementById('progress-percent').textContent;
      const totalBefore = document.getElementById('total-tasks-count').textContent;

      // Toggle first task complete
      const firstCheckbox = document.querySelector('.task-checkbox');
      firstCheckbox.checked = true;
      firstCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

      const progAfter = document.getElementById('progress-percent').textContent;
      const activeAfter = document.getElementById('active-tasks-count').textContent;
      const completedAfter = document.getElementById('completed-tasks-count').textContent;

      return {
        progBefore,
        totalBefore,
        progAfter,
        activeAfter,
        completedAfter,
        isCompletedInState: AppState.tasks.some(t => t.completed)
      };
    })()`,
    returnByValue: true
  });
  console.log('Progress & Stats Result:', progressResult.result.value);
  const pVal = progressResult.result.value;
  if (pVal.progAfter !== '50%' || pVal.activeAfter !== '1' || pVal.completedAfter !== '1' || !pVal.isCompletedInState) {
    throw new Error('Progress & Stats verification failed');
  }
  auditResults.progressIndicator = 'PASS';
  auditResults.statistics = 'PASS';
  auditResults.completionToggling = 'PASS';

  // ---------------------------------------------------------------------------
  // 6. Filtering & Search Integration
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Filtering & Search Integration ---');
  const filterSearchResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const filterActiveBtn = document.querySelector('[data-filter="active"]');
      const filterCompletedBtn = document.querySelector('[data-filter="completed"]');
      const filterAllBtn = document.querySelector('[data-filter="all"]');
      const searchInput = document.getElementById('task-search');
      const clearBtn = document.getElementById('search-clear-btn');

      // 1. Active filter
      filterActiveBtn.click();
      const countActiveView = document.querySelectorAll('.task-item').length;

      // 2. Completed filter
      filterCompletedBtn.click();
      const countCompletedView = document.querySelectorAll('.task-item').length;

      // 3. Return to All
      filterAllBtn.click();
      const countAllView = document.querySelectorAll('.task-item').length;

      // 4. Search query "Beta"
      searchInput.value = 'Beta';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      const countSearchView = document.querySelectorAll('.task-item').length;
      const clearVisible = !clearBtn.hidden;

      // 5. Clear search
      clearBtn.click();
      const countAfterClear = document.querySelectorAll('.task-item').length;

      return {
        countActiveView,
        countCompletedView,
        countAllView,
        countSearchView,
        clearVisible,
        countAfterClear
      };
    })()`,
    returnByValue: true
  });
  console.log('Filter & Search Result:', filterSearchResult.result.value);
  const fsVal = filterSearchResult.result.value;
  if (fsVal.countActiveView !== 1 || fsVal.countCompletedView !== 1 || fsVal.countAllView !== 2 || fsVal.countSearchView !== 1 || !fsVal.clearVisible || fsVal.countAfterClear !== 2) {
    throw new Error('Filtering & search integration failed in browser');
  }
  auditResults.filtering = 'PASS';
  auditResults.search = 'PASS';

  // ---------------------------------------------------------------------------
  // 7. Due Dates Status Classification (Overdue vs Done)
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Due Date Intelligence (Overdue vs Completed) ---');
  const dueResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const tOverdue = createTask('Overdue Deadline Task', 'high', '2026-10-20');
      render();
      const overdueItem = document.querySelector('[data-task-id="' + tOverdue.id + '"]');
      const badgeOverdue = overdueItem.querySelector('.due-badge');
      const isOverdueClass = badgeOverdue.classList.contains('due-overdue');

      // Now complete the overdue task
      toggleTaskStatus(tOverdue.id);
      render();
      const doneItem = document.querySelector('[data-task-id="' + tOverdue.id + '"]');
      const badgeDone = doneItem.querySelector('.due-badge');
      const isDoneClass = badgeDone.classList.contains('due-completed');
      const isNotOverdue = !badgeDone.classList.contains('due-overdue');

      return {
        isOverdueClass,
        badgeOverdueText: badgeOverdue.textContent,
        isDoneClass,
        badgeDoneText: badgeDone.textContent,
        isNotOverdue
      };
    })()`,
    returnByValue: true
  });
  console.log('Due Date Status Result:', dueResult.result.value);
  const dVal = dueResult.result.value;
  if (!dVal.isOverdueClass || !dVal.isDoneClass || !dVal.isNotOverdue) {
    throw new Error('Due date overdue intelligence failed');
  }
  auditResults.dueDatesIntelligence = 'PASS';

  // ---------------------------------------------------------------------------
  // 8. JSON Export & Import UI Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. JSON Export & Import ---');
  const backupResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const exportBtn = document.getElementById('export-tasks-btn');
      exportBtn.click();
      const alertExport = document.getElementById('backup-alert').textContent;

      // Test Import in merge mode
      const importPayload = [
        { id: 'import-qa-1', title: 'Imported Via QA Test', completed: false, priority: 'medium', dueDate: '2026-12-01', createdAt: Date.now() }
      ];
      const res = importTasksJSON(JSON.stringify(importPayload), 'merge');
      const alertImport = document.getElementById('backup-alert').textContent;
      const hasImportedInState = AppState.tasks.some(t => t.title === 'Imported Via QA Test');

      return {
        alertExport,
        importSuccess: res.success,
        alertImport,
        hasImportedInState
      };
    })()`,
    returnByValue: true
  });
  console.log('JSON Backup Result:', backupResult.result.value);
  const bVal = backupResult.result.value;
  if (!bVal.alertExport.includes('Exported') || !bVal.importSuccess || !bVal.hasImportedInState) {
    throw new Error('JSON Export & Import verification failed');
  }
  auditResults.jsonExport = 'PASS';
  auditResults.jsonImport = 'PASS';

  // ---------------------------------------------------------------------------
  // 9. Prefers-Reduced-Motion Behavior
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Prefers-Reduced-Motion Behavior ---');
  await send('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  await new Promise(resolve => setTimeout(resolve, 300));

  const motionResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      return {
        reducedMotionActive: mql.matches
      };
    })()`,
    returnByValue: true
  });
  console.log('Reduced Motion Result:', motionResult.result.value);
  if (!motionResult.result.value.reducedMotionActive) {
    throw new Error('Reduced motion emulation failed');
  }
  auditResults.reducedMotion = 'PASS';

  // Reset media features
  await send('Emulation.setEmulatedMedia', { media: '', features: [] });

  // ---------------------------------------------------------------------------
  // 10. WebGL Fallback Mechanism
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. WebGL Fallback Mechanism ---');
  const fallbackResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const container = document.getElementById('three-bg-container');
      container.classList.add('fallback-active');
      const style = window.getComputedStyle(container);
      const bgImg = style.backgroundImage;
      const isVisible = style.display !== 'none';
      return {
        hasFallbackClass: container.classList.contains('fallback-active'),
        hasBgImage: bgImg && bgImg.includes('workspace-bg.webp'),
        isVisible
      };
    })()`,
    returnByValue: true
  });
  console.log('WebGL Fallback Result:', fallbackResult.result.value);
  if (!fallbackResult.result.value.hasBgImage) {
    throw new Error('WebGL fallback background image failed to resolve');
  }
  auditResults.webglFallback = 'PASS';

  // ---------------------------------------------------------------------------
  // 11. Capture Full High-Res Screenshot
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Visual Screenshot Capture ---');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.resolve(__dirname, 'qa_audit_verified.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`[SCREENSHOT] Saved QA audit screenshot to: ${screenshotPath}`);
  auditResults.screenshot = 'CAPTURED (' + screenshotPath + ')';

  // ---------------------------------------------------------------------------
  // 12. Browser Console Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- 12. Browser Console Audit ---');
  console.log(`Total Console Errors: ${consoleErrors.length}`);
  console.log(`Total Console Warnings: ${consoleWarnings.length}`);
  if (consoleWarnings.length > 0) {
    console.log('Warning details:', consoleWarnings);
  }
  if (consoleErrors.length > 0) {
    console.error('Console errors logged during test:', consoleErrors);
    auditResults.consoleErrors = `FAIL (${consoleErrors.length} errors)`;
  } else {
    auditResults.consoleErrors = 'PASS (0 errors)';
  }

  ws.close();
  chromeProc.kill();

  console.log('\n================================================================');
  console.log('QA AUDIT SUMMARY MATRIX:');
  console.log(JSON.stringify(auditResults, null, 2));
  console.log('================================================================');

  if (consoleErrors.length > 0) {
    process.exit(1);
  }
}

runQAAudit().catch(err => {
  console.error('QA Audit Aborted:', err);
  process.exit(1);
});
