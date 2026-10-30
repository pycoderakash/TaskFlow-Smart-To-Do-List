/**
 * TaskFlow — Comprehensive Automated Test Suite
 * 
 * Self-contained Node.js test runner for TaskFlow:
 * - Zero external dependencies (uses native Node.js 'fs', 'path', 'vm')
 * - Simulates browser DOM, localStorage, and event propagation lifecycle
 * - Validates all internship requirements and edge cases
 * 
 * Execution:
 *   node tests.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ==========================================================================
   Lightweight DOM & Web API Simulation for Headless Node Testing
   ========================================================================== */

class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles !== false;
    this.cancelable = options.cancelable !== false;
    this.defaultPrevented = false;
    this._propagationStopped = false;
    this.key = options.key || '';
    this.target = null;
    this.currentTarget = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._propagationStopped = true; }
}

class MockClassList {
  constructor() { this._classes = new Set(); }
  add(...names) { names.forEach(n => this._classes.add(n)); }
  remove(...names) { names.forEach(n => this._classes.delete(n)); }
  toggle(name, force) {
    if (force === true) { this._classes.add(name); return true; }
    if (force === false) { this._classes.delete(name); return false; }
    if (this._classes.has(name)) { this._classes.delete(name); return false; }
    this._classes.add(name);
    return true;
  }
  contains(name) { return this._classes.has(name); }
  get value() { return Array.from(this._classes).join(' '); }
  set value(val) {
    this._classes.clear();
    if (val) val.split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
  }
}

class MockElement {
  constructor(tagName) {
    this.tagName = (tagName || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new MockClassList();
    this.listeners = new Map();
    this._textContent = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.id = '';
    this.type = '';
    this._focused = false;
    this.style = {};
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => c.textContent).join('');
  }
  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  get innerHTML() { return this.textContent; }
  set innerHTML(val) {
    if (val === '') {
      this.children = [];
      this._textContent = '';
    } else {
      this._textContent = String(val);
    }
  }

  get className() { return this.classList.value; }
  set className(val) { this.classList.value = val; }

  setAttribute(name, value) {
    const sVal = String(value);
    this.attributes.set(name, sVal);
    if (name === 'id') this.id = sVal;
    if (name === 'type') this.type = sVal;
    if (name === 'class') this.className = sVal;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[key] = sVal;
    }
  }
  getAttribute(name) {
    if (this.attributes.has(name)) return this.attributes.get(name);
    if (name === 'id') return this.id || null;
    if (name === 'type') return this.type || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      return this.dataset[key] !== undefined ? this.dataset[key] : null;
    }
    return null;
  }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'id') this.id = '';
    if (name === 'type') this.type = '';
    if (name === 'class') this.className = '';
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[key];
    }
  }

  appendChild(child) {
    if (child instanceof MockDocumentFragment) {
      const added = [...child.children];
      added.forEach(c => {
        c.parentNode = this;
        this.children.push(c);
      });
      child.children = [];
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    if (!child) return child;
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  contains(child) {
    if (!child) return false;
    if (child === this) return true;
    let curr = child.parentNode;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matches(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      node.children.forEach(child => {
        if (matches(child, selector)) results.push(child);
        traverse(child);
      });
    };
    traverse(this);
    return results;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    if (!this.listeners.has(type)) return;
    const list = this.listeners.get(type).filter(h => h !== handler);
    this.listeners.set(type, list);
  }

  dispatchEvent(event) {
    event.target = this;
    let current = this;
    while (current) {
      event.currentTarget = current;
      const handlers = current.listeners.get(event.type) || [];
      for (const h of handlers) {
        h.call(current, event);
        if (event._propagationStopped) return !event.defaultPrevented;
      }
      if (!event.bubbles) break;
      current = current.parentNode;
    }
    return !event.defaultPrevented;
  }

  focus() { this._focused = true; }
  select() {}
  click() {
    const evt = new MockEvent('click', { bubbles: true, cancelable: true });
    this.dispatchEvent(evt);
  }
}

class MockDocumentFragment {
  constructor() { this.children = []; }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class MockLocalStorage {
  constructor() { this.store = new Map(); }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
}

function matches(el, selector) {
  if (!el || !selector) return false;
  if (selector.includes(' ')) {
    const parts = selector.trim().split(/\s+/);
    if (parts.length === 2) {
      const [parentSel, childSel] = parts;
      if (!matches(el, childSel)) return false;
      let curr = el.parentNode;
      while (curr) {
        if (matches(curr, parentSel)) return true;
        curr = curr.parentNode;
      }
      return false;
    }
  }
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const inner = selector.slice(1, -1);
    if (inner.includes('=')) {
      const [attr, rawVal] = inner.split('=');
      const val = rawVal.replace(/^["']|["']$/g, '');
      return el.getAttribute(attr) === val;
    }
    return el.hasAttribute(inner);
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

/**
 * Creates a fresh, isolated simulated browser environment
 */
function createEnvironment(initialStorage = {}) {
  const mockStorage = new MockLocalStorage();
  for (const [k, v] of Object.entries(initialStorage)) {
    mockStorage.setItem(k, v);
  }

  const elementsById = new Map();
  const allElements = [];

  const doc = {
    getElementById(id) { return elementsById.get(id) || null; },
    createElement(tag) { return new MockElement(tag); },
    createDocumentFragment() { return new MockDocumentFragment(); },
    querySelector(sel) { return allElements.find(el => matches(el, sel)) || null; },
    querySelectorAll(sel) { return allElements.filter(el => matches(el, sel)); },
    addEventListener(type, handler) {
      if (type === 'DOMContentLoaded') handler();
    }
  };

  function createEl(tag, id, classes = '', dataset = {}) {
    const el = new MockElement(tag);
    if (id) {
      el.id = id;
      elementsById.set(id, el);
    }
    if (classes) el.className = classes;
    Object.assign(el.dataset, dataset);
    allElements.push(el);
    return el;
  }

  const body = createEl('body');
  doc.body = body;

  // Build semantic UI container elements expected by script.js
  const storageAlert = createEl('aside', 'storage-alert');
  const taskForm = createEl('form', 'task-form');
  const taskInput = createEl('input', 'task-input');
  const taskPriority = createEl('select', 'task-priority');
  taskPriority.value = 'medium';
  const taskDueDate = createEl('input', 'task-due-date');
  taskDueDate.type = 'date';
  taskDueDate.value = '';
  taskForm.appendChild(taskInput);
  taskForm.appendChild(taskPriority);
  taskForm.appendChild(taskDueDate);
  const inputError = createEl('p', 'input-error');
  taskForm.appendChild(inputError);

  const totalTasksCount = createEl('strong', 'total-tasks-count');
  const activeTasksCount = createEl('strong', 'active-tasks-count');
  const completedTasksCount = createEl('strong', 'completed-tasks-count');

  // Progress Indicator elements
  const progressText = createEl('span', 'progress-text');
  const progressPercent = createEl('strong', 'progress-percent');
  const progressBar = createEl('div', 'progress-bar');
  const progressBarFill = createEl('div', 'progress-bar-fill');

  const filterGroup = createEl('div', null, 'filter-group');
  const filterAll = createEl('button', null, 'filter-btn active', { filter: 'all' });
  const filterActive = createEl('button', null, 'filter-btn', { filter: 'active' });
  const filterCompleted = createEl('button', null, 'filter-btn', { filter: 'completed' });
  filterGroup.appendChild(filterAll);
  filterGroup.appendChild(filterActive);
  filterGroup.appendChild(filterCompleted);

  const taskSearch = createEl('input', 'task-search');
  taskSearch.type = 'search';
  taskSearch.value = '';

  const searchClearBtn = createEl('button', 'search-clear-btn');
  searchClearBtn.hidden = true;

  const sortSelect = createEl('select', 'sort-select');
  sortSelect.value = 'newest';

  // Undo Delete Notification elements
  const undoToast = createEl('aside', 'undo-toast');
  undoToast.hidden = true;
  const undoMessage = createEl('span', 'undo-message');
  const undoBtn = createEl('button', 'undo-btn');
  const undoDismissBtn = createEl('button', 'undo-dismiss-btn');

  // Backup & Data Management elements
  const exportBtn = createEl('button', 'export-tasks-btn');
  const importModeSelect = createEl('select', 'import-mode-select');
  importModeSelect.value = 'merge';
  const importFileInput = createEl('input', 'import-file-input');
  importFileInput.type = 'file';
  const importFileLabel = createEl('label', 'import-file-label');
  const backupAlert = createEl('span', 'backup-alert');
  backupAlert.hidden = true;

  const taskList = createEl('ul', 'task-list');
  const emptyState = createEl('div', 'empty-state');
  const emptyStateMessage = createEl('p', null, 'empty-state-message');
  emptyState.appendChild(emptyStateMessage);
  const statusAnnouncer = createEl('div', 'status-announcer');

  let timerIdCounter = 1;
  const activeTimers = new Map();

  function mockSetTimeout(fn, ms) {
    const id = timerIdCounter++;
    if (!ms || ms <= 50) {
      fn();
      return id;
    }
    activeTimers.set(id, fn);
    return id;
  }

  function mockClearTimeout(id) {
    activeTimers.delete(id);
  }

  function advanceTimers() {
    const cbs = Array.from(activeTimers.values());
    activeTimers.clear();
    cbs.forEach(fn => fn());
  }

  const context = {
    window: {
      localStorage: mockStorage
    },
    document: doc,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).substring(2, 10) },
    CSS: {
      escape: (str) => String(str).replace(/["'\\()[\].#:, ]/g, '\\$&')
    },
    Blob: class MockBlob {
      constructor(parts = [], options = {}) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL: () => 'blob:mock-taskflow-backup',
      revokeObjectURL: () => {}
    },
    setTimeout: mockSetTimeout,
    clearTimeout: mockClearTimeout,
    console, Array, Object, JSON, Date, String, Error, Set, RegExp, Math
  };

  vm.createContext(context);
  const scriptPath = path.resolve(__dirname, 'script.js');
  const scriptCode = fs.readFileSync(scriptPath, 'utf8');
  vm.runInContext(scriptCode, context);

  return {
    context,
    mockStorage,
    advanceTimers,
    filterAll,
    filterActive,
    filterCompleted,
    elements: {
      storageAlert,
      taskForm,
      taskInput,
      taskPriority,
      taskDueDate,
      inputError,
      taskSearch,
      searchClearBtn,
      sortSelect,
      taskList,
      emptyState,
      emptyStateMessage,
      totalTasksCount,
      activeTasksCount,
      completedTasksCount,
      progressText,
      progressPercent,
      progressBar,
      progressBarFill,
      undoToast,
      undoMessage,
      undoBtn,
      undoDismissBtn,
      exportBtn,
      importModeSelect,
      importFileInput,
      importFileLabel,
      backupAlert,
      statusAnnouncer
    }
  };
}

/* ==========================================================================
   Test Runner Matrix
   ========================================================================== */

let passCount = 0;
let failCount = 0;
const results = [];

function runTest(testName, testFn) {
  try {
    testFn();
    passCount++;
    results.push({ name: testName, status: 'PASS', details: 'Passed without errors' });
    console.log(`[PASS] ${testName}`);
  } catch (err) {
    failCount++;
    results.push({ name: testName, status: 'FAIL', details: err.message });
    console.error(`[FAIL] ${testName}: ${err.message}`);
  }
}

console.log('================================================================');
console.log('TASKFLOW AUTOMATED REGRESSION & COMPLIANCE TEST SUITE');
console.log('================================================================');

// 1. Task Creation & Input Trimming
runTest('Task creation: Valid task trims whitespace and prepends to state & DOM', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = '   Build modern to-do app   ';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  if (env.elements.taskList.children.length !== 1) throw new Error('Task element not appended to taskList');
  const renderedTitle = env.elements.taskList.children[0].querySelector('.task-text').textContent;
  if (renderedTitle !== 'Build modern to-do app') throw new Error(`Expected trimmed title, got: "${renderedTitle}"`);
  if (env.elements.totalTasksCount.textContent !== '1') throw new Error('Total tasks counter not incremented to 1');
  if (env.elements.taskInput.value !== '') throw new Error('Task input not cleared after creation');
});

// 2. Empty and Whitespace-Only Input Rejection
runTest('Empty-input rejection: Blank and whitespace-only titles are rejected', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = '     ';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  if (env.elements.taskList.children.length !== 0) throw new Error('Whitespace-only task was unexpectedly created');
  if (env.elements.inputError.hidden === true) throw new Error('Input error message was not displayed');
  if (env.elements.taskInput.getAttribute('aria-invalid') !== 'true') throw new Error('aria-invalid="true" was not set on task input');
});

// 3. Task Editing (Enter-to-save & delegated click on save)
runTest('Task editing: Inline edit updates task title, persists, and restores focus', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Initial Task Title';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const editBtn = env.elements.taskList.children[0].querySelector('[data-action="edit"]');
  editBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const editInput = env.elements.taskList.children[0].querySelector('.task-edit-input');
  if (!editInput || editInput.value !== 'Initial Task Title') throw new Error('Edit form did not render with original title');

  editInput.value = 'Updated Task Title via Submit';
  const editForm = env.elements.taskList.children[0].querySelector('.task-edit-form');
  editForm.dispatchEvent(new MockEvent('submit', { bubbles: true }));

  const updatedTitle = env.elements.taskList.children[0].querySelector('.task-text').textContent;
  if (updatedTitle !== 'Updated Task Title via Submit') throw new Error('Task title did not update after save');

  // Verify focus returned to Edit button
  const restoredEditBtn = env.elements.taskList.children[0].querySelector('.btn-edit');
  if (!restoredEditBtn || !restoredEditBtn._focused) throw new Error('Keyboard focus not restored to Edit button');
});

// 4. Edit Cancellation (Escape key and Cancel button)
runTest('Edit cancellation: Canceling via button or Escape preserves original title', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Preserved Original Title';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const editBtn = env.elements.taskList.children[0].querySelector('[data-action="edit"]');
  editBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const editInput = env.elements.taskList.children[0].querySelector('.task-edit-input');
  editInput.value = 'Draft that will be cancelled';

  const cancelBtn = env.elements.taskList.children[0].querySelector('[data-action="cancel"]');
  cancelBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const finalTitle = env.elements.taskList.children[0].querySelector('.task-text').textContent;
  if (finalTitle !== 'Preserved Original Title') throw new Error(`Task title modified unexpectedly: "${finalTitle}"`);
});

// 5. Task Deletion
runTest('Task deletion: Selected task removed from state, storage, and DOM', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Task 1 to Keep';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));
  env.elements.taskInput.value = 'Task 2 to Delete';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  if (env.elements.taskList.children.length !== 2) throw new Error('Expected 2 tasks before deletion');

  // Delete the first task (Task 2)
  const deleteBtn = env.elements.taskList.children[0].querySelector('[data-action="delete"]');
  deleteBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  if (env.elements.taskList.children.length !== 1) throw new Error('Task was not removed from DOM');
  const remainingTitle = env.elements.taskList.children[0].querySelector('.task-text').textContent;
  if (remainingTitle !== 'Task 1 to Keep') throw new Error(`Wrong task deleted, remaining: "${remainingTitle}"`);
  if (env.elements.totalTasksCount.textContent !== '1') throw new Error('Stats total counter not updated to 1');
});

// 6. Completion Toggling
runTest('Completion toggling: Checkbox toggle syncs completed status and counters', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Complete Me';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const checkbox = env.elements.taskList.children[0].querySelector('.task-checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new MockEvent('change', { bubbles: true }));

  if (env.elements.completedTasksCount.textContent !== '1') throw new Error('Completed counter not 1');
  if (env.elements.activeTasksCount.textContent !== '0') throw new Error('Active counter not 0');
  if (!env.elements.taskList.children[0].classList.contains('completed')) throw new Error('task-item missing completed CSS class');

  // Reactivate
  const reactivateCheckbox = env.elements.taskList.children[0].querySelector('.task-checkbox');
  reactivateCheckbox.checked = false;
  reactivateCheckbox.dispatchEvent(new MockEvent('change', { bubbles: true }));

  if (env.elements.completedTasksCount.textContent !== '0') throw new Error('Completed counter not 0 after reactivation');
  if (env.elements.activeTasksCount.textContent !== '1') throw new Error('Active counter not 1 after reactivation');
});

// 7. All, Active, and Completed Filtering
runTest('Filtering: All, Active, and Completed filters project correct subsets without state mutation', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Task Active';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));
  env.elements.taskInput.value = 'Task Completed';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  // Complete 'Task Completed'
  const checkbox = env.elements.taskList.children[0].querySelector('.task-checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new MockEvent('change', { bubbles: true }));

  // Switch to Active filter
  env.filterActive.dispatchEvent(new MockEvent('click', { bubbles: true }));
  if (env.elements.taskList.children.length !== 1) throw new Error('Active filter did not show exactly 1 task');
  if (env.elements.taskList.children[0].querySelector('.task-text').textContent !== 'Task Active') {
    throw new Error('Wrong task visible under Active filter');
  }

  // Switch to Completed filter
  env.filterCompleted.dispatchEvent(new MockEvent('click', { bubbles: true }));
  if (env.elements.taskList.children.length !== 1) throw new Error('Completed filter did not show exactly 1 task');
  if (env.elements.taskList.children[0].querySelector('.task-text').textContent !== 'Task Completed') {
    throw new Error('Wrong task visible under Completed filter');
  }

  // Switch back to All filter
  env.filterAll.dispatchEvent(new MockEvent('click', { bubbles: true }));
  if (env.elements.taskList.children.length !== 2) throw new Error('All filter did not restore all 2 tasks');
});

// 8. Statistics Accuracy across Operations
runTest('Statistics consistency: Total, Active, Completed remain accurate across all operations', () => {
  const env = createEnvironment();
  if (env.elements.totalTasksCount.textContent !== '0') throw new Error('Initial total not 0');
  if (env.elements.activeTasksCount.textContent !== '0') throw new Error('Initial active not 0');
  if (env.elements.completedTasksCount.textContent !== '0') throw new Error('Initial completed not 0');

  env.elements.taskInput.value = 'Task A';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));
  env.elements.taskInput.value = 'Task B';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  if (env.elements.totalTasksCount.textContent !== '2') throw new Error('Total should be 2');
  if (env.elements.activeTasksCount.textContent !== '2') throw new Error('Active should be 2');
  if (env.elements.completedTasksCount.textContent !== '0') throw new Error('Completed should be 0');

  // Filter to Completed (empty)
  env.filterCompleted.dispatchEvent(new MockEvent('click', { bubbles: true }));
  // Counters must still reflect global state (2, 2, 0)
  if (env.elements.totalTasksCount.textContent !== '2') throw new Error('Total must reflect global count');
  if (env.elements.activeTasksCount.textContent !== '2') throw new Error('Active must reflect global count');
});

// 9. localStorage Persistence & Restoration
runTest('localStorage: Tasks saved under taskflow_tasks and restored on reload', () => {
  const env1 = createEnvironment();
  env1.elements.taskInput.value = 'Persisted Task';
  env1.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const raw = env1.mockStorage.getItem('taskflow_tasks');
  if (!raw) throw new Error('taskflow_tasks key not found in localStorage');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0].title !== 'Persisted Task') {
    throw new Error('Stored task data is incorrect or missing title');
  }

  // Boot second environment with the stored data
  const env2 = createEnvironment({ taskflow_tasks: raw });
  if (env2.elements.taskList.children.length !== 1) throw new Error('Task not restored in second session');
  if (env2.elements.taskList.children[0].querySelector('.task-text').textContent !== 'Persisted Task') {
    throw new Error('Restored title mismatch');
  }
});

// 10. Malformed JSON Handling
runTest('Malformed JSON: Corrupt syntax does not crash initialization and displays alert', () => {
  const env = createEnvironment({ taskflow_tasks: '{"malformed": true,,,' });
  if (env.elements.storageAlert.hidden === true) throw new Error('storageAlert banner was not shown');
  if (env.elements.taskList.children.length !== 0) throw new Error('Expected 0 tasks on malformed JSON');
  if (env.mockStorage.getItem('taskflow_tasks') !== '{"malformed": true,,,') {
    throw new Error('Raw storage was unexpectedly wiped');
  }
});

// 11. Invalid Stored Records Sanitization
runTest('Invalid stored records: Malformed objects safely discarded while valid tasks load', () => {
  const validTask = { id: 'task-ok', title: 'Valid Record', completed: false, createdAt: Date.now() };
  const corruptRecord = { id: '', title: null }; // Invalid schema
  const env = createEnvironment({ taskflow_tasks: JSON.stringify([validTask, corruptRecord]) });

  if (env.elements.taskList.children.length !== 1) throw new Error('Expected exactly 1 valid task to load');
  if (env.elements.storageAlert.hidden === true || !env.elements.storageAlert.textContent.includes('discarded')) {
    throw new Error('storageAlert did not notify user of discarded invalid records');
  }
});

// 12. Duplicate Task ID Resolution
runTest('Duplicate task IDs: Duplicate IDs in stored data resolved with collision-resistant UUIDs', () => {
  const dup1 = { id: 'duplicate-id', title: 'First Task', completed: false, createdAt: Date.now() };
  const dup2 = { id: 'duplicate-id', title: 'Second Task', completed: true, createdAt: Date.now() };
  const env = createEnvironment({ taskflow_tasks: JSON.stringify([dup1, dup2]) });

  if (env.elements.taskList.children.length !== 2) throw new Error('Expected 2 tasks loaded');
  const id1 = env.elements.taskList.children[0].dataset.taskId;
  const id2 = env.elements.taskList.children[1].dataset.taskId;
  if (id1 === id2) throw new Error('Duplicate IDs were not de-duplicated into distinct identifiers');
});

// 13. XSS Defense (Rendering user input as pure text)
runTest('XSS defense: User input containing executable HTML/scripts rendered safely as text', () => {
  const env = createEnvironment();
  const dangerousPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
  env.elements.taskInput.value = dangerousPayload;
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const renderedText = env.elements.taskList.children[0].querySelector('.task-text').textContent;
  if (renderedText !== dangerousPayload) throw new Error('Rendered text does not match input');
  if (env.elements.taskList.children[0].querySelector('script') !== null) {
    throw new Error('Script element was parsed and created in DOM!');
  }
  if (env.elements.taskList.children[0].querySelector('img') !== null) {
    throw new Error('Img element was parsed and created in DOM!');
  }
});

// 14. Event Delegation through Nested Elements
runTest('Event delegation: Action clicks on nested child spans inside buttons function correctly', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Nested Element Test';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  // Target the inner <span class="btn-text">Edit</span> rather than the button directly
  const editSpan = env.elements.taskList.children[0].querySelector('.btn-edit .btn-text');
  if (!editSpan) throw new Error('Inner .btn-text span not found in DOM');

  editSpan.dispatchEvent(new MockEvent('click', { bubbles: true }));
  const editInput = env.elements.taskList.children[0].querySelector('.task-edit-input');
  if (!editInput) throw new Error('Delegated click on nested span failed to trigger edit mode');
});

// 15. Enter-to-save and Escape-to-cancel
runTest('Keyboard shortcuts: Enter saves inline edit, Escape cancels editing', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Keyboard Task';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  // Enter edit mode
  const editBtn = env.elements.taskList.children[0].querySelector('[data-action="edit"]');
  editBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  // Escape to cancel
  const editInput = env.elements.taskList.children[0].querySelector('.task-edit-input');
  editInput.value = 'Typing something else';
  const escapeEvt = new MockEvent('keydown', { bubbles: true });
  escapeEvt.key = 'Escape';
  editInput.dispatchEvent(escapeEvt);

  if (env.elements.taskList.children[0].querySelector('.task-text').textContent !== 'Keyboard Task') {
    throw new Error('Escape key failed to revert edit title');
  }
});

// 16. Special Characters in Stored Task IDs (restoreTaskFocus robustness)
runTest('Special characters in task IDs: Unusual stored IDs do not throw selector syntax errors', () => {
  const specialTask = {
    id: 'task"with\'quotes:and[brackets].#weird space',
    title: 'Special ID Task',
    completed: false,
    createdAt: Date.now()
  };
  const env = createEnvironment({ taskflow_tasks: JSON.stringify([specialTask]) });

  // Enter edit mode
  const editBtn = env.elements.taskList.children[0].querySelector('[data-action="edit"]');
  editBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  // Save edit (calls restoreTaskFocus with the special ID)
  const saveBtn = env.elements.taskList.children[0].querySelector('[data-action="save"]');
  saveBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const restoredEditBtn = env.elements.taskList.children[0].querySelector('.btn-edit');
  if (!restoredEditBtn || !restoredEditBtn._focused) {
    throw new Error('restoreTaskFocus failed to locate element with special characters in ID');
  }
});

// 17. Priority selection (High, Medium, Low)
runTest('Priority selection: Creating tasks with high, medium, and low priority sets proper state, badge, and attribute', () => {
  const env = createEnvironment();

  // Create High priority task via form
  env.elements.taskInput.value = 'High Priority Task';
  env.elements.taskPriority.value = 'high';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  // Create Low priority task via form
  env.elements.taskInput.value = 'Low Priority Task';
  env.elements.taskPriority.value = 'low';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  // Create Medium priority task via form
  env.elements.taskInput.value = 'Medium Priority Task';
  env.elements.taskPriority.value = 'medium';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const tasks = env.context.getFilteredTasks();
  if (tasks.length !== 3) {
    throw new Error('Expected 3 tasks created');
  }

  const [tMedium, tLow, tHigh] = tasks;
  if (tMedium.priority !== 'medium' || tLow.priority !== 'low' || tHigh.priority !== 'high') {
    throw new Error('Tasks did not preserve correct priority values in state');
  }

  // Inspect DOM badges
  const items = env.elements.taskList.children;
  const badgeMed = items[0].querySelector('.priority-badge');
  const badgeLow = items[1].querySelector('.priority-badge');
  const badgeHigh = items[2].querySelector('.priority-badge');

  if (!badgeMed || !badgeMed.classList.contains('priority-medium') || badgeMed.textContent !== 'Medium') {
    throw new Error('Medium priority badge mismatch in DOM');
  }
  if (!badgeLow || !badgeLow.classList.contains('priority-low') || badgeLow.textContent !== 'Low') {
    throw new Error('Low priority badge mismatch in DOM');
  }
  if (!badgeHigh || !badgeHigh.classList.contains('priority-high') || badgeHigh.textContent !== 'High') {
    throw new Error('High priority badge mismatch in DOM');
  }
});

// 18. Default priority for legacy storage
runTest('Default priority for older tasks: Stored records lacking priority or dueDate safely default without data loss', () => {
  const legacyTasks = [
    { id: 'leg-1', title: 'Old Legacy Task 1', completed: false, createdAt: 1600000000000 },
    { id: 'leg-2', title: 'Old Legacy Task 2', completed: true, createdAt: 1600000001000 }
  ];

  const env = createEnvironment({ taskflow_tasks: JSON.stringify(legacyTasks) });
  const tasks = env.context.getFilteredTasks();

  if (tasks.length !== 2) {
    throw new Error('Legacy tasks were discarded during migration');
  }

  const [t1, t2] = tasks;
  if (t1.priority !== 'medium' || t1.dueDate !== null) {
    throw new Error('Legacy task 1 did not receive safe defaults (priority=medium, dueDate=null)');
  }
  if (t2.priority !== 'medium' || t2.dueDate !== null) {
    throw new Error('Legacy task 2 did not receive safe defaults (priority=medium, dueDate=null)');
  }

  const badge1 = env.elements.taskList.children[0].querySelector('.priority-badge');
  if (!badge1 || !badge1.classList.contains('priority-medium')) {
    throw new Error('Legacy task did not render medium priority badge in DOM');
  }
});

// 19. Adding and editing due dates
runTest('Due date handling: Adding and editing valid due dates formats readable text and persists', () => {
  const env = createEnvironment();

  // Create with due date
  env.elements.taskInput.value = 'Due Date Task';
  env.elements.taskPriority.value = 'high';
  env.elements.taskDueDate.value = '2026-11-20';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const tasks = env.context.getFilteredTasks();
  const task = tasks[0];
  if (task.dueDate !== '2026-11-20') {
    throw new Error('Due date not saved to state: ' + task.dueDate);
  }

  const dueBadge = env.elements.taskList.children[0].querySelector('.due-badge');
  if (!dueBadge || !dueBadge.textContent.includes('Nov 20, 2026')) {
    throw new Error('Due date badge not rendered with readable format: ' + (dueBadge ? dueBadge.textContent : 'none'));
  }

  // Edit due date
  const editBtn = env.elements.taskList.children[0].querySelector('[data-action="edit"]');
  editBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const editDateInput = env.elements.taskList.children[0].querySelector('.task-edit-due-date');
  if (!editDateInput || editDateInput.value !== '2026-11-20') {
    throw new Error('Edit due date input did not initialize with task due date');
  }

  editDateInput.value = '2026-12-25';
  const saveBtn = env.elements.taskList.children[0].querySelector('[data-action="save"]');
  saveBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const updatedTasks = env.context.getFilteredTasks();
  if (updatedTasks[0].dueDate !== '2026-12-25') {
    throw new Error('Edited due date was not updated in state');
  }

  const updatedBadge = env.elements.taskList.children[0].querySelector('.due-badge');
  if (!updatedBadge || !updatedBadge.textContent.includes('Dec 25, 2026')) {
    throw new Error('Updated due date badge not rendered with new readable format');
  }
});

// 20. Invalid date and priority sanitization
runTest('Invalid date and priority sanitization: Corrupt dates and invalid priorities safely default without discarding tasks', () => {
  const corruptTasks = [
    { id: 'c-1', title: 'Corrupt Priority', completed: false, createdAt: 1600000000000, priority: 'URGENT_NOW', dueDate: 'not-a-date' },
    { id: 'c-2', title: 'Invalid Calendar Date', completed: false, createdAt: 1600000000000, priority: 12345, dueDate: '2026-02-31' }
  ];

  const env = createEnvironment({ taskflow_tasks: JSON.stringify(corruptTasks) });
  const tasks = env.context.getFilteredTasks();

  if (tasks.length !== 2) {
    throw new Error('Tasks with invalid priority/date should be sanitized, not discarded');
  }

  const [t1, t2] = tasks;
  if (t1.priority !== 'medium' || t1.dueDate !== null) {
    throw new Error('Corrupt task 1 priority/dueDate did not sanitize to defaults');
  }
  if (t2.priority !== 'medium' || t2.dueDate !== null) {
    throw new Error('Invalid calendar date did not sanitize to null');
  }
});

// 21. Due-today and overdue logic
runTest('Due-today and overdue calendar logic: Accurately identifies overdue and due-today tasks based on local date', () => {
  const env = createEnvironment();

  const now = new Date();
  const todayStr = env.context.getLocalDateString(now);

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = env.context.getLocalDateString(yesterday);

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowStr = env.context.getLocalDateString(tomorrow);

  env.context.createTask('Overdue Task', 'high', yesterdayStr);
  env.context.createTask('Today Task', 'medium', todayStr);
  env.context.createTask('Upcoming Task', 'low', tomorrowStr);

  const items = env.elements.taskList.children;
  // unshifted: [0: Upcoming, 1: Today, 2: Overdue]
  const upcomingBadge = items[0].querySelector('.due-badge');
  const todayBadge = items[1].querySelector('.due-badge');
  const overdueBadge = items[2].querySelector('.due-badge');

  if (!upcomingBadge || !upcomingBadge.classList.contains('due-upcoming')) {
    throw new Error('Upcoming task missing due-upcoming class');
  }
  if (!todayBadge || !todayBadge.classList.contains('due-today') || !todayBadge.textContent.includes('Due today')) {
    throw new Error('Today task missing due-today class or label');
  }
  if (!overdueBadge || !overdueBadge.classList.contains('due-overdue') || !overdueBadge.textContent.includes('Overdue')) {
    throw new Error('Overdue task missing due-overdue class or label');
  }
});

// 22. Completed overdue tasks
runTest('Completed overdue tasks: Completed tasks past their deadline display as completed and are never labelled overdue', () => {
  const env = createEnvironment();

  const now = new Date();
  const pastDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
  const pastDateStr = env.context.getLocalDateString(pastDate);

  // Create overdue task
  env.context.createTask('Past Task', 'high', pastDateStr);

  const initialBadge = env.elements.taskList.children[0].querySelector('.due-badge');
  if (!initialBadge || !initialBadge.classList.contains('due-overdue')) {
    throw new Error('Uncompleted past task should be labeled overdue');
  }

  // Toggle completion
  const checkbox = env.elements.taskList.children[0].querySelector('.task-checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new MockEvent('change', { bubbles: true }));

  const completedBadge = env.elements.taskList.children[0].querySelector('.due-badge');
  if (!completedBadge) {
    throw new Error('Completed task badge not found');
  }
  if (completedBadge.classList.contains('due-overdue')) {
    throw new Error('Completed task must not have due-overdue class');
  }
  if (!completedBadge.classList.contains('due-completed')) {
    throw new Error('Completed task missing due-completed class');
  }
  if (!completedBadge.textContent.includes('Done')) {
    throw new Error('Completed task badge text should indicate completion (Done)');
  }
  if (completedBadge.textContent.toLowerCase().includes('overdue')) {
    throw new Error('Completed task badge must never contain the word overdue');
  }
});

// 23. State persistence after refresh with priority and due date
runTest('Persistence after refresh: Tasks with priorities and due dates persist accurately across reloads', () => {
  const env1 = createEnvironment();
  env1.context.createTask('Persistent High Task', 'high', '2026-12-31');
  env1.context.createTask('Persistent Low Task', 'low', null);

  const raw = env1.mockStorage.getItem('taskflow_tasks');
  if (!raw) throw new Error('localStorage taskflow_tasks was empty');

  // Reload into fresh environment
  const env2 = createEnvironment({ taskflow_tasks: raw });
  const restoredTasks = env2.context.getFilteredTasks();
  if (restoredTasks.length !== 2) {
    throw new Error('Expected 2 tasks loaded after refresh');
  }

  const [tLow, tHigh] = restoredTasks;
  if (tHigh.priority !== 'high' || tHigh.dueDate !== '2026-12-31') {
    throw new Error('Task 1 priority or due date did not survive reload');
  }
  if (tLow.priority !== 'low' || tLow.dueDate !== null) {
    throw new Error('Task 2 priority or due date did not survive reload');
  }

  const items = env2.elements.taskList.children;
  const highBadge = items[1].querySelector('.priority-badge');
  const highDueBadge = items[1].querySelector('.due-badge');

  if (!highBadge || !highBadge.classList.contains('priority-high')) {
    throw new Error('Restored High task missing priority-high DOM class');
  }
  if (!highDueBadge || !highDueBadge.textContent.includes('Dec 31, 2026')) {
    throw new Error('Restored High task missing formatted due date badge');
  }
});

// 24. Case-insensitive search with surrounding whitespace trimming
runTest('Search: Case-insensitive title matching and whitespace trimming', () => {
  const env = createEnvironment();
  env.context.createTask('Master Python Async Programming', 'high', null);
  env.context.createTask('Build Modern React User Interface', 'medium', null);
  env.context.createTask('Advanced python Data Analysis', 'low', null);

  // Type query with mixed casing and surrounding whitespace
  env.elements.taskSearch.value = '   pyTHon   ';
  env.elements.taskSearch.dispatchEvent(new MockEvent('input'));

  const visible = env.context.getFilteredTasks();
  if (visible.length !== 2) {
    throw new Error(`Expected 2 matching tasks for 'python', got ${visible.length}`);
  }

  const titles = visible.map(t => t.title);
  if (!titles.includes('Master Python Async Programming') || !titles.includes('Advanced python Data Analysis')) {
    throw new Error('Search did not match expected python tasks');
  }
  if (titles.includes('Build Modern React User Interface')) {
    throw new Error('Search failed to exclude non-matching task');
  }

  if (env.elements.searchClearBtn.hidden) {
    throw new Error('Clear button should be visible when search field has text');
  }

  // Clear query and verify full list restores
  env.elements.taskSearch.value = '';
  env.elements.taskSearch.dispatchEvent(new MockEvent('input'));
  if (env.context.getFilteredTasks().length !== 3) {
    throw new Error('Clearing search should restore all 3 tasks');
  }
  if (!env.elements.searchClearBtn.hidden) {
    throw new Error('Clear button should be hidden when search field is empty');
  }
});

// 25. No-match search results display contextual empty message
runTest('Search: No-match results display empty state message without mutating tasks', () => {
  const env = createEnvironment();
  env.context.createTask('Daily Team Standup', 'medium', null);
  env.context.createTask('Review Pull Request', 'high', null);

  env.elements.taskSearch.value = 'Quantum Teleportation';
  env.elements.taskSearch.dispatchEvent(new MockEvent('input'));

  const visible = env.context.getFilteredTasks();
  if (visible.length !== 0) {
    throw new Error('Expected 0 results for non-matching query');
  }

  if (env.elements.taskList.children.length !== 0) {
    throw new Error('DOM list should have 0 items rendered');
  }

  if (env.elements.emptyState.hidden) {
    throw new Error('Empty state container should be visible on no-match');
  }

  const emptyMsg = env.elements.emptyStateMessage.textContent;
  if (!emptyMsg.includes('Quantum Teleportation')) {
    throw new Error(`Empty state message should reference query, got: ${emptyMsg}`);
  }

  // Verify authoritative state is intact
  env.elements.taskSearch.value = '';
  env.elements.taskSearch.dispatchEvent(new MockEvent('input'));
  if (env.context.getFilteredTasks().length !== 2) {
    throw new Error('Authoritative tasks array was mutated or discarded during empty search');
  }
});

// 26. Search integrated across All, Active, and Completed status filters
runTest('Filter integration: Search and status filters operate together', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('Python Core Architecture', 'high', null);
  const t2 = env.context.createTask('Python Automation Bot', 'medium', null);
  const t3 = env.context.createTask('Python Legacy Exporter', 'low', null);
  const t4 = env.context.createTask('Rust High Performance Engine', 'high', null);

  // Mark t3 (Python Legacy Exporter) and t4 (Rust) as completed
  env.context.toggleTaskStatus(t3.id);
  env.context.toggleTaskStatus(t4.id);

  // Search 'python' while filter is 'all'
  env.context.setSearchQuery('python');
  let results = env.context.getFilteredTasks();
  if (results.length !== 3) {
    throw new Error(`Expected 3 python tasks in All view, got ${results.length}`);
  }

  // Switch to 'active' view while search is active
  env.context.setFilter('active');
  results = env.context.getFilteredTasks();
  if (results.length !== 2) {
    throw new Error(`Expected 2 active python tasks, got ${results.length}`);
  }
  if (results.some(t => t.completed)) {
    throw new Error('Active view contained completed task');
  }

  // Switch to 'completed' view while search is active
  env.context.setFilter('completed');
  results = env.context.getFilteredTasks();
  if (results.length !== 1 || results[0].title !== 'Python Legacy Exporter') {
    throw new Error('Completed + python search should only return Python Legacy Exporter');
  }

  // Change search to 'rust' in completed view
  env.context.setSearchQuery('rust');
  results = env.context.getFilteredTasks();
  if (results.length !== 1 || results[0].title !== 'Rust High Performance Engine') {
    throw new Error('Completed + rust search should return Rust High Performance Engine');
  }

  // Change search to 'rust' in active view -> 0 matches
  env.context.setFilter('active');
  results = env.context.getFilteredTasks();
  if (results.length !== 0) {
    throw new Error('Active + rust search should return 0 tasks');
  }
});

// 27. Search combined with sorting
runTest('Search with sorting: Search results ordered by active sorting option', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('Python Low Priority', 'low', null);
  t1.createdAt = 1000;
  const t2 = env.context.createTask('Python High Priority', 'high', null);
  t2.createdAt = 2000;
  const t3 = env.context.createTask('Docker Compose Spec', 'medium', null);
  t3.createdAt = 3000;

  env.context.setSearchQuery('python');
  
  // Sort priority High to Low
  env.context.setSortBy('priority-desc');
  let results = env.context.getFilteredTasks();
  if (results.length !== 2) throw new Error('Expected 2 search results');
  if (results[0].title !== 'Python High Priority' || results[1].title !== 'Python Low Priority') {
    throw new Error('Priority sort on search results failed');
  }

  // Sort Oldest first
  env.context.setSortBy('oldest');
  results = env.context.getFilteredTasks();
  if (results[0].title !== 'Python Low Priority' || results[1].title !== 'Python High Priority') {
    throw new Error('Oldest sort on search results failed');
  }
});

// 28. Priority sorting (High to Low with tie-break)
runTest('Sorting: Priority High to Low with non-mutating sort copy', () => {
  const env = createEnvironment();
  const tLow = env.context.createTask('Low Task', 'low', null);
  tLow.createdAt = 100;
  const tHigh1 = env.context.createTask('High Task 1', 'high', null);
  tHigh1.createdAt = 200;
  const tMed = env.context.createTask('Medium Task', 'medium', null);
  tMed.createdAt = 300;
  const tHigh2 = env.context.createTask('High Task 2', 'high', null);
  tHigh2.createdAt = 400;

  env.elements.sortSelect.value = 'priority-desc';
  env.elements.sortSelect.dispatchEvent(new MockEvent('change'));

  const sorted = env.context.getFilteredTasks();
  if (sorted.length !== 4) throw new Error('Expected 4 sorted tasks');

  // Expected order: High Task 2 (high, 400), High Task 1 (high, 200), Medium Task (med, 300), Low Task (low, 100)
  if (sorted[0].title !== 'High Task 2' || sorted[1].title !== 'High Task 1') {
    throw new Error('High priority tasks should be first, ordered newest first');
  }
  if (sorted[2].title !== 'Medium Task') {
    throw new Error('Medium priority task should be in third place');
  }
  if (sorted[3].title !== 'Low Task') {
    throw new Error('Low priority task should be in fourth place');
  }

  // Verify default sort restores on switching back to 'newest'
  env.context.setSortBy('newest');
  const newestSorted = env.context.getFilteredTasks();
  if (newestSorted[0].title !== 'High Task 2' || newestSorted[3].title !== 'Low Task') {
    throw new Error('Newest sort restoration failed');
  }
});

// 29. Due date sorting (Earliest deadline first)
runTest('Sorting: Due date earliest first orders chronologically', () => {
  const env = createEnvironment();
  env.context.createTask('Task December', 'medium', '2026-12-15');
  env.context.createTask('Task October', 'medium', '2026-10-10');
  env.context.createTask('Task November', 'medium', '2026-11-01');

  env.context.setSortBy('due-asc');
  const sorted = env.context.getFilteredTasks();
  if (sorted.length !== 3) throw new Error('Expected 3 tasks');

  if (sorted[0].dueDate !== '2026-10-10' || sorted[1].dueDate !== '2026-11-01' || sorted[2].dueDate !== '2026-12-15') {
    throw new Error('Due-date sorting failed to order earliest deadline first');
  }
});

// 30. Tasks without deadlines placement rule under due-date sorting
runTest('Sorting: Consistent placement rule for tasks without due dates', () => {
  const env = createEnvironment();
  // Rule: Timed tasks come first in chronological order; untimed tasks are placed at the end (newest first).
  const tTimedLate = env.context.createTask('Timed Late', 'medium', '2026-11-20');
  tTimedLate.createdAt = 100;

  const tUntimedOld = env.context.createTask('Untimed Old', 'medium', null);
  tUntimedOld.createdAt = 200;

  const tTimedEarly = env.context.createTask('Timed Early', 'medium', '2026-10-05');
  tTimedEarly.createdAt = 300;

  const tUntimedNew = env.context.createTask('Untimed New', 'medium', null);
  tUntimedNew.createdAt = 400;

  env.context.setSortBy('due-asc');
  const sorted = env.context.getFilteredTasks();
  if (sorted.length !== 4) throw new Error('Expected 4 tasks');

  // Verify timed tasks are at front
  if (sorted[0].title !== 'Timed Early' || sorted[1].title !== 'Timed Late') {
    throw new Error('Timed tasks should appear first ordered earliest to latest');
  }

  // Verify untimed tasks are at end, ordered newest first
  if (sorted[2].title !== 'Untimed New' || sorted[3].title !== 'Untimed Old') {
    throw new Error('Untimed tasks should be placed at end, sub-sorted newest first');
  }
});

// 31. Statistics accuracy during active search and sorting
runTest('Statistics consistency: Summary counters represent full collection during search and sort', () => {
  const env = createEnvironment();
  env.context.createTask('Active Task A', 'high', null);
  env.context.createTask('Active Task B', 'medium', null);
  env.context.createTask('Active Task C', 'low', null);
  const done1 = env.context.createTask('Done Task D', 'high', null);
  const done2 = env.context.createTask('Done Task E', 'medium', null);
  env.context.toggleTaskStatus(done1.id);
  env.context.toggleTaskStatus(done2.id);

  // Apply search matching only 1 single task
  env.context.setSearchQuery('Active Task A');
  env.context.setSortBy('priority-desc');

  // Verify visible DOM list shows only 1 item
  if (env.context.getFilteredTasks().length !== 1) {
    throw new Error('Expected 1 visible task for search');
  }

  // Verify statistics counters remain accurate for the global collection
  if (env.elements.totalTasksCount.textContent !== '5') {
    throw new Error(`Total tasks stat should be 5, got ${env.elements.totalTasksCount.textContent}`);
  }
  if (env.elements.activeTasksCount.textContent !== '3') {
    throw new Error(`Active tasks stat should be 3, got ${env.elements.activeTasksCount.textContent}`);
  }
  if (env.elements.completedTasksCount.textContent !== '2') {
    throw new Error(`Completed tasks stat should be 2, got ${env.elements.completedTasksCount.textContent}`);
  }
});

// 32. State persistence and immediate search/sort after refresh
runTest('Persistence: Stored tasks survive reload and support immediate search and sorting', () => {
  const env1 = createEnvironment();
  env1.context.createTask('Database Migration Script', 'high', '2026-11-10');
  env1.context.createTask('API GraphQL Endpoint', 'medium', '2026-10-20');
  env1.context.createTask('Frontend Accessibility Audit', 'low', null);

  const raw = env1.mockStorage.getItem('taskflow_tasks');
  if (!raw) throw new Error('localStorage empty');

  // Simulate full page refresh
  const env2 = createEnvironment({ taskflow_tasks: raw });
  if (env2.context.getFilteredTasks().length !== 3) {
    throw new Error('Failed to restore 3 tasks upon reload');
  }

  // Immediately search on restored environment
  env2.elements.taskSearch.value = 'graphql';
  env2.elements.taskSearch.dispatchEvent(new MockEvent('input'));
  let searchResults = env2.context.getFilteredTasks();
  if (searchResults.length !== 1 || searchResults[0].title !== 'API GraphQL Endpoint') {
    throw new Error('Immediate search on restored tasks failed');
  }

  // Clear search and sort by due date
  env2.elements.taskSearch.value = '';
  env2.elements.taskSearch.dispatchEvent(new MockEvent('input'));
  env2.elements.sortSelect.value = 'due-asc';
  env2.elements.sortSelect.dispatchEvent(new MockEvent('change'));

  const sortedResults = env2.context.getFilteredTasks();
  if (sortedResults[0].title !== 'API GraphQL Endpoint' || sortedResults[1].title !== 'Database Migration Script' || sortedResults[2].title !== 'Frontend Accessibility Audit') {
    throw new Error('Immediate due-date sort on restored tasks failed');
  }
});

// 33. Progress indicator: Safe zero-task calculation and display
runTest('Progress indicator: Safe zero-task calculation and display', () => {
  const env = createEnvironment();
  // App initializes with 0 tasks
  if (env.elements.progressPercent.textContent !== '0%') {
    throw new Error(`Expected 0% for zero tasks, got ${env.elements.progressPercent.textContent}`);
  }
  if (env.elements.progressText.textContent !== '0 of 0 tasks completed') {
    throw new Error(`Expected '0 of 0 tasks completed', got ${env.elements.progressText.textContent}`);
  }
  if (env.elements.progressBar.attributes.get('aria-valuenow') !== '0') {
    throw new Error(`Expected aria-valuenow="0", got ${env.elements.progressBar.attributes.get('aria-valuenow')}`);
  }
  if (env.elements.progressBarFill.style.width !== '0%') {
    throw new Error(`Expected style.width="0%", got ${env.elements.progressBarFill.style.width}`);
  }
});

// 34. Progress indicator: All-active state calculates 0%
runTest('Progress indicator: All-active tasks calculates 0%', () => {
  const env = createEnvironment();
  env.context.createTask('Active Task 1', 'high', null);
  env.context.createTask('Active Task 2', 'medium', null);
  env.context.createTask('Active Task 3', 'low', null);

  if (env.elements.progressPercent.textContent !== '0%') {
    throw new Error(`Expected 0% for all-active tasks, got ${env.elements.progressPercent.textContent}`);
  }
  if (env.elements.progressText.textContent !== '0 of 3 tasks completed') {
    throw new Error(`Expected '0 of 3 tasks completed', got ${env.elements.progressText.textContent}`);
  }
  if (env.elements.progressBarFill.style.width !== '0%') {
    throw new Error(`Expected width="0%", got ${env.elements.progressBarFill.style.width}`);
  }
});

// 35. Progress indicator: All-completed state calculates 100%
runTest('Progress indicator: All-completed tasks calculates 100%', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('Completed Task 1', 'medium', null);
  const t2 = env.context.createTask('Completed Task 2', 'high', null);
  env.context.toggleTaskStatus(t1.id);
  env.context.toggleTaskStatus(t2.id);

  if (env.elements.progressPercent.textContent !== '100%') {
    throw new Error(`Expected 100% for all-completed tasks, got ${env.elements.progressPercent.textContent}`);
  }
  if (env.elements.progressText.textContent !== '2 of 2 tasks completed') {
    throw new Error(`Expected '2 of 2 tasks completed', got ${env.elements.progressText.textContent}`);
  }
  if (env.elements.progressBar.attributes.get('aria-valuenow') !== '100') {
    throw new Error(`Expected aria-valuenow="100", got ${env.elements.progressBar.attributes.get('aria-valuenow')}`);
  }
  if (env.elements.progressBarFill.style.width !== '100%') {
    throw new Error(`Expected width="100%", got ${env.elements.progressBarFill.style.width}`);
  }
});

// 36. Progress indicator: Mixed task progress with exact formula and rounding
runTest('Progress indicator: Mixed task progress with exact formula and rounding', () => {
  const env = createEnvironment();
  // 1 of 4 tasks = 25%
  const t1 = env.context.createTask('Task 1', 'medium', null);
  const t2 = env.context.createTask('Task 2', 'medium', null);
  const t3 = env.context.createTask('Task 3', 'medium', null);
  const t4 = env.context.createTask('Task 4', 'medium', null);
  env.context.toggleTaskStatus(t1.id);

  if (env.elements.progressPercent.textContent !== '25%') {
    throw new Error(`Expected 25% (1/4), got ${env.elements.progressPercent.textContent}`);
  }
  if (env.elements.progressText.textContent !== '1 of 4 tasks completed') {
    throw new Error(`Expected '1 of 4 tasks completed', got ${env.elements.progressText.textContent}`);
  }
  if (env.elements.progressBarFill.style.width !== '25%') {
    throw new Error(`Expected width="25%", got ${env.elements.progressBarFill.style.width}`);
  }

  // Add 1 more completed: 2 of 4 = 50%
  env.context.toggleTaskStatus(t2.id);
  if (env.elements.progressPercent.textContent !== '50%') {
    throw new Error(`Expected 50% (2/4), got ${env.elements.progressPercent.textContent}`);
  }

  // Delete 1 active task: 2 of 3 = 66.666...% -> rounds to 67%
  env.context.deleteTask(t3.id);
  if (env.elements.progressPercent.textContent !== '67%') {
    throw new Error(`Expected 67% (2/3 rounded), got ${env.elements.progressPercent.textContent}`);
  }
  if (env.elements.progressText.textContent !== '2 of 3 tasks completed') {
    throw new Error(`Expected '2 of 3 tasks completed', got ${env.elements.progressText.textContent}`);
  }
});

// 37. Undo delete: Restoring a deleted task restores state and DOM without showing before deletion
runTest('Undo Delete: Restoring a deleted task restores state and DOM', () => {
  const env = createEnvironment();
  // Ensure undo toast is not shown before deletion
  if (!env.elements.undoToast.hidden) {
    throw new Error('Undo notification must not be visible before deletion occurs');
  }

  // Calling deleteTask with an invalid ID must not show undo toast
  env.context.deleteTask('nonexistent-id');
  if (!env.elements.undoToast.hidden) {
    throw new Error('Undo notification must not be shown when deletion did not succeed');
  }

  // Create valid task and delete it
  const task = env.context.createTask('Important Task To Delete', 'high', '2026-11-25');
  const taskId = task.id;
  env.context.deleteTask(taskId);

  // Task should be gone from state and DOM
  if (env.context.getFilteredTasks().some(t => t.id === taskId)) {
    throw new Error('Task should be removed from state after deletion');
  }
  if (env.elements.undoToast.hidden) {
    throw new Error('Undo toast should be visible after successful deletion');
  }
  if (!env.elements.undoMessage.textContent.includes('Important Task To Delete')) {
    throw new Error(`Undo toast message should include task title, got ${env.elements.undoMessage.textContent}`);
  }

  // Trigger Undo
  const restored = env.context.undoDelete();
  if (!restored || restored.id !== taskId) {
    throw new Error('undoDelete did not return the restored task');
  }

  // Task should be back in state and DOM
  const matching = env.context.getFilteredTasks().find(t => t.id === taskId);
  if (!matching) {
    throw new Error('Task was not restored into authoritative state');
  }
  if (env.elements.taskList.children.length !== 1) {
    throw new Error('Restored task was not re-rendered into the DOM');
  }
  if (!env.elements.undoToast.hidden) {
    throw new Error('Undo toast should be hidden after undo is executed');
  }
});

// 38. Undo delete: Restored task retains identical ID and all original fields
runTest('Undo Delete: Preserves original task ID, priority, due date, createdAt, and completion status', () => {
  const env = createEnvironment();
  const created = env.context.createTask('Precision Metadata Task', 'high', '2026-12-25');
  const originalId = created.id;
  const originalCreatedAt = created.createdAt;
  env.context.toggleTaskStatus(originalId); // mark as completed

  // Delete completed task
  env.context.deleteTask(originalId);

  // Undo deletion
  const restored = env.context.undoDelete();

  if (restored.id !== originalId) {
    throw new Error(`ID mismatch: expected ${originalId}, got ${restored.id}`);
  }
  if (restored.title !== 'Precision Metadata Task') {
    throw new Error(`Title mismatch: expected 'Precision Metadata Task', got ${restored.title}`);
  }
  if (restored.priority !== 'high') {
    throw new Error(`Priority mismatch: expected 'high', got ${restored.priority}`);
  }
  if (restored.dueDate !== '2026-12-25') {
    throw new Error(`Due date mismatch: expected '2026-12-25', got ${restored.dueDate}`);
  }
  if (restored.completed !== true) {
    throw new Error(`Completion status mismatch: expected true, got ${restored.completed}`);
  }
  if (restored.createdAt !== originalCreatedAt) {
    throw new Error(`CreatedAt timestamp mismatch: expected ${originalCreatedAt}, got ${restored.createdAt}`);
  }
});

// 39. Undo delete: Window expiration cancels undo opportunity and prevents restoration
runTest('Undo Delete: Expiration timer cancels opportunity and prevents stale undo', () => {
  const env = createEnvironment();
  const task = env.context.createTask('Ephemeral Task', 'low', null);
  env.context.deleteTask(task.id);

  if (env.elements.undoToast.hidden) {
    throw new Error('Undo toast should be open initially');
  }

  // Fire expiration timer
  env.advanceTimers();

  // Toast should now be hidden
  if (!env.elements.undoToast.hidden) {
    throw new Error('Undo toast should be hidden after expiration');
  }

  // Attempting to undo after expiration must fail
  const restored = env.context.undoDelete();
  if (restored !== null) {
    throw new Error('undoDelete should return null after expiration');
  }
  if (env.context.getFilteredTasks().length !== 0) {
    throw new Error('Task must not be restored after undo opportunity expired');
  }
});

// 40. Undo delete: Multiple rapid deletions supported via LIFO stack with sequential restores
runTest('Undo Delete: Multiple rapid deletions supported via LIFO stack', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('First Task', 'high', null);
  const t2 = env.context.createTask('Second Task', 'medium', null);
  const t3 = env.context.createTask('Third Task', 'low', null);

  // Rapidly delete t1, then t2, then t3
  env.context.deleteTask(t1.id);
  env.context.deleteTask(t2.id);
  env.context.deleteTask(t3.id);

  if (env.context.getFilteredTasks().length !== 0) {
    throw new Error('All 3 tasks should be removed from view');
  }
  if (!env.elements.undoMessage.textContent.includes('Third Task')) {
    throw new Error('Toast should show the latest deleted task');
  }

  // 1st Undo -> restores Third Task (LIFO)
  const r3 = env.context.undoDelete();
  if (!r3 || r3.title !== 'Third Task') {
    throw new Error(`First undo should restore Third Task, got ${r3 ? r3.title : null}`);
  }
  if (env.context.getFilteredTasks().length !== 1) {
    throw new Error('State should now contain 1 restored task');
  }
  // Toast should update to show Second Task
  if (!env.elements.undoMessage.textContent.includes('Second Task')) {
    throw new Error(`Toast should update to Second Task, got ${env.elements.undoMessage.textContent}`);
  }

  // 2nd Undo -> restores Second Task
  const r2 = env.context.undoDelete();
  if (!r2 || r2.title !== 'Second Task') {
    throw new Error(`Second undo should restore Second Task, got ${r2 ? r2.title : null}`);
  }
  if (env.context.getFilteredTasks().length !== 2) {
    throw new Error('State should now contain 2 restored tasks');
  }

  // 3rd Undo -> restores First Task
  const r1 = env.context.undoDelete();
  if (!r1 || r1.title !== 'First Task') {
    throw new Error(`Third undo should restore First Task, got ${r1 ? r1.title : null}`);
  }
  if (env.context.getFilteredTasks().length !== 3) {
    throw new Error('State should now contain all 3 restored tasks');
  }
  if (!env.elements.undoToast.hidden) {
    throw new Error('Toast should be hidden once undo stack is empty');
  }
});

// 41. Undo delete: Restored state persists to localStorage and survives page reloads
runTest('Undo Delete: Restored state persists to localStorage and survives reload', () => {
  const env1 = createEnvironment();
  const t = env1.context.createTask('Persistent Restored Task', 'high', '2026-12-30');
  const taskId = t.id;

  // Delete then undo
  env1.context.deleteTask(taskId);
  env1.context.undoDelete();

  // Verify localStorage contains the task
  const rawStorage = env1.mockStorage.getItem('taskflow_tasks');
  if (!rawStorage || !rawStorage.includes('Persistent Restored Task')) {
    throw new Error('localStorage does not contain the restored task');
  }

  // Reload in fresh environment
  const env2 = createEnvironment({ taskflow_tasks: rawStorage });
  const tasks = env2.context.getFilteredTasks();
  if (tasks.length !== 1 || tasks[0].id !== taskId) {
    throw new Error('Restored task did not survive page reload');
  }
  if (tasks[0].priority !== 'high' || tasks[0].dueDate !== '2026-12-30') {
    throw new Error('Task priority or due date corrupted after reload');
  }
});

// 42. JSON Export: Complete task collection with all fields serialized into valid JSON
runTest('JSON Export: Complete task collection with all fields serialized into valid JSON', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('Export Task 1', 'high', '2026-11-20');
  const t2 = env.context.createTask('Export Task 2', 'low', null);
  env.context.toggleTaskStatus(t2.id); // mark completed

  const exported = env.context.exportTasksJSON();
  if (typeof exported !== 'string') {
    throw new Error('exportTasksJSON did not return a string');
  }

  // Must be formatted with indentation
  if (!exported.includes('\n')) {
    throw new Error('Exported JSON is not formatted/indented for readability');
  }

  const parsed = JSON.parse(exported);
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new Error(`Expected array of 2 tasks, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`);
  }

  const found1 = parsed.find(t => t.id === t1.id);
  const found2 = parsed.find(t => t.id === t2.id);
  if (!found1 || !found2) {
    throw new Error('Exported tasks missing matching IDs');
  }

  if (found1.title !== 'Export Task 1' || found1.priority !== 'high' || found1.dueDate !== '2026-11-20' || found1.completed !== false) {
    throw new Error(`Task 1 fields corrupted in export: ${JSON.stringify(found1)}`);
  }
  if (found2.title !== 'Export Task 2' || found2.priority !== 'low' || found2.dueDate !== null || found2.completed !== true) {
    throw new Error(`Task 2 fields corrupted in export: ${JSON.stringify(found2)}`);
  }

  // Also test handleExportTasks() download trigger
  const returnedStr = env.context.handleExportTasks();
  if (returnedStr !== exported) {
    throw new Error('handleExportTasks did not return identical exported string');
  }
  if (env.elements.backupAlert.hidden) {
    throw new Error('Export action should display success alert in DOM');
  }
  if (!env.elements.backupAlert.textContent.includes('Exported 2 task(s)')) {
    throw new Error(`Backup alert text unexpected: ${env.elements.backupAlert.textContent}`);
  }
});

// 43. JSON Export: Empty collection exports valid empty array gracefully
runTest('JSON Export: Empty collection exports valid empty array gracefully', () => {
  const env = createEnvironment();
  const exported = env.context.exportTasksJSON();
  const parsed = JSON.parse(exported);
  if (!Array.isArray(parsed) || parsed.length !== 0) {
    throw new Error(`Expected empty array [], got ${exported}`);
  }

  env.context.handleExportTasks();
  if (!env.elements.backupAlert.textContent.includes('empty collection')) {
    throw new Error(`Expected empty collection export notification, got ${env.elements.backupAlert.textContent}`);
  }
});

// 44. JSON Import: Valid backup merges tasks with existing collection, updates storage and DOM
runTest('JSON Import: Valid backup merges tasks with existing collection, updates storage and DOM', () => {
  const env = createEnvironment();
  const existingTask = env.context.createTask('Existing Task', 'low', null);

  const backupTasks = [
    { id: 'imp-1', title: 'Imported Alpha', completed: false, createdAt: 1700000000000, priority: 'high', dueDate: '2026-12-01' },
    { id: 'imp-2', title: 'Imported Beta', completed: true, createdAt: 1700000001000, priority: 'medium', dueDate: null }
  ];
  const jsonStr = JSON.stringify(backupTasks);

  const res = env.context.importTasksJSON(jsonStr, 'merge');
  if (!res.success || res.importedCount !== 2) {
    throw new Error(`Import failed or unexpected count: ${JSON.stringify(res)}`);
  }

  const tasks = env.context.getFilteredTasks();
  if (tasks.length !== 3) {
    throw new Error(`Expected 3 tasks after merge, found ${tasks.length}`);
  }

  // Verify existing task preserved
  const foundExisting = tasks.find(t => t.id === existingTask.id);
  if (!foundExisting || foundExisting.title !== 'Existing Task') {
    throw new Error('Existing task was lost or mutated during merge');
  }

  // Verify imported tasks present
  const foundAlpha = tasks.find(t => t.title === 'Imported Alpha');
  const foundBeta = tasks.find(t => t.title === 'Imported Beta');
  if (!foundAlpha || foundAlpha.priority !== 'high' || foundAlpha.dueDate !== '2026-12-01') {
    throw new Error('Imported Alpha missing or fields corrupted');
  }
  if (!foundBeta || foundBeta.priority !== 'medium' || !foundBeta.completed) {
    throw new Error('Imported Beta missing or fields corrupted');
  }

  // Verify persisted to localStorage
  const saved = JSON.parse(env.mockStorage.getItem('taskflow_tasks'));
  if (!Array.isArray(saved) || saved.length !== 3) {
    throw new Error('Merged tasks not properly saved to localStorage');
  }

  // Verify DOM rendered
  const taskItems = env.elements.taskList.querySelectorAll('.task-item');
  if (taskItems.length !== 3) {
    throw new Error(`DOM does not render 3 tasks, found ${taskItems.length}`);
  }
  if (!env.elements.backupAlert.textContent.includes('Successfully imported 2 task(s) (merged')) {
    throw new Error(`Alert message unexpected: ${env.elements.backupAlert.textContent}`);
  }
});

// 45. JSON Import: Replace mode with confirmation overwrites existing tasks
runTest('JSON Import: Replace mode with confirmation overwrites existing tasks', () => {
  const env = createEnvironment();
  env.context.createTask('Old Task 1', 'low', null);
  env.context.createTask('Old Task 2', 'medium', null);

  const backupTasks = [
    { id: 'rep-1', title: 'Sole Replacement Task', completed: false, createdAt: 1700000005000, priority: 'high', dueDate: '2026-12-31' }
  ];
  const jsonStr = JSON.stringify(backupTasks);

  let confirmCalled = false;
  const confirmFn = () => {
    confirmCalled = true;
    return true; // user confirms
  };

  const res = env.context.importTasksJSON(jsonStr, 'replace', confirmFn);
  if (!confirmCalled) {
    throw new Error('Replace mode must ask user confirmation before overwrite');
  }
  if (!res.success || res.importedCount !== 1) {
    throw new Error(`Replace import failed: ${JSON.stringify(res)}`);
  }

  const tasks = env.context.getFilteredTasks();
  if (tasks.length !== 1 || tasks[0].title !== 'Sole Replacement Task') {
    throw new Error(`Expected only Sole Replacement Task, got: ${JSON.stringify(tasks)}`);
  }

  const stored = JSON.parse(env.mockStorage.getItem('taskflow_tasks'));
  if (stored.length !== 1 || stored[0].title !== 'Sole Replacement Task') {
    throw new Error('localStorage not updated with replaced task');
  }

  if (!env.elements.backupAlert.textContent.includes('(replaced existing tasks)')) {
    throw new Error(`Alert message unexpected: ${env.elements.backupAlert.textContent}`);
  }
});

// 46. JSON Import: Cancelling replacement prompt preserves existing tasks untouched
runTest('JSON Import: Cancelling replacement prompt preserves existing tasks untouched', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('Preserved 1', 'high', null);
  const t2 = env.context.createTask('Preserved 2', 'low', '2026-10-31');

  const backupTasks = [
    { id: 'discard-1', title: 'Should Not Be Added', completed: false, createdAt: Date.now(), priority: 'low', dueDate: null }
  ];
  const jsonStr = JSON.stringify(backupTasks);

  const res = env.context.importTasksJSON(jsonStr, 'replace', () => false); // user cancels
  if (res.success !== false) {
    throw new Error('Import result should be success: false when cancelled');
  }

  const tasks = env.context.getFilteredTasks();
  if (tasks.length !== 2) {
    throw new Error(`Existing tasks were modified on cancellation; expected 2, got ${tasks.length}`);
  }
  if (tasks.some(t => t.title === 'Should Not Be Added')) {
    throw new Error('Imported task leaked into state after cancellation');
  }

  const stored = JSON.parse(env.mockStorage.getItem('taskflow_tasks'));
  if (stored.length !== 2 || !stored.find(t => t.id === t1.id) || !stored.find(t => t.id === t2.id)) {
    throw new Error('localStorage modified despite cancellation');
  }

  if (!env.elements.backupAlert.textContent.includes('Replacement cancelled')) {
    throw new Error(`Expected cancellation message in backup alert, got: ${env.elements.backupAlert.textContent}`);
  }
});

// 47. JSON Import: Malformed JSON syntax shows error and preserves existing tasks
runTest('JSON Import: Malformed JSON syntax shows error and preserves existing tasks', () => {
  const env = createEnvironment();
  const orig = env.context.createTask('Original Task', 'medium', null);

  const brokenJson = '{"tasks": [ { "id": "1", "title": "Incomplete';

  const res = env.context.importTasksJSON(brokenJson, 'merge');
  if (res.success !== false) {
    throw new Error('Import should fail on malformed JSON syntax');
  }

  const tasks = env.context.getFilteredTasks();
  if (tasks.length !== 1 || tasks[0].id !== orig.id) {
    throw new Error('Existing tasks corrupted after malformed import attempt');
  }

  if (!env.elements.backupAlert.textContent.includes('malformed syntax')) {
    throw new Error(`Expected malformed syntax alert, got: ${env.elements.backupAlert.textContent}`);
  }
  if (env.elements.backupAlert.className.indexOf('backup-alert-error') === -1) {
    throw new Error('Alert class should be backup-alert-error');
  }
});

// 48. JSON Import: Schema validation handles wrapped { tasks: [...] } and rejects non-array schemas
runTest('JSON Import: Schema validation handles wrapped { tasks: [...] } and rejects non-array schemas', () => {
  const env = createEnvironment();
  env.context.createTask('Initial Task', 'medium', null);

  // 1. Valid wrapped schema
  const wrappedBackup = {
    version: 1,
    exportedAt: '2026-10-30',
    tasks: [
      { id: 'wrap-1', title: 'Wrapped Task Alpha', completed: false, createdAt: Date.now(), priority: 'high', dueDate: null }
    ]
  };
  const resWrapped = env.context.importTasksJSON(JSON.stringify(wrappedBackup), 'merge');
  if (!resWrapped.success || resWrapped.importedCount !== 1) {
    throw new Error(`Wrapped tasks schema should be supported: ${JSON.stringify(resWrapped)}`);
  }
  const tasksAfterWrapped = env.context.getFilteredTasks();
  if (!tasksAfterWrapped.find(t => t.title === 'Wrapped Task Alpha')) {
    throw new Error('Wrapped task not found in state after import');
  }

  // 2. Invalid schema (arbitrary object without tasks array)
  const invalidObj = { status: 'ok', items: 10 };
  const resObj = env.context.importTasksJSON(JSON.stringify(invalidObj), 'merge');
  if (resObj.success !== false) {
    throw new Error('Invalid schema object should be rejected');
  }
  if (!env.elements.backupAlert.textContent.includes('Invalid schema')) {
    throw new Error(`Expected invalid schema alert, got: ${env.elements.backupAlert.textContent}`);
  }

  // 3. Invalid schema (primitive number / string)
  const resPrim = env.context.importTasksJSON(JSON.stringify(42), 'merge');
  if (resPrim.success !== false) {
    throw new Error('Primitive JSON value should be rejected');
  }

  // 4. Empty string
  const resEmpty = env.context.importTasksJSON('', 'merge');
  if (resEmpty.success !== false) {
    throw new Error('Empty string input should be rejected');
  }
});

// 49. JSON Import: Corrupted records discarded, valid records sanitized, zero-valid rejected
runTest('JSON Import: Corrupted records discarded, valid records sanitized, zero-valid rejected', () => {
  const env = createEnvironment();
  env.context.createTask('Safe Task', 'medium', null);

  const mixedData = [
    { id: 'v1', title: 'Valid 1', completed: false, priority: 'invalid-priority', dueDate: 'invalid-date' }, // valid with defaults
    null, // null entry
    'random string', // non-object
    { id: 'bad-1' }, // missing title
    { id: 'bad-2', title: '   ', completed: false }, // whitespace title
    { id: 'bad-3', title: 'No boolean completion', completed: 'yes' }, // non-boolean completed
    { id: 'v2', title: 'Valid 2', completed: true, priority: 'high', dueDate: '2026-11-05' }
  ];

  const res = env.context.importTasksJSON(JSON.stringify(mixedData), 'merge');
  if (!res.success || res.importedCount !== 2 || res.discardedCount !== 5) {
    throw new Error(`Expected 2 imported and 5 discarded, got: ${JSON.stringify(res)}`);
  }

  const tasks = env.context.getFilteredTasks();
  const v1 = tasks.find(t => t.title === 'Valid 1');
  if (!v1 || v1.priority !== 'medium' || v1.dueDate !== null) {
    throw new Error(`Valid 1 did not safely default invalid fields: ${JSON.stringify(v1)}`);
  }

  // Test non-empty file with 0 valid tasks
  const zeroValidData = [
    { id: 'b1', title: '' },
    { title: 'No ID' }
  ];
  const resZero = env.context.importTasksJSON(JSON.stringify(zeroValidData), 'merge');
  if (resZero.success !== false) {
    throw new Error('Import with 0 valid records should be rejected');
  }
  if (!env.elements.backupAlert.textContent.includes('No valid task records')) {
    throw new Error(`Expected zero-valid alert, got: ${env.elements.backupAlert.textContent}`);
  }
});

// 50. JSON Import: Duplicate IDs deduplicated within file and against existing tasks
runTest('JSON Import: Duplicate IDs deduplicated within file and against existing tasks', () => {
  const env = createEnvironment();
  const existing = env.context.createTask('Already Here', 'medium', null);
  const existingId = existing.id;

  // Import payload containing:
  // 1. A task with the same ID as the existing task
  // 2. Two tasks with identical internal IDs
  const payload = [
    { id: existingId, title: 'Conflicting With Existing', completed: false, priority: 'low', dueDate: null },
    { id: 'dup-internal', title: 'Internal Dup Alpha', completed: false, priority: 'high', dueDate: null },
    { id: 'dup-internal', title: 'Internal Dup Beta', completed: true, priority: 'medium', dueDate: null }
  ];

  const res = env.context.importTasksJSON(JSON.stringify(payload), 'merge');
  if (!res.success || res.importedCount !== 3) {
    throw new Error(`Import failed: ${JSON.stringify(res)}`);
  }

  const tasks = env.context.getFilteredTasks();
  if (tasks.length !== 4) {
    throw new Error(`Expected 4 total tasks (1 existing + 3 imported), found ${tasks.length}`);
  }

  // All 4 IDs must be strictly unique
  const idSet = new Set(tasks.map(t => t.id));
  if (idSet.size !== 4) {
    throw new Error(`IDs are not unique! Total tasks: ${tasks.length}, Unique IDs: ${idSet.size}`);
  }

  // Original existing task still has its ID
  const origTask = tasks.find(t => t.title === 'Already Here');
  if (!origTask || origTask.id !== existingId) {
    throw new Error('Original task ID was mutated');
  }

  // Conflicting task got a new unique ID
  const conflictTask = tasks.find(t => t.title === 'Conflicting With Existing');
  if (!conflictTask || conflictTask.id === existingId) {
    throw new Error('Conflicting task ID was not re-keyed');
  }

  // Internal duplicates got unique IDs
  const dupA = tasks.find(t => t.title === 'Internal Dup Alpha');
  const dupB = tasks.find(t => t.title === 'Internal Dup Beta');
  if (!dupA || !dupB || dupA.id === dupB.id) {
    throw new Error('Internal duplicate tasks still share the same ID');
  }
});

// 51. JSON Import: XSS defense ensures imported script/HTML titles render safely as text
runTest('JSON Import: XSS defense ensures imported script/HTML titles render safely as text', () => {
  const env = createEnvironment();
  const xssPayload = '<script>window.pwned=true;</script><img src="x" onerror="window.pwned=true">';

  const backupData = [
    { id: 'xss-1', title: xssPayload, completed: false, priority: 'high', dueDate: null }
  ];

  const res = env.context.importTasksJSON(JSON.stringify(backupData), 'merge');
  if (!res.success) {
    throw new Error('Import of task containing HTML characters failed');
  }

  const tasks = env.context.getFilteredTasks();
  if (tasks[0].title !== xssPayload) {
    throw new Error('Task title was corrupted');
  }

  // Verify DOM rendering
  const taskTextSpan = env.elements.taskList.querySelector('.task-text');
  if (!taskTextSpan) {
    throw new Error('Task text element not rendered in DOM');
  }

  // textContent must equal payload (safe text rendering)
  if (taskTextSpan.textContent !== xssPayload) {
    throw new Error(`Task text span textContent unexpected: ${taskTextSpan.textContent}`);
  }

  // Ensure no <script> or <img> tags were injected into the DOM
  const scriptTags = env.elements.taskList.querySelectorAll('script');
  const imgTags = env.elements.taskList.querySelectorAll('img');
  if (scriptTags.length > 0 || imgTags.length > 0) {
    throw new Error('XSS payload injected elements into DOM!');
  }
});

// 52. JSON Import: Authoritative collection preserved across consecutive failed imports
runTest('JSON Import: Authoritative collection preserved across consecutive failed imports', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('T1', 'high', '2026-11-10');
  const t2 = env.context.createTask('T2', 'medium', null);
  const t3 = env.context.createTask('T3', 'low', '2026-12-01');
  const originalJson = env.context.exportTasksJSON();

  // Failed attempt 1: Blank string
  env.context.importTasksJSON('', 'merge');
  // Failed attempt 2: Broken JSON
  env.context.importTasksJSON('{ not json', 'merge');
  // Failed attempt 3: Bad schema
  env.context.importTasksJSON(JSON.stringify({ notTasks: true }), 'merge');
  // Failed attempt 4: Zero valid records
  env.context.importTasksJSON(JSON.stringify([{ invalid: 'entry' }]), 'merge');
  // Failed attempt 5: Cancelled replace
  env.context.importTasksJSON(JSON.stringify([{ id: 'x', title: 'X', completed: false }]), 'replace', () => false);

  // Check state
  const currentTasks = env.context.getFilteredTasks();
  if (currentTasks.length !== 3) {
    throw new Error(`State modified! Expected 3 tasks, found ${currentTasks.length}`);
  }

  // Check storage
  const currentJson = env.context.exportTasksJSON();
  if (currentJson !== originalJson) {
    throw new Error('Authoritative data changed in storage after failed imports');
  }

  // Check statistics
  if (env.elements.totalTasksCount.textContent !== '3') {
    throw new Error('Statistics counter corrupted');
  }
});

// 53. Inline editing updates priority and due dates
runTest('Priority & Due Date Inline Edit: Form controls update priority, deadline, state, storage, and DOM badges', () => {
  const env = createEnvironment();
  env.elements.taskInput.value = 'Task for Metadata Edit';
  env.elements.taskPriority.value = 'low';
  env.elements.taskDueDate.value = '';
  env.elements.taskForm.dispatchEvent(new MockEvent('submit'));

  const editBtn = env.elements.taskList.children[0].querySelector('[data-action="edit"]');
  editBtn.dispatchEvent(new MockEvent('click', { bubbles: true }));

  const editItem = env.elements.taskList.children[0];
  const editPriority = editItem.querySelector('.task-edit-priority');
  const editDueDate = editItem.querySelector('.task-edit-due-date');
  if (!editPriority || !editDueDate) {
    throw new Error('Priority or Due Date selector missing in inline edit form');
  }
  if (editPriority.value !== 'low') {
    throw new Error(`Expected edit priority initialized to 'low', got '${editPriority.value}'`);
  }

  // Change priority to high and set due date
  editPriority.value = 'high';
  editDueDate.value = '2026-12-25';

  const editForm = editItem.querySelector('.task-edit-form');
  editForm.dispatchEvent(new MockEvent('submit', { bubbles: true }));

  const tasks = env.context.getFilteredTasks();
  if (tasks[0].priority !== 'high' || tasks[0].dueDate !== '2026-12-25') {
    throw new Error(`Task state not updated after metadata edit: ${JSON.stringify(tasks[0])}`);
  }

  // Check DOM badges
  const updatedItem = env.elements.taskList.children[0];
  const priorityBadge = updatedItem.querySelector('.priority-badge');
  const dueBadge = updatedItem.querySelector('.due-badge');
  if (!priorityBadge || priorityBadge.textContent !== 'High' || !priorityBadge.classList.contains('priority-high')) {
    throw new Error('Priority badge not updated to High in DOM');
  }
  if (!dueBadge || !dueBadge.textContent.includes('Dec 25, 2026')) {
    throw new Error('Due date badge not updated to Dec 25, 2026 in DOM');
  }

  // Verify storage
  const stored = JSON.parse(env.mockStorage.getItem('taskflow_tasks'));
  if (stored[0].priority !== 'high' || stored[0].dueDate !== '2026-12-25') {
    throw new Error('Updated priority or due date not persisted to localStorage');
  }
});

// 54. Progress indicator integration with Undo Delete
runTest('Progress & Undo Integration: Deletion and restoration dynamically update progress metrics', () => {
  const env = createEnvironment();
  const t1 = env.context.createTask('T1', 'medium', null);
  const t2 = env.context.createTask('T2', 'medium', null);
  const t3 = env.context.createTask('T3', 'medium', null);
  const t4 = env.context.createTask('T4', 'medium', null);

  // Complete 2 out of 4 tasks -> 50%
  env.context.toggleTaskStatus(t1.id);
  env.context.toggleTaskStatus(t2.id);

  if (env.elements.progressPercent.textContent !== '50%') {
    throw new Error(`Expected initial progress 50%, got ${env.elements.progressPercent.textContent}`);
  }

  // Delete completed task t1 -> 1 completed out of 3 total -> 33%
  env.context.deleteTask(t1.id);
  if (env.elements.progressPercent.textContent !== '33%') {
    throw new Error(`Expected progress 33% after deleting completed task, got ${env.elements.progressPercent.textContent}`);
  }

  // Undo delete of t1 -> restores to 2 of 4 -> 50%
  env.context.undoDelete();
  if (env.elements.progressPercent.textContent !== '50%') {
    throw new Error(`Expected progress 50% restored after undo, got ${env.elements.progressPercent.textContent}`);
  }

  // Delete active task t3 -> 2 completed out of 3 total -> 67%
  env.context.deleteTask(t3.id);
  if (env.elements.progressPercent.textContent !== '67%') {
    throw new Error(`Expected progress 67% after deleting active task, got ${env.elements.progressPercent.textContent}`);
  }

  // Undo delete of t3 -> restores to 2 of 4 -> 50%
  env.context.undoDelete();
  if (env.elements.progressPercent.textContent !== '50%') {
    throw new Error(`Expected progress 50% restored after undo, got ${env.elements.progressPercent.textContent}`);
  }
});

// 55. Search Clear Button & Escape key interactions
runTest('Search clear button & Escape: Reset query, display all tasks, and toggle clear button', () => {
  const env = createEnvironment();
  env.context.createTask('Alpha Project', 'high', null);
  env.context.createTask('Beta Review', 'medium', null);
  env.context.createTask('Gamma Testing', 'low', null);

  // 1. Search for "Beta"
  env.elements.taskSearch.value = 'Beta';
  env.elements.taskSearch.dispatchEvent(new MockEvent('input'));

  if (env.elements.searchClearBtn.hidden) {
    throw new Error('Search clear button should be visible when input has content');
  }
  if (env.context.getFilteredTasks().length !== 1) {
    throw new Error(`Expected 1 task matching 'Beta', got ${env.context.getFilteredTasks().length}`);
  }

  // 2. Click clear button
  env.elements.searchClearBtn.dispatchEvent(new MockEvent('click'));
  if (env.elements.taskSearch.value !== '') {
    throw new Error('Search input was not cleared on clear button click');
  }
  if (!env.elements.searchClearBtn.hidden) {
    throw new Error('Search clear button should be hidden after clearing');
  }
  if (env.context.getFilteredTasks().length !== 3) {
    throw new Error('All tasks should be visible after clearing search query');
  }

  // 3. Search for "Gamma" and press Escape
  env.elements.taskSearch.value = 'Gamma';
  env.elements.taskSearch.dispatchEvent(new MockEvent('input'));
  if (env.context.getFilteredTasks().length !== 1) {
    throw new Error(`Expected 1 task matching 'Gamma', got ${env.context.getFilteredTasks().length}`);
  }

  env.elements.taskSearch.dispatchEvent(new MockEvent('keydown', { key: 'Escape' }));
  if (env.elements.taskSearch.value !== '') {
    throw new Error('Search input was not cleared on Escape keydown');
  }
  if (!env.elements.searchClearBtn.hidden) {
    throw new Error('Search clear button should be hidden after Escape reset');
  }
  if (env.context.getFilteredTasks().length !== 3) {
    throw new Error('All tasks should be visible after Escape reset');
  }
});

console.log('================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${results.length})`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
}
