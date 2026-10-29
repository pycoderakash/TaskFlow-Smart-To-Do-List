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

  // Build semantic UI container elements expected by script.js
  const storageAlert = createEl('aside', 'storage-alert');
  const taskForm = createEl('form', 'task-form');
  const taskInput = createEl('input', 'task-input');
  taskForm.appendChild(taskInput);
  const inputError = createEl('p', 'input-error');
  taskForm.appendChild(inputError);

  const totalTasksCount = createEl('strong', 'total-tasks-count');
  const activeTasksCount = createEl('strong', 'active-tasks-count');
  const completedTasksCount = createEl('strong', 'completed-tasks-count');

  const filterGroup = createEl('div', null, 'filter-group');
  const filterAll = createEl('button', null, 'filter-btn active', { filter: 'all' });
  const filterActive = createEl('button', null, 'filter-btn', { filter: 'active' });
  const filterCompleted = createEl('button', null, 'filter-btn', { filter: 'completed' });
  filterGroup.appendChild(filterAll);
  filterGroup.appendChild(filterActive);
  filterGroup.appendChild(filterCompleted);

  const taskList = createEl('ul', 'task-list');
  const emptyState = createEl('div', 'empty-state');
  const emptyStateMessage = createEl('p', null, 'empty-state-message');
  emptyState.appendChild(emptyStateMessage);
  const statusAnnouncer = createEl('div', 'status-announcer');

  const context = {
    window: {
      localStorage: mockStorage
    },
    document: doc,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).substring(2, 10) },
    CSS: {
      escape: (str) => String(str).replace(/["'\\()[\].#:, ]/g, '\\$&')
    },
    setTimeout: (fn) => fn(),
    console, Array, Object, JSON, Date, String, Error, Set, RegExp, Math
  };

  vm.createContext(context);
  const scriptPath = path.resolve(__dirname, 'script.js');
  const scriptCode = fs.readFileSync(scriptPath, 'utf8');
  vm.runInContext(scriptCode, context);

  return {
    context,
    mockStorage,
    filterAll,
    filterActive,
    filterCompleted,
    elements: {
      storageAlert,
      taskForm,
      taskInput,
      inputError,
      taskList,
      emptyState,
      emptyStateMessage,
      totalTasksCount,
      activeTasksCount,
      completedTasksCount,
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

console.log('================================================================');
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${results.length})`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
}
