/**
 * TaskFlow — Smart To-Do List
 * Core Application Script, State Management & Persistent Storage
 *
 * Implements:
 * - Full CRUD operations (Create, Read, Update, Delete, Toggle Complete)
 * - Authoritative single-source-of-truth state container (AppState)
 * - Advanced filtering (All, Active, Completed) preserving authoritative state
 * - Event delegation for dynamically rendered task items and filter controls
 * - Web Storage API (localStorage) persistence under 'taskflow_tasks'
 * - Defensive deserialization, schema validation, and corruption recovery
 * - Safe dynamic DOM generation (document.createElement & textContent - XSS safe)
 * - Accessible live-region announcements & keyboard navigation
 */

'use strict';

/* ==========================================================================
   1. Application State & Storage Configuration
   ========================================================================== */

/**
 * Storage key defined in project requirements
 */
const STORAGE_KEY = 'taskflow_tasks';

/**
 * Supported time window for undoing task deletion (milliseconds)
 */
const UNDO_DURATION_MS = 6000;

/**
 * Task Data Model:
 * @typedef {Object} Task
 * @property {string} id - Collision-resistant unique identifier
 * @property {string} title - Non-empty trimmed string
 * @property {boolean} completed - Task completion boolean flag
 * @property {number} createdAt - Valid unix timestamp (milliseconds)
 * @property {'high'|'medium'|'low'} priority - Task priority level (default: 'medium')
 * @property {string|null} dueDate - ISO date string 'YYYY-MM-DD' or null
 */

/**
 * Single authoritative in-memory application state
 */
const AppState = {
  tasks: [],              // Authoritative in-memory tasks array (Single Source of Truth)
  filter: 'all',          // 'all' | 'active' | 'completed'
  searchQuery: '',        // string - case-insensitive task title search query
  sortBy: 'newest',       // 'newest' | 'oldest' | 'priority-desc' | 'due-asc'
  editingTaskId: null,    // string | null
  undoStack: [],          // Array<{ task: Task, originalIndex: number }> - LIFO undo stack
};

// Global timer reference for pending undo opportunity
let undoTimeoutId = null;

// Cached DOM element references
const DOM = {};

/* ==========================================================================
   2. Utilities & Accessible Feedback
   ========================================================================== */

/**
 * Generates a collision-resistant unique identifier
 * @returns {string} Unique ID
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/**
 * Dispatches an accessible screen-reader announcement to the live region
 * @param {string} message - Announcement text
 */
function announceStatus(message) {
  if (!DOM.statusAnnouncer) return;
  DOM.statusAnnouncer.textContent = '';
  // Micro-timeout ensures assistive technologies register the mutation
  setTimeout(() => {
    DOM.statusAnnouncer.textContent = message;
  }, 50);
}

/**
 * Displays an accessible error message below the main task input
 * @param {string} message - Error description
 */
function showInputError(message) {
  if (!DOM.inputError) return;
  DOM.inputError.textContent = message;
  DOM.inputError.hidden = false;
  if (DOM.taskInput) {
    DOM.taskInput.setAttribute('aria-invalid', 'true');
  }
}

/**
 * Clears and hides the main input error message
 */
function clearInputError() {
  if (!DOM.inputError) return;
  DOM.inputError.textContent = '';
  DOM.inputError.hidden = true;
  if (DOM.taskInput) {
    DOM.taskInput.removeAttribute('aria-invalid');
  }
}

/**
 * Displays a concise alert regarding storage limitations or errors
 * @param {string} message - Storage warning or error text
 */
function showStorageAlert(message) {
  if (DOM.storageAlert) {
    DOM.storageAlert.textContent = message;
    DOM.storageAlert.hidden = false;
  }
  announceStatus(message);
}

/**
 * Clears and hides the storage alert banner
 */
function clearStorageAlert() {
  if (DOM.storageAlert) {
    DOM.storageAlert.textContent = '';
    DOM.storageAlert.hidden = true;
  }
}

/**
 * Priority weighting lookup: High=3, Medium=2, Low=1
 */
const PRIORITY_WEIGHTS = {
  high: 3,
  medium: 2,
  low: 1
};

/**
 * Retrieves the subset of tasks corresponding to the active status filter and search query,
 * ordered according to the active sorting criteria.
 *
 * NOTE: Never mutates the authoritative AppState.tasks array. Operates on a copied subset.
 *
 * Consistent placement rule for tasks without a due date under 'due-asc':
 * Tasks with deadlines are sorted in ascending chronological order (earliest deadline first).
 * Tasks without a deadline (dueDate === null) are placed at the end of the list,
 * sub-sorted by creation timestamp descending (newest first).
 *
 * @returns {Array<Task>} Filtered, searched, and sorted list of tasks
 */
function getFilteredTasks() {
  // 1. Status Filter Projection (All, Active, Completed)
  let result;
  switch (AppState.filter) {
    case 'active':
      result = AppState.tasks.filter(task => !task.completed);
      break;
    case 'completed':
      result = AppState.tasks.filter(task => task.completed);
      break;
    case 'all':
    default:
      result = AppState.tasks.slice();
      break;
  }

  // 2. Case-Insensitive Search by Task Title with Trimmed Surrounding Whitespace
  const trimmedQuery = AppState.searchQuery ? AppState.searchQuery.trim().toLowerCase() : '';
  if (trimmedQuery) {
    result = result.filter(task => task.title.toLowerCase().includes(trimmedQuery));
  }

  // 3. Sorting Execution on Copied Array (Without mutating authoritative AppState.tasks)
  result.sort((a, b) => {
    switch (AppState.sortBy) {
      case 'oldest':
        return a.createdAt - b.createdAt;

      case 'priority-desc': {
        const weightA = PRIORITY_WEIGHTS[a.priority] || 2;
        const weightB = PRIORITY_WEIGHTS[b.priority] || 2;
        const diff = weightB - weightA;
        if (diff !== 0) return diff;
        // Secondary tie-breaker: newest first
        return b.createdAt - a.createdAt;
      }

      case 'due-asc': {
        // Documented rule: Tasks with due dates appear first in chronological order (earliest first).
        // Tasks without a due date are placed at the end, sub-sorted newest first.
        if (a.dueDate && b.dueDate) {
          if (a.dueDate < b.dueDate) return -1;
          if (a.dueDate > b.dueDate) return 1;
          return b.createdAt - a.createdAt;
        }
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        return b.createdAt - a.createdAt;
      }

      case 'newest':
      default:
        return b.createdAt - a.createdAt;
    }
  });

  return result;
}

/**
 * Recalculates and updates the task summary metrics and progress indicator in the DOM
 */
function updateTaskStats() {
  const total = AppState.tasks.length;
  const active = AppState.tasks.filter(task => !task.completed).length;
  const completed = AppState.tasks.filter(task => task.completed).length;

  if (DOM.totalTasksCount) DOM.totalTasksCount.textContent = String(total);
  if (DOM.activeTasksCount) DOM.activeTasksCount.textContent = String(active);
  if (DOM.completedTasksCount) DOM.completedTasksCount.textContent = String(completed);

  // Completion Progress Calculation:
  // progress = totalTasks === 0 ? 0 : (completedTasks / totalTasks) * 100
  const progress = total === 0 ? 0 : (completed / total) * 100;
  const roundedProgress = Math.round(progress);

  if (DOM.progressText) {
    DOM.progressText.textContent = `${completed} of ${total} tasks completed`;
  }
  if (DOM.progressPercent) {
    DOM.progressPercent.textContent = `${roundedProgress}%`;
  }
  if (DOM.progressBar) {
    DOM.progressBar.setAttribute('aria-valuenow', String(roundedProgress));
    DOM.progressBar.setAttribute('aria-valuetext', `${roundedProgress}% completed`);
  }
  if (DOM.progressBarFill) {
    DOM.progressBarFill.style.width = `${roundedProgress}%`;
  }
}

/* ==========================================================================
   3. Persistent Storage Layer (window.localStorage)
   ========================================================================== */

const VALID_PRIORITIES = ['high', 'medium', 'low'];

/**
 * Validates and sanitizes a priority value
 * @param {unknown} val - Candidate priority string
 * @returns {'high'|'medium'|'low'} Sanitized priority level
 */
function sanitizePriority(val) {
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (VALID_PRIORITIES.includes(lower)) {
      return lower;
    }
  }
  return 'medium';
}

/**
 * Validates and sanitizes a date-only string in YYYY-MM-DD format
 * Validates actual calendar correctness to prevent invalid dates like 2026-02-31
 * @param {unknown} val - Candidate due date
 * @returns {string|null} Validated YYYY-MM-DD string or null
 */
function sanitizeDueDate(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);

  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return null;
  }

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Returns today's local calendar date as a YYYY-MM-DD string
 * Uses local getters to avoid timezone offset conversion errors
 * @param {Date} [dateObj=new Date()] - Reference date
 * @returns {string} Local date string
 */
function getLocalDateString(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats calendar date parts into a human-readable string (e.g. 'Oct 30, 2026')
 * Uses local parts to guarantee zero timezone offset distortion
 * @param {number} year - Year (YYYY)
 * @param {number} month - Month (1-12)
 * @param {number} day - Day of month (1-31)
 * @returns {string} Formatted readable date
 */
function formatReadableDate(year, month, day) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month - 1]} ${day}, ${year}`;
}

/**
 * Calculates due date metadata and status classification:
 * - 'completed': For completed tasks (completed tasks are never labeled overdue)
 * - 'overdue': For past uncompleted deadlines
 * - 'today': For deadlines falling on today's local calendar date
 * - 'upcoming': For future deadlines
 * @param {string|null} dueDate - Validated YYYY-MM-DD string
 * @param {boolean} completed - Task completion flag
 * @returns {{ status: 'completed'|'overdue'|'today'|'upcoming', badgeText: string, accessibleLabel: string, formattedDate: string }|null}
 */
function getDueDateInfo(dueDate, completed) {
  const sanitized = sanitizeDueDate(dueDate);
  if (!sanitized) return null;

  const [yStr, mStr, dStr] = sanitized.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  const formatted = formatReadableDate(y, m, d);
  const todayStr = getLocalDateString();

  if (completed) {
    return {
      status: 'completed',
      badgeText: `Done · ${formatted}`,
      accessibleLabel: `Completed (Deadline was ${formatted})`,
      formattedDate: formatted
    };
  }

  if (sanitized < todayStr) {
    return {
      status: 'overdue',
      badgeText: `Overdue · ${formatted}`,
      accessibleLabel: `Overdue: deadline was ${formatted}`,
      formattedDate: formatted
    };
  }

  if (sanitized === todayStr) {
    return {
      status: 'today',
      badgeText: `Due today · ${formatted}`,
      accessibleLabel: `Due today: ${formatted}`,
      formattedDate: formatted
    };
  }

  return {
    status: 'upcoming',
    badgeText: `Due · ${formatted}`,
    accessibleLabel: `Upcoming deadline: ${formatted}`,
    formattedDate: formatted
  };
}

/**
 * Validates and sanitizes an individual task candidate from untrusted storage
 * Assigns safe defaults for older records without priority or due date
 * @param {unknown} item - Untrusted candidate record
 * @returns {Task|null} Sanitized Task object or null if record fails validation
 */
function validateAndSanitizeTask(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  // 1. Validate ID: non-empty string
  if (typeof item.id !== 'string' || item.id.trim().length === 0) {
    return null;
  }

  // 2. Validate Title: non-empty string after trimming
  if (typeof item.title !== 'string') {
    return null;
  }
  const trimmedTitle = item.title.trim();
  if (trimmedTitle.length === 0) {
    return null;
  }

  // 3. Validate Completed: strictly boolean
  if (typeof item.completed !== 'boolean') {
    return null;
  }

  // 4. Validate CreatedAt: valid positive number timestamp
  let createdAt = item.createdAt;
  if (typeof createdAt !== 'number' || isNaN(createdAt) || createdAt <= 0) {
    createdAt = Date.now();
  }

  // 5. Validate Priority: 'high' | 'medium' | 'low' (defaults to 'medium' for legacy tasks)
  const priority = sanitizePriority(item.priority);

  // 6. Validate DueDate: 'YYYY-MM-DD' or null (defaults to null for legacy tasks)
  const dueDate = sanitizeDueDate(item.dueDate);

  return {
    id: item.id.trim(),
    title: trimmedTitle,
    completed: item.completed,
    createdAt: createdAt,
    priority: priority,
    dueDate: dueDate,
  };
}

/**
 * Loads, parses, and validates tasks from localStorage
 * Does not clear storage automatically when parsing errors occur.
 * @returns {Array<Task>} Restored tasks array
 */
function loadTasks() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      console.warn('TaskFlow: localStorage is not accessible in this environment.');
      showStorageAlert('Storage unavailable: Tasks will not persist across browser sessions.');
      return [];
    }

    const rawData = window.localStorage.getItem(STORAGE_KEY);

    // Key does not exist yet (clean first load)
    if (rawData === null || rawData === undefined) {
      return [];
    }

    // Parse JSON defensively
    let parsed;
    try {
      parsed = JSON.parse(rawData);
    } catch (parseError) {
      console.error('TaskFlow: Malformed JSON encountered in localStorage. Preserving raw storage.', parseError);
      showStorageAlert('Warning: Stored tasks were corrupted and could not be parsed.');
      return [];
    }

    // Validate top-level structure: must be an Array
    if (!Array.isArray(parsed)) {
      console.warn('TaskFlow: Expected top-level Array in localStorage, got:', typeof parsed);
      showStorageAlert('Warning: Stored tasks structure was invalid.');
      return [];
    }

    // Validate and sanitize each individual record
    const validTasks = [];
    const seenIds = new Set();
    let invalidCount = 0;

    for (const candidate of parsed) {
      const sanitized = validateAndSanitizeTask(candidate);
      if (sanitized) {
        // Guard against duplicate IDs in untrusted stored data
        if (seenIds.has(sanitized.id)) {
          sanitized.id = generateId();
        }
        seenIds.add(sanitized.id);
        validTasks.push(sanitized);
      } else {
        invalidCount++;
      }
    }

    if (invalidCount > 0) {
      console.warn(`TaskFlow: Discarded ${invalidCount} invalid task record(s) from storage.`);
      showStorageAlert('Warning: Some invalid task records were discarded from storage.');
    }

    return validTasks;
  } catch (err) {
    console.error('TaskFlow: Unexpected error reading from localStorage:', err);
    showStorageAlert('Error: Could not load stored tasks.');
    return [];
  }
}

/**
 * Serializes and saves the authoritative task state to localStorage
 * @returns {boolean} True if write succeeded, false if failed
 */
function saveTasks() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      showStorageAlert('Storage unavailable: Changes cannot be saved.');
      return false;
    }

    const serialized = JSON.stringify(AppState.tasks);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    clearStorageAlert();
    return true;
  } catch (err) {
    console.error('TaskFlow: Error writing tasks to localStorage:', err);

    // Differentiate QuotaExceededError from general errors
    const isQuota = err && (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014 ||
      (typeof err.message === 'string' && err.message.toLowerCase().includes('quota'))
    );

    if (isQuota) {
      showStorageAlert('Storage quota exceeded. Your latest changes could not be saved.');
    } else {
      showStorageAlert('Storage write failed. Your changes may not persist.');
    }
    return false;
  }
}

/* ==========================================================================
   4. Authoritative State Mutations (CRUD & Filtering Operations)
   ========================================================================== */

/**
 * Creates a new task, persists to storage, and re-renders preserving active filter
 * @param {string} rawTitle - Raw user input title
 * @param {string} [rawPriority='medium'] - Priority level ('high' | 'medium' | 'low')
 * @param {string|null} [rawDueDate=null] - Due date string ('YYYY-MM-DD' or null)
 * @returns {Task|null} Created task or null if invalid
 */
function createTask(rawTitle, rawPriority = 'medium', rawDueDate = null) {
  const trimmed = rawTitle ? rawTitle.trim() : '';
  if (!trimmed) {
    showInputError('Please enter a task title. Empty tasks cannot be added.');
    return null;
  }

  const newTask = {
    id: generateId(),
    title: trimmed,
    completed: false,
    createdAt: Date.now(),
    priority: sanitizePriority(rawPriority),
    dueDate: sanitizeDueDate(rawDueDate),
  };

  // Add new tasks to the beginning of the authoritative array
  AppState.tasks.unshift(newTask);

  // Persist state change
  saveTasks();

  clearInputError();
  announceStatus(`Task "${trimmed}" added with ${newTask.priority} priority.`);
  render();
  return newTask;
}

/**
 * Toggles a task's completed status, saves to storage, and re-renders
 * @param {string} taskId - Target task ID
 */
function toggleTaskStatus(taskId) {
  const task = AppState.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.completed = !task.completed;

  // Persist state change
  saveTasks();

  const statusLabel = task.completed ? 'completed' : 'active';
  announceStatus(`Task "${task.title}" marked as ${statusLabel}.`);
  render();
}

/**
 * Initiates inline editing mode (UI change only, does not mutate task data)
 * @param {string} taskId - Target task ID
 */
function startTaskEdit(taskId) {
  const task = AppState.tasks.find(t => t.id === taskId);
  if (!task) return;

  AppState.editingTaskId = taskId;
  announceStatus(`Editing task "${task.title}". Press Escape to cancel.`);
  render();
}

/**
 * Restores keyboard focus to a task's Edit button after exiting edit mode
 * Safely resolves the target task item without throwing on unusual stored IDs
 * @param {string} taskId - Target task ID
 */
function restoreTaskFocus(taskId) {
  if (!DOM.taskList || !taskId) return;

  let taskItem = null;

  // 1. Attempt lookup using CSS.escape if available
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    try {
      taskItem = DOM.taskList.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
    } catch (_) {
      // Fall through to direct attribute inspection
    }
  }

  // 2. Safe fallback: Compare dataset.taskId directly without selector interpolation
  if (!taskItem) {
    const items = DOM.taskList.querySelectorAll('.task-item');
    for (const item of items) {
      if (item.dataset && item.dataset.taskId === taskId) {
        taskItem = item;
        break;
      }
    }
  }

  if (taskItem) {
    const editBtn = taskItem.querySelector('.btn-edit');
    if (editBtn) {
      editBtn.focus();
    }
  }
}

/**
 * Saves changes to an existing task title, priority, and due date, saves to storage, and re-renders
 * @param {string} taskId - Target task ID
 * @param {string} newTitle - New title string
 * @param {string} [newPriority] - Optional updated priority ('high' | 'medium' | 'low')
 * @param {string|null} [newDueDate] - Optional updated due date ('YYYY-MM-DD' or null)
 * @returns {boolean} Whether the update succeeded
 */
function saveTaskEdit(taskId, newTitle, newPriority, newDueDate) {
  const task = AppState.tasks.find(t => t.id === taskId);
  if (!task) return false;

  const trimmed = newTitle ? newTitle.trim() : '';
  if (!trimmed) {
    announceStatus('Task title cannot be empty.');
    return false;
  }

  const priorityToSave = newPriority !== undefined ? sanitizePriority(newPriority) : task.priority;
  const dueDateToSave = newDueDate !== undefined ? sanitizeDueDate(newDueDate) : task.dueDate;

  const hasChanged = task.title !== trimmed || task.priority !== priorityToSave || task.dueDate !== dueDateToSave;
  task.title = trimmed;
  task.priority = priorityToSave;
  task.dueDate = dueDateToSave;
  AppState.editingTaskId = null;

  // Persist only if state actually changed
  if (hasChanged) {
    saveTasks();
  }

  announceStatus(`Task updated to "${trimmed}".`);
  render();

  // Restore focus to the task's Edit button for keyboard accessibility
  restoreTaskFocus(taskId);
  return true;
}

/**
 * Cancels active task editing mode without saving
 */
function cancelTaskEdit() {
  if (AppState.editingTaskId === null) return;
  const previousEditId = AppState.editingTaskId;
  AppState.editingTaskId = null;
  announceStatus('Task editing cancelled.');
  render();

  // Restore focus to the task's Edit button for keyboard accessibility
  restoreTaskFocus(previousEditId);
}

/**
 * Deletes a single task, saves to storage, and activates an Undo opportunity
 * @param {string} taskId - Target task ID
 */
function deleteTask(taskId) {
  const taskIndex = AppState.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return;

  const [removedTask] = AppState.tasks.splice(taskIndex, 1);

  if (AppState.editingTaskId === taskId) {
    AppState.editingTaskId = null;
  }

  // Persist state change
  saveTasks();

  // Push to Undo stack (supporting multiple rapid deletions via LIFO)
  AppState.undoStack.push({ task: removedTask, originalIndex: taskIndex });

  // Reset any pending undo expiration timer
  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }

  // Display Undo Toast notification
  if (DOM.undoToast && DOM.undoMessage) {
    DOM.undoMessage.textContent = `Task "${removedTask.title}" deleted.`;
    DOM.undoToast.hidden = false;
    DOM.undoToast.classList.add('visible');
  }

  // Start new timer for undo window
  undoTimeoutId = setTimeout(() => {
    handleUndoExpired();
  }, UNDO_DURATION_MS);

  announceStatus(`Task "${removedTask.title}" deleted. Select Undo to restore.`);
  render();
}

/**
 * Restores the most recently deleted task from the undo stack (LIFO)
 * @returns {Task|null} Restored task record or null if no active undo
 */
function undoDelete() {
  if (!AppState.undoStack || AppState.undoStack.length === 0) return null;

  // Cancel pending timeout
  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }

  const { task, originalIndex } = AppState.undoStack.pop();

  // Restore into authoritative tasks array at original index (clamped safely)
  const insertIndex = Math.min(Math.max(0, originalIndex), AppState.tasks.length);
  AppState.tasks.splice(insertIndex, 0, task);

  // Persist restored state immediately
  saveTasks();

  announceStatus(`Task "${task.title}" restored.`);

  // If previous rapid deletions remain on the stack, show the next item
  if (AppState.undoStack.length > 0) {
    const nextItem = AppState.undoStack[AppState.undoStack.length - 1];
    if (DOM.undoMessage) {
      DOM.undoMessage.textContent = `Task "${nextItem.task.title}" deleted.`;
    }
    undoTimeoutId = setTimeout(() => {
      handleUndoExpired();
    }, UNDO_DURATION_MS);
  } else {
    hideUndoToast();
  }

  render();
  return task;
}

/**
 * Handles expiration of the undo opportunity
 */
function handleUndoExpired() {
  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }
  if (AppState.undoStack && AppState.undoStack.length > 0) {
    AppState.undoStack = [];
    announceStatus('Undo opportunity expired.');
  }
  hideUndoToast();
}

/**
 * Dismisses the undo notification explicitly
 */
function handleUndoDismiss() {
  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }
  if (AppState.undoStack) {
    AppState.undoStack = [];
  }
  hideUndoToast();
}

/**
 * Hides the undo toast element
 */
function hideUndoToast() {
  if (DOM.undoToast) {
    DOM.undoToast.classList.remove('visible');
    DOM.undoToast.hidden = true;
  }
}

/**
 * Sets the active task filter and re-renders without mutating the tasks array
 * @param {'all'|'active'|'completed'} filterName - Filter selection
 */
function setFilter(filterName) {
  if (!['all', 'active', 'completed'].includes(filterName)) return;

  // Clear pending edit mode when switching filters
  if (AppState.editingTaskId !== null) {
    AppState.editingTaskId = null;
  }

  AppState.filter = filterName;

  // Update ARIA pressed states and CSS active classes on filter buttons
  if (DOM.filterButtons) {
    DOM.filterButtons.forEach(btn => {
      const isSelected = btn.dataset.filter === filterName;
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      btn.classList.toggle('active', isSelected);
    });
  }

  announceStatus(`Viewing ${filterName} tasks.`);
  render();
}

/**
 * Sets the active search query and re-renders visible tasks without mutating state
 * @param {string} query - Search term
 */
function setSearchQuery(query) {
  AppState.searchQuery = typeof query === 'string' ? query : '';
  if (DOM.taskSearch && DOM.taskSearch.value !== AppState.searchQuery) {
    DOM.taskSearch.value = AppState.searchQuery;
  }
  if (DOM.searchClearBtn) {
    DOM.searchClearBtn.hidden = !AppState.searchQuery.trim();
  }
  render();
}

/**
 * Sets the active sort criteria and re-renders visible tasks without mutating state
 * @param {'newest'|'oldest'|'priority-desc'|'due-asc'} sortBy - Sort option
 */
function setSortBy(sortBy) {
  const validSorts = ['newest', 'oldest', 'priority-desc', 'due-asc'];
  if (!validSorts.includes(sortBy)) return;

  AppState.sortBy = sortBy;
  if (DOM.sortSelect && DOM.sortSelect.value !== sortBy) {
    DOM.sortSelect.value = sortBy;
  }
  const sortLabels = {
    'newest': 'Newest first',
    'oldest': 'Oldest first',
    'priority-desc': 'Priority: High to Low',
    'due-asc': 'Due date: Earliest first'
  };
  announceStatus(`Sorted tasks by ${sortLabels[sortBy] || sortBy}.`);
  render();
}

/* ==========================================================================
   4.5. Backup & Data Management (JSON Export & Import)
   ========================================================================== */

/**
 * Displays a temporary alert in the backup card
 * @param {string} message - Notice or error string
 * @param {'info'|'success'|'error'} [type='info'] - Style type
 */
function showBackupAlert(message, type = 'info') {
  if (DOM.backupAlert) {
    DOM.backupAlert.textContent = message;
    DOM.backupAlert.className = `backup-alert backup-alert-${type}`;
    DOM.backupAlert.hidden = false;
    setTimeout(() => {
      if (DOM.backupAlert && DOM.backupAlert.textContent === message) {
        DOM.backupAlert.hidden = true;
      }
    }, 6000);
  }
  announceStatus(message);
}

/**
 * Serializes the authoritative task collection to formatted, readable JSON
 * @returns {string} Formatted JSON string
 */
function exportTasksJSON() {
  return JSON.stringify(AppState.tasks, null, 2);
}

/**
 * Handles client-side file download of taskflow-backup.json
 * @returns {string} Serialized JSON
 */
function handleExportTasks() {
  const jsonString = exportTasksJSON();

  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'taskflow-backup.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('TaskFlow: Error initiating download:', err);
    }
  }

  const count = AppState.tasks.length;
  const msg = count === 0
    ? 'Exported empty collection (0 tasks) to taskflow-backup.json.'
    : `Exported ${count} task(s) to taskflow-backup.json.`;

  showBackupAlert(msg, 'success');
  return jsonString;
}

/**
 * Imports tasks from a JSON string with validation, sanitization, and duplicate resolution
 * @param {string} jsonString - Uploaded JSON string
 * @param {'merge'|'replace'} [mode='merge'] - Import mode ('merge' or 'replace')
 * @param {() => boolean} [confirmFn] - Optional confirmation function for 'replace' mode
 * @returns {{ success: boolean, importedCount: number, error?: string, discardedCount?: number }}
 */
function importTasksJSON(jsonString, mode = 'merge', confirmFn = null) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    const errorMsg = 'Failed to import: File is empty or content is invalid.';
    showBackupAlert(errorMsg, 'error');
    return { success: false, importedCount: 0, error: errorMsg };
  }

  // 1. JSON Syntax Validation
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const errorMsg = 'Failed to parse JSON: File contains malformed syntax.';
    showBackupAlert(errorMsg, 'error');
    return { success: false, importedCount: 0, error: errorMsg };
  }

  // 2. Top-Level Schema Validation: Array or Object with .tasks Array
  let rawList = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
    rawList = parsed.tasks;
  } else {
    const errorMsg = 'Invalid schema: Uploaded file must contain a list of tasks.';
    showBackupAlert(errorMsg, 'error');
    return { success: false, importedCount: 0, error: errorMsg };
  }

  // 3. Record Validation & Sanitization
  const validTasks = [];
  const importedSeenIds = new Set();
  let discardedCount = 0;

  for (const candidate of rawList) {
    const sanitized = validateAndSanitizeTask(candidate);
    if (sanitized) {
      // Resolve duplicate IDs within the imported file itself
      if (importedSeenIds.has(sanitized.id)) {
        sanitized.id = generateId();
      }
      importedSeenIds.add(sanitized.id);
      validTasks.push(sanitized);
    } else {
      discardedCount++;
    }
  }

  // If the file was non-empty but contained 0 valid tasks
  if (rawList.length > 0 && validTasks.length === 0) {
    const errorMsg = 'Import rejected: No valid task records found in the file.';
    showBackupAlert(errorMsg, 'error');
    return { success: false, importedCount: 0, error: errorMsg };
  }

  // 4. Execution of Replace vs. Merge
  if (mode === 'replace') {
    const shouldProceed = typeof confirmFn === 'function'
      ? confirmFn()
      : (typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm('Replacing your tasks will overwrite all existing tasks with the imported backup. Do you want to proceed?')
          : true);

    if (!shouldProceed) {
      const cancelMsg = 'Replacement cancelled. Existing tasks were preserved.';
      announceStatus(cancelMsg);
      showBackupAlert(cancelMsg, 'info');
      return { success: false, importedCount: 0, error: 'Cancelled by user' };
    }

    // Overwrite state
    AppState.tasks = validTasks;
    AppState.editingTaskId = null;
  } else {
    // Merge mode: resolve duplicate IDs against existing tasks
    const existingIds = new Set(AppState.tasks.map(t => t.id));
    for (const task of validTasks) {
      if (existingIds.has(task.id)) {
        task.id = generateId();
      }
      existingIds.add(task.id);
    }

    // Prepend imported tasks
    AppState.tasks = validTasks.concat(AppState.tasks);
  }

  // 5. Persist, render, and notify
  saveTasks();
  render();

  let successMsg = `Successfully imported ${validTasks.length} task(s)`;
  if (mode === 'replace') {
    successMsg += ' (replaced existing tasks).';
  } else {
    successMsg += ' (merged with existing tasks).';
  }
  if (discardedCount > 0) {
    successMsg += ` Discarded ${discardedCount} invalid record(s).`;
  }

  showBackupAlert(successMsg, 'success');
  return {
    success: true,
    importedCount: validTasks.length,
    discardedCount: discardedCount
  };
}

/**
 * Handles file input change event from DOM
 * @param {Event} e - Input change event
 */
function handleImportChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const mode = DOM.importModeSelect ? DOM.importModeSelect.value : 'merge';
  const reader = new FileReader();

  reader.onload = (event) => {
    const content = event.target.result;
    importTasksJSON(content, mode);
    if (DOM.importFileInput) {
      DOM.importFileInput.value = '';
    }
  };

  reader.onerror = () => {
    showBackupAlert('Failed to read the file from disk.', 'error');
    if (DOM.importFileInput) {
      DOM.importFileInput.value = '';
    }
  };

  reader.readAsText(file);
}

/* ==========================================================================
   5. Safe Dynamic DOM Generation & Rendering
   ========================================================================== */

/**
 * Dynamically builds a single task item DOM tree using document.createElement & textContent
 * Action buttons include nested span elements to support and verify event delegation
 * @param {Task} task - The task record
 * @param {boolean} isEditing - Whether this task is currently in edit mode
 * @returns {HTMLLIElement} Rendered list item element
 */
function createTaskElement(task, isEditing) {
  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.taskId = task.id;
  li.setAttribute('role', 'listitem');

  if (task.completed) {
    li.classList.add('completed');
  }

  // --- Inline Editing Mode ---
  if (isEditing) {
    li.classList.add('is-editing');

    const editForm = document.createElement('form');
    editForm.className = 'task-edit-form';
    editForm.dataset.taskId = task.id;
    editForm.dataset.action = 'edit-form';
    editForm.noValidate = true;

    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'task-edit-input';
    editInput.value = task.title;
    editInput.dataset.taskId = task.id;
    editInput.setAttribute('aria-label', `Edit title for ${task.title}`);
    editInput.required = true;
    editInput.autocomplete = 'off';

    // Priority selector in edit mode
    const editPriority = document.createElement('select');
    editPriority.className = 'task-edit-priority';
    editPriority.setAttribute('aria-label', `Edit priority for ${task.title}`);
    ['low', 'medium', 'high'].forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      if (p === task.priority) {
        opt.selected = true;
      }
      editPriority.appendChild(opt);
    });
    editPriority.value = task.priority;

    // Due date input in edit mode
    const editDueDate = document.createElement('input');
    editDueDate.type = 'date';
    editDueDate.className = 'task-edit-due-date';
    editDueDate.value = task.dueDate || '';
    editDueDate.setAttribute('aria-label', `Edit due date for ${task.title}`);

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'task-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn-action btn-save';
    saveBtn.dataset.action = 'save';
    saveBtn.dataset.taskId = task.id;
    saveBtn.setAttribute('aria-label', `Save changes to ${task.title}`);

    const saveText = document.createElement('span');
    saveText.className = 'btn-text';
    saveText.textContent = 'Save';
    saveBtn.appendChild(saveText);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-action btn-cancel';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.dataset.taskId = task.id;
    cancelBtn.setAttribute('aria-label', 'Cancel editing');

    const cancelText = document.createElement('span');
    cancelText.className = 'btn-text';
    cancelText.textContent = 'Cancel';
    cancelBtn.appendChild(cancelText);

    actionsContainer.appendChild(saveBtn);
    actionsContainer.appendChild(cancelBtn);

    editForm.appendChild(editInput);
    editForm.appendChild(editPriority);
    editForm.appendChild(editDueDate);
    editForm.appendChild(actionsContainer);
    li.appendChild(editForm);

    return li;
  }

  // --- Standard Display Mode ---
  const mainRegion = document.createElement('div');
  mainRegion.className = 'task-item-main';

  // Completion Checkbox with Accessible Label
  const checkboxLabel = document.createElement('label');
  checkboxLabel.className = 'task-checkbox-label';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.completed;
  checkbox.dataset.action = 'toggle';
  checkbox.dataset.taskId = task.id;
  checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.completed ? 'active' : 'complete'}`);

  checkboxLabel.appendChild(checkbox);

  // Task Details Wrapper (Title + Meta Badges)
  const detailsContainer = document.createElement('div');
  detailsContainer.className = 'task-details';

  // Safe Text Container
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-text';
  titleSpan.textContent = task.title; // Safe textContent to prevent HTML/XSS injection
  detailsContainer.appendChild(titleSpan);

  // Meta Badges Container (Priority Badge & Due Date Badge)
  const badgesContainer = document.createElement('div');
  badgesContainer.className = 'task-badges';

  // 1. Priority Badge
  const priorityBadge = document.createElement('span');
  priorityBadge.className = `task-badge priority-badge priority-${task.priority}`;
  priorityBadge.dataset.priority = task.priority;
  priorityBadge.setAttribute('role', 'status');
  priorityBadge.setAttribute('aria-label', `Priority: ${task.priority}`);
  priorityBadge.textContent = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
  badgesContainer.appendChild(priorityBadge);

  // 2. Due Date Badge (if present)
  if (task.dueDate) {
    const dueInfo = getDueDateInfo(task.dueDate, task.completed);
    if (dueInfo) {
      const dueBadge = document.createElement('span');
      dueBadge.className = `task-badge due-badge due-${dueInfo.status}`;
      dueBadge.dataset.dueStatus = dueInfo.status;
      dueBadge.setAttribute('role', 'status');
      dueBadge.setAttribute('aria-label', dueInfo.accessibleLabel);
      dueBadge.textContent = dueInfo.badgeText;
      badgesContainer.appendChild(dueBadge);
    }
  }

  detailsContainer.appendChild(badgesContainer);

  mainRegion.appendChild(checkboxLabel);
  mainRegion.appendChild(detailsContainer);

  // Task Actions (Edit & Delete buttons with nested label spans)
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'task-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-action btn-edit';
  editBtn.dataset.action = 'edit';
  editBtn.dataset.taskId = task.id;
  editBtn.setAttribute('aria-label', `Edit task "${task.title}"`);

  const editText = document.createElement('span');
  editText.className = 'btn-text';
  editText.textContent = 'Edit';
  editBtn.appendChild(editText);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-action btn-delete';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.dataset.taskId = task.id;
  deleteBtn.setAttribute('aria-label', `Delete task "${task.title}"`);

  const deleteText = document.createElement('span');
  deleteText.className = 'btn-text';
  deleteText.textContent = 'Delete';
  deleteBtn.appendChild(deleteText);

  actionsContainer.appendChild(editBtn);
  actionsContainer.appendChild(deleteBtn);

  li.appendChild(mainRegion);
  li.appendChild(actionsContainer);

  return li;
}

/**
 * Re-renders the entire tasks view based on current state and active filter
 */
function render() {
  if (!DOM.taskList) return;

  const filteredTasks = getFilteredTasks();

  // Clear previous task list content cleanly
  DOM.taskList.innerHTML = '';

  // Empty State Presentation with context-aware messaging
  if (filteredTasks.length === 0) {
    if (DOM.emptyState) {
      DOM.emptyState.hidden = false;

      const messageElem = DOM.emptyState.querySelector('.empty-state-message');
      if (messageElem) {
        const trimmedQuery = AppState.searchQuery ? AppState.searchQuery.trim() : '';
        if (trimmedQuery) {
          messageElem.textContent = `No tasks match "${trimmedQuery}". Try another search term or clear the search.`;
        } else if (AppState.tasks.length === 0) {
          messageElem.textContent = 'No tasks found. Add a task above to get started!';
        } else if (AppState.filter === 'active') {
          messageElem.textContent = 'No active tasks found. Great job!';
        } else if (AppState.filter === 'completed') {
          messageElem.textContent = 'No completed tasks yet. Finish a task to see it here!';
        } else {
          messageElem.textContent = 'No tasks found to display.';
        }
      }
    }
  } else {
    if (DOM.emptyState) {
      DOM.emptyState.hidden = true;
    }

    // High performance batch render via DocumentFragment
    const fragment = document.createDocumentFragment();

    filteredTasks.forEach(task => {
      const isEditing = task.id === AppState.editingTaskId;
      const taskElem = createTaskElement(task, isEditing);
      fragment.appendChild(taskElem);
    });

    DOM.taskList.appendChild(fragment);

    // If an item is in edit mode, auto-focus and select its input
    if (AppState.editingTaskId) {
      const activeEditInput = DOM.taskList.querySelector('.task-edit-input');
      if (activeEditInput) {
        activeEditInput.focus();
        activeEditInput.select();
      }
    }
  }

  // Always update summary statistics from the authoritative state
  updateTaskStats();
}

/* ==========================================================================
   6. Event Handlers & Delegated Interaction Architecture
   ========================================================================== */

/**
 * Handles creation form submissions
 * @param {SubmitEvent} e - Form submission event
 */
function handleTaskFormSubmit(e) {
  e.preventDefault();
  if (!DOM.taskInput) return;

  const rawTitle = DOM.taskInput.value;
  const rawPriority = DOM.taskPriority ? DOM.taskPriority.value : 'medium';
  const rawDueDate = DOM.taskDueDate ? DOM.taskDueDate.value : null;

  const created = createTask(rawTitle, rawPriority, rawDueDate);

  if (created) {
    DOM.taskInput.value = '';
    if (DOM.taskPriority) DOM.taskPriority.value = 'medium';
    if (DOM.taskDueDate) DOM.taskDueDate.value = '';
    DOM.taskInput.focus();
  } else {
    DOM.taskInput.focus();
  }
}

/**
 * Handles clicks inside the task list using robust event delegation
 * Verifies containment within DOM.taskList and resolves through nested elements via closest()
 * @param {MouseEvent} e - Click event
 */
function handleTaskListClick(e) {
  if (!DOM.taskList || !DOM.taskList.contains(e.target)) return;

  const actionTarget = e.target.closest('[data-action]');
  if (!actionTarget || !DOM.taskList.contains(actionTarget)) return;

  const action = actionTarget.dataset.action;
  const taskId = actionTarget.dataset.taskId || actionTarget.closest('.task-item')?.dataset.taskId;

  if (action === 'toggle') {
    // Handled by change event on checkboxes to guarantee keyboard accessibility
    return;
  }

  if (action === 'edit' && taskId) {
    e.preventDefault();
    e.stopPropagation();
    startTaskEdit(taskId);
  } else if (action === 'save' && taskId) {
    e.preventDefault();
    e.stopPropagation();
    const editForm = actionTarget.closest('.task-edit-form');
    const input = editForm ? editForm.querySelector('.task-edit-input') : null;
    const prioritySelect = editForm ? editForm.querySelector('.task-edit-priority') : null;
    const dueDateInput = editForm ? editForm.querySelector('.task-edit-due-date') : null;
    if (input) {
      const priorityVal = prioritySelect ? prioritySelect.value : undefined;
      const dueDateVal = dueDateInput ? dueDateInput.value : undefined;
      const success = saveTaskEdit(taskId, input.value, priorityVal, dueDateVal);
      if (!success) {
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
    }
  } else if (action === 'delete' && taskId) {
    e.preventDefault();
    e.stopPropagation();
    deleteTask(taskId);
  } else if (action === 'cancel') {
    e.preventDefault();
    e.stopPropagation();
    cancelTaskEdit();
  }
}

/**
 * Handles checkbox toggle change events via event delegation on DOM.taskList
 * @param {Event} e - Change event
 */
function handleTaskListChange(e) {
  if (!DOM.taskList || !DOM.taskList.contains(e.target)) return;

  const checkbox = e.target.closest('.task-checkbox');
  if (!checkbox || !DOM.taskList.contains(checkbox)) return;

  const taskId = checkbox.dataset.taskId || checkbox.closest('.task-item')?.dataset.taskId;
  if (taskId) {
    toggleTaskStatus(taskId);
  }
}

/**
 * Handles submission of inline task edit forms via event delegation on DOM.taskList
 * @param {SubmitEvent} e - Submit event
 */
function handleTaskListSubmit(e) {
  if (!DOM.taskList || !DOM.taskList.contains(e.target)) return;

  const editForm = e.target.closest('.task-edit-form');
  if (!editForm || !DOM.taskList.contains(editForm)) return;

  e.preventDefault();
  const taskId = editForm.dataset.taskId || editForm.closest('.task-item')?.dataset.taskId;
  const input = editForm.querySelector('.task-edit-input');
  const prioritySelect = editForm.querySelector('.task-edit-priority');
  const dueDateInput = editForm.querySelector('.task-edit-due-date');
  if (!input || !taskId) return;

  const priorityVal = prioritySelect ? prioritySelect.value : undefined;
  const dueDateVal = dueDateInput ? dueDateInput.value : undefined;
  const success = saveTaskEdit(taskId, input.value, priorityVal, dueDateVal);
  if (!success) {
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}

/**
 * Handles keyboard events on the task list (e.g. Escape to cancel editing)
 * @param {KeyboardEvent} e - Keydown event
 */
function handleTaskListKeydown(e) {
  if (!DOM.taskList || !DOM.taskList.contains(e.target)) return;

  if (e.key === 'Escape') {
    const editForm = e.target.closest('.task-edit-form');
    if (editForm && DOM.taskList.contains(editForm)) {
      e.preventDefault();
      cancelTaskEdit();
    }
  }
}

/**
 * Handles input typing inside task items (clears invalid styling)
 * @param {Event} e - Input event
 */
function handleTaskListInput(e) {
  if (!DOM.taskList || !DOM.taskList.contains(e.target)) return;

  const editInput = e.target.closest('.task-edit-input');
  if (editInput && (editInput.classList.contains('is-invalid') || editInput.getAttribute('aria-invalid'))) {
    editInput.classList.remove('is-invalid');
    editInput.removeAttribute('aria-invalid');
  }
}

/**
 * Handles delegated clicks on the filter button group
 * @param {MouseEvent} e - Click event
 */
function handleFilterGroupClick(e) {
  if (!DOM.filterGroup || !DOM.filterGroup.contains(e.target)) return;

  const filterBtn = e.target.closest('.filter-btn');
  if (!filterBtn || !DOM.filterGroup.contains(filterBtn)) return;

  const filterName = filterBtn.dataset.filter;
  if (filterName) {
    setFilter(filterName);
  }
}

/* ==========================================================================
   7. Application Lifecycle Initialization
   ========================================================================== */

/**
 * Initializes the TaskFlow application:
 * - Caches DOM nodes
 * - Restores validated tasks from localStorage
 * - Sets default filter to 'all'
 * - Binds delegated event listeners on stable parent containers
 * - Renders initial state
 */
function initApp() {
  // Cache DOM references
  DOM.storageAlert = document.getElementById('storage-alert');
  DOM.taskForm = document.getElementById('task-form');
  DOM.taskInput = document.getElementById('task-input');
  DOM.taskPriority = document.getElementById('task-priority');
  DOM.taskDueDate = document.getElementById('task-due-date');
  DOM.inputError = document.getElementById('input-error');

  DOM.totalTasksCount = document.getElementById('total-tasks-count');
  DOM.activeTasksCount = document.getElementById('active-tasks-count');
  DOM.completedTasksCount = document.getElementById('completed-tasks-count');

  // Progress indicator references
  DOM.progressText = document.getElementById('progress-text');
  DOM.progressPercent = document.getElementById('progress-percent');
  DOM.progressBar = document.getElementById('progress-bar');
  DOM.progressBarFill = document.getElementById('progress-bar-fill');

  DOM.filterGroup = document.querySelector('.filter-group');
  DOM.filterButtons = document.querySelectorAll('.filter-btn');

  DOM.taskSearch = document.getElementById('task-search');
  DOM.searchClearBtn = document.getElementById('search-clear-btn');
  DOM.sortSelect = document.getElementById('sort-select');

  // Undo delete notification references
  DOM.undoToast = document.getElementById('undo-toast');
  DOM.undoMessage = document.getElementById('undo-message');
  DOM.undoBtn = document.getElementById('undo-btn');
  DOM.undoDismissBtn = document.getElementById('undo-dismiss-btn');

  // Backup & Data management references
  DOM.exportBtn = document.getElementById('export-tasks-btn');
  DOM.importModeSelect = document.getElementById('import-mode-select');
  DOM.importFileInput = document.getElementById('import-file-input');
  DOM.importFileLabel = document.getElementById('import-file-label');
  DOM.backupAlert = document.getElementById('backup-alert');

  DOM.taskList = document.getElementById('task-list');
  DOM.emptyState = document.getElementById('empty-state');
  DOM.statusAnnouncer = document.getElementById('status-announcer');

  // 1. Restore state from localStorage
  AppState.tasks = loadTasks();
  AppState.filter = 'all';
  AppState.searchQuery = '';
  AppState.sortBy = 'newest';
  AppState.editingTaskId = null;
  AppState.undoStack = [];

  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }

  // 2. Bind Form Listeners
  if (DOM.taskForm) {
    DOM.taskForm.addEventListener('submit', handleTaskFormSubmit);
  }

  if (DOM.taskInput) {
    // Clear validation error dynamically as user types
    DOM.taskInput.addEventListener('input', () => {
      if (DOM.inputError && !DOM.inputError.hidden) {
        clearInputError();
      }
    });
  }

  // 3. Bind Delegated Listener on Filter Group Container
  if (DOM.filterGroup) {
    DOM.filterGroup.addEventListener('click', handleFilterGroupClick);
  }

  // 4. Bind Search and Sort Controls Listeners
  if (DOM.taskSearch) {
    DOM.taskSearch.addEventListener('input', (e) => {
      AppState.searchQuery = e.target.value;
      if (DOM.searchClearBtn) {
        DOM.searchClearBtn.hidden = !e.target.value.trim();
      }
      render();
    });

    DOM.taskSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && DOM.taskSearch.value) {
        e.preventDefault();
        DOM.taskSearch.value = '';
        AppState.searchQuery = '';
        if (DOM.searchClearBtn) DOM.searchClearBtn.hidden = true;
        render();
      }
    });
  }

  if (DOM.searchClearBtn) {
    DOM.searchClearBtn.addEventListener('click', () => {
      if (DOM.taskSearch) {
        DOM.taskSearch.value = '';
        DOM.taskSearch.focus();
      }
      AppState.searchQuery = '';
      DOM.searchClearBtn.hidden = true;
      render();
    });
  }

  if (DOM.sortSelect) {
    DOM.sortSelect.addEventListener('change', (e) => {
      setSortBy(e.target.value);
    });
  }

  // 5. Bind Undo Notification Action Listeners
  if (DOM.undoBtn) {
    DOM.undoBtn.addEventListener('click', () => {
      undoDelete();
    });
  }

  if (DOM.undoDismissBtn) {
    DOM.undoDismissBtn.addEventListener('click', () => {
      handleUndoDismiss();
    });
  }

  // 6. Bind Backup & Data Action Listeners (Export & Import)
  if (DOM.exportBtn) {
    DOM.exportBtn.addEventListener('click', () => {
      handleExportTasks();
    });
  }

  if (DOM.importFileInput) {
    DOM.importFileInput.addEventListener('change', handleImportChange);
  }

  if (DOM.importFileLabel) {
    DOM.importFileLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (DOM.importFileInput) DOM.importFileInput.click();
      }
    });
  }

  // 7. Bind Delegated Event Handlers on Stable Task List Container
  if (DOM.taskList) {
    DOM.taskList.addEventListener('click', handleTaskListClick);
    DOM.taskList.addEventListener('change', handleTaskListChange);
    DOM.taskList.addEventListener('submit', handleTaskListSubmit);
    DOM.taskList.addEventListener('keydown', handleTaskListKeydown);
    DOM.taskList.addEventListener('input', handleTaskListInput);
  }

  // 6. Initial render of restored tasks and statistics
  render();

  console.log(`TaskFlow: Advanced filtering & event delegation initialized. Loaded ${AppState.tasks.length} task(s).`);
}

// Lifecycle Bootstrapping
document.addEventListener('DOMContentLoaded', initApp);
