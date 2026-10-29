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
 * Task Data Model:
 * @typedef {Object} Task
 * @property {string} id - Collision-resistant unique identifier
 * @property {string} title - Non-empty trimmed string
 * @property {boolean} completed - Task completion boolean flag
 * @property {number} createdAt - Valid unix timestamp (milliseconds)
 */

/**
 * Single authoritative in-memory application state
 */
const AppState = {
  tasks: [],              // Authoritative in-memory tasks array (Single Source of Truth)
  filter: 'all',          // 'all' | 'active' | 'completed'
  editingTaskId: null,    // string | null
};

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
 * Retrieves the subset of tasks corresponding to the active filter without mutating state
 * @returns {Array<Task>} Filtered list of tasks
 */
function getFilteredTasks() {
  switch (AppState.filter) {
    case 'active':
      return AppState.tasks.filter(task => !task.completed);
    case 'completed':
      return AppState.tasks.filter(task => task.completed);
    case 'all':
    default:
      return AppState.tasks;
  }
}

/**
 * Recalculates and updates the task summary metrics in the DOM from authoritative state
 */
function updateTaskStats() {
  const total = AppState.tasks.length;
  const active = AppState.tasks.filter(task => !task.completed).length;
  const completed = AppState.tasks.filter(task => task.completed).length;

  if (DOM.totalTasksCount) DOM.totalTasksCount.textContent = String(total);
  if (DOM.activeTasksCount) DOM.activeTasksCount.textContent = String(active);
  if (DOM.completedTasksCount) DOM.completedTasksCount.textContent = String(completed);
}

/* ==========================================================================
   3. Persistent Storage Layer (window.localStorage)
   ========================================================================== */

/**
 * Validates and sanitizes an individual task candidate from untrusted storage
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

  return {
    id: item.id.trim(),
    title: trimmedTitle,
    completed: item.completed,
    createdAt: createdAt,
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
 * @returns {Task|null} Created task or null if invalid
 */
function createTask(rawTitle) {
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
  };

  // Add new tasks to the beginning of the authoritative array
  AppState.tasks.unshift(newTask);

  // Persist state change
  saveTasks();

  clearInputError();
  announceStatus(`Task "${trimmed}" added.`);
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
 * Saves changes to an existing task title, saves to storage, and re-renders
 * @param {string} taskId - Target task ID
 * @param {string} newTitle - New title string
 * @returns {boolean} Whether the update succeeded
 */
function saveTaskEdit(taskId, newTitle) {
  const task = AppState.tasks.find(t => t.id === taskId);
  if (!task) return false;

  const trimmed = newTitle ? newTitle.trim() : '';
  if (!trimmed) {
    announceStatus('Task title cannot be empty.');
    return false;
  }

  const hasChanged = task.title !== trimmed;
  task.title = trimmed;
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
 * Deletes a single task, saves to storage, and re-renders
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

  announceStatus(`Task "${removedTask.title}" deleted.`);
  render();
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

  // Safe Text Container
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-text';
  titleSpan.textContent = task.title; // Safe textContent to prevent HTML/XSS injection

  mainRegion.appendChild(checkboxLabel);
  mainRegion.appendChild(titleSpan);

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
        if (AppState.tasks.length === 0) {
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
  const created = createTask(rawTitle);

  if (created) {
    DOM.taskInput.value = '';
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
    if (input) {
      const success = saveTaskEdit(taskId, input.value);
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
  if (!input || !taskId) return;

  const success = saveTaskEdit(taskId, input.value);
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
  DOM.inputError = document.getElementById('input-error');

  DOM.totalTasksCount = document.getElementById('total-tasks-count');
  DOM.activeTasksCount = document.getElementById('active-tasks-count');
  DOM.completedTasksCount = document.getElementById('completed-tasks-count');

  DOM.filterGroup = document.querySelector('.filter-group');
  DOM.filterButtons = document.querySelectorAll('.filter-btn');

  DOM.taskList = document.getElementById('task-list');
  DOM.emptyState = document.getElementById('empty-state');
  DOM.statusAnnouncer = document.getElementById('status-announcer');

  // 1. Restore state from localStorage
  AppState.tasks = loadTasks();
  AppState.filter = 'all';
  AppState.editingTaskId = null;

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

  // 4. Bind Delegated Event Handlers on Stable Task List Container
  if (DOM.taskList) {
    DOM.taskList.addEventListener('click', handleTaskListClick);
    DOM.taskList.addEventListener('change', handleTaskListChange);
    DOM.taskList.addEventListener('submit', handleTaskListSubmit);
    DOM.taskList.addEventListener('keydown', handleTaskListKeydown);
    DOM.taskList.addEventListener('input', handleTaskListInput);
  }

  // 5. Initial render of restored tasks and statistics
  render();

  console.log(`TaskFlow: Advanced filtering & event delegation initialized. Loaded ${AppState.tasks.length} task(s).`);
}

// Lifecycle Bootstrapping
document.addEventListener('DOMContentLoaded', initApp);
