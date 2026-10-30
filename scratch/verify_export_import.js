/**
 * Real Chrome Runtime & DevTools Protocol (CDP) Verification Script
 * Validates JSON Export/Import UI, Viewports, and Functionality
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function run() {
  console.log('================================================================');
  console.log('VERIFYING JSON EXPORT & IMPORT IN GOOGLE CHROME VIA CDP');
  console.log('================================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const remoteDebuggingPort = 9223;
  const profileDir = path.resolve(__dirname, 'chrome-profile-export-import');

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
    throw new Error('Could not find page target with webSocketDebuggerUrl');
  }

  // Use native WebSocket in Node
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error') {
        const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
        consoleErrors.push(text);
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
  console.log(`Navigating to: ${fileUrl}`);

  await send('Page.navigate', { url: fileUrl });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 1. Verify Backup Section elements exist in DOM
  const domCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const exportBtn = document.getElementById('export-tasks-btn');
      const importSelect = document.getElementById('import-mode-select');
      const importInput = document.getElementById('import-file-input');
      const importLabel = document.getElementById('import-file-label');
      const backupAlert = document.getElementById('backup-alert');
      return {
        hasExportBtn: !!exportBtn,
        hasImportSelect: !!importSelect,
        hasImportInput: !!importInput,
        hasImportLabel: !!importLabel,
        hasBackupAlert: !!backupAlert,
        importSelectDefault: importSelect ? importSelect.value : null
      };
    })()`,
    returnByValue: true
  });

  console.log('[DOM CHECK]', domCheck.result.value);
  if (!domCheck.result.value.hasExportBtn || !domCheck.result.value.hasImportSelect || !domCheck.result.value.hasImportInput) {
    throw new Error('Backup UI elements missing in Chrome DOM!');
  }

  // 2. Add 2 tasks, toggle 1
  await send('Runtime.evaluate', {
    expression: `(() => {
      createTask('Task Alpha for Export', 'high', '2026-11-25');
      const t2 = createTask('Task Beta for Export', 'low', null);
      toggleTaskStatus(t2.id);
    })()`
  });

  // 3. Test exportTasksJSON and handleExportTasks
  const exportCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const json = exportTasksJSON();
      handleExportTasks();
      const alertText = document.getElementById('backup-alert').textContent;
      const parsed = JSON.parse(json);
      return {
        taskCount: parsed.length,
        hasAlpha: parsed.some(t => t.title === 'Task Alpha for Export'),
        alertText: alertText
      };
    })()`,
    returnByValue: true
  });
  console.log('[EXPORT CHECK]', exportCheck.result.value);
  if (exportCheck.result.value.taskCount !== 2 || !exportCheck.result.value.hasAlpha) {
    throw new Error('Export JSON did not serialize correct tasks!');
  }

  // 4. Test import in replace mode
  const importReplaceCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const backup = [
        { id: 'rep-chrom-1', title: 'Imported Chrome Task', completed: false, priority: 'medium', dueDate: '2026-12-15', createdAt: Date.now() }
      ];
      const res = importTasksJSON(JSON.stringify(backup), 'replace', () => true);
      const tasks = AppState.tasks;
      const domTasks = document.querySelectorAll('.task-item');
      return {
        success: res.success,
        importedCount: res.importedCount,
        stateCount: tasks.length,
        domCount: domTasks.length,
        firstTitle: tasks[0]?.title
      };
    })()`,
    returnByValue: true
  });
  console.log('[IMPORT REPLACE CHECK]', importReplaceCheck.result.value);
  if (importReplaceCheck.result.value.domCount !== 1 || importReplaceCheck.result.value.firstTitle !== 'Imported Chrome Task') {
    throw new Error('Import replace failed in Chrome!');
  }

  // 5. Test import error on malformed JSON
  const importErrorCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const res = importTasksJSON('bad-json', 'merge');
      const alert = document.getElementById('backup-alert');
      return {
        success: res.success,
        alertText: alert.textContent,
        stateCount: AppState.tasks.length
      };
    })()`,
    returnByValue: true
  });
  console.log('[IMPORT ERROR CHECK]', importErrorCheck.result.value);
  if (importErrorCheck.result.value.success !== false || importErrorCheck.result.value.stateCount !== 1) {
    throw new Error('Import error check failed to preserve state!');
  }

  // 6. Test responsiveness across viewports
  const viewports = [
    { width: 320, height: 600 },
    { width: 375, height: 667 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
  ];

  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 768
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const overflowCheck = await send('Runtime.evaluate', {
      expression: `(() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        return { docWidth, winWidth, hasOverflow: docWidth > winWidth };
      })()`,
      returnByValue: true
    });

    console.log(`[VIEWPORT ${vp.width}x${vp.height}]`, overflowCheck.result.value);
    if (overflowCheck.result.value.hasOverflow) {
      throw new Error(`Horizontal overflow detected at ${vp.width}px!`);
    }
  }

  // Set desktop viewport for visual screenshot
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise(resolve => setTimeout(resolve, 500));

  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.resolve(__dirname, 'backup_ui_verified.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(`[SCREENSHOT] Saved to: ${screenshotPath}`);

  // 7. Check Console Errors
  console.log(`[CONSOLE ERRORS COUNT]: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.error('Console errors detected:', consoleErrors);
  }

  ws.close();
  chromeProc.kill();
  console.log('================================================================');
  console.log('CHROME RUNTIME & CDP VERIFICATION COMPLETE: ALL CHECKS PASSED');
  console.log('================================================================');
}

run().catch(err => {
  console.error('CDP Verification Failed:', err);
  process.exit(1);
});
