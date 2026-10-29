# TaskFlow — Smart To-Do List

A modern, responsive, and accessible client-side task management application built with vanilla JavaScript, HTML5, CSS3, and an interactive **Three.js 3D Floating Productivity Workspace**. Designed as a production-grade project demonstrating fundamental frontend engineering concepts including state management, event delegation, DOM manipulation, local storage persistence, and WebGL graphics integration without external frontend frameworks.

---

## Project Overview

TaskFlow is a lightweight, zero-dependency task manager that helps users organize their daily tasks efficiently. The application maintains an authoritative in-memory application state synchronized with the browser's `localStorage`, providing instant feedback, reliable data retention across browser sessions, and an intuitive user interface set against a cinematic 3D productivity workspace.

---

## Features

- **Full Task Lifecycle (CRUD):**
  - **Create:** Add tasks with whitespace trimming and inline error validation.
  - **Read:** Safe dynamic rendering using `document.createElement()` and `textContent` to eliminate XSS vulnerabilities.
  - **Update:** Inline editing with Enter-to-save and Escape-to-cancel keyboard shortcuts.
  - **Delete:** Individual task deletion with real-time UI and state updates.
- **State & Status Toggling:** Native checkbox controls to toggle between active and completed with accessible screen-reader live announcements.
- **Advanced Filtering:** View all tasks, only active tasks, or only completed tasks without mutating authoritative state.
- **Dynamic Metrics:** Live calculation of Total, Active, and Completed task counts updated with every action.
- **Persistence & Resilience:** Real-time persistence via browser `localStorage` under `taskflow_tasks` with automated schema validation, duplicate ID resolution, and corrupted data recovery.
- **Floating 3D Productivity Workspace:**
  - Real-time Three.js 3D background faithfully recreating the reference productivity workspace.
  - Desk with tapered cylindrical legs, ceramic coffee mug with curved handle, sleek laptop with angled screen and keyboard, and modern ergonomic chair.
  - Holographic desk emitter pad radiating upward luminous curved projection light beams.
  - 4 floating holographic productivity panels with custom textures:
    1. **AI TO-DO LIST** (checkboxes, checkmarks, task lines, glowing cyan border)
    2. **DAILY SCHEDULE** (header pill, time blocks, event lines)
    3. **NOTES** (heading, horizontal content lines)
    4. **TOP PRIORITIES** (heading, circular bullet indicators)
  - Rising ambient cyan particles.
  - Clamped pointer parallax with smooth lerp easing.
  - Complete non-blocking pointer events (`pointer-events: none`).
  - Automatic `prefers-reduced-motion` detection (renders static 3D composition).
  - Page visibility throttling (pauses `requestAnimationFrame` when tab is hidden).
  - Resilient static visual fallback when WebGL is unavailable.
- **Accessibility & UX:** Semantic HTML5 landmarks, ARIA attributes (`aria-pressed`, `aria-live`, `aria-invalid`, `aria-describedby`), full keyboard navigation support, and responsive glassmorphic layout.
- **Optimized Performance:** Efficient event delegation on parent containers rather than individual element bindings.

---

## Technologies

- **HTML5:** Semantic structure (`<header>`, `<main>`, `<section>`, `<aside>`, `<footer>`), accessible landmarks, and form elements.
- **CSS3:** Custom Properties (design tokens), Flexbox layout, glassmorphic backdrop filters, system font stack, high-contrast focus rings, and media queries (320px to 1440px).
- **Vanilla JavaScript (ES6+):** Strict mode (`'use strict'`), Document Object Model (DOM) APIs, event delegation, DocumentFragment batching, and Web Storage API (`window.localStorage`).
- **Three.js (WebGL):** Pinned version (0.160.0) bundled locally for 100% offline availability, zero CDN latency, and deterministic execution.
- **Dependencies:** Zero external runtime packages or build steps.

---

## How to Run the Application

Because TaskFlow is a pure client-side application, running it requires no build step, compiler, bundler, or package installations.

### Option 1: Direct File Opening (Any Modern Browser)
Double-click `index.html` or open it directly in Google Chrome, Mozilla Firefox, Microsoft Edge, or Apple Safari:
```powershell
# On Windows PowerShell
Start-Process "D:\TaskFlow — Smart To-Do List\index.html"
```

### Option 2: Local Static Server (Recommended)
If you have a local HTTP server utility (such as Python, Node `http-server`, or VS Code Live Server):

```bash
# Using Python 3
python -m http.server 8000
```
Then visit `http://localhost:8000` in your web browser.

---

## How to Run the Automated Test Suite

TaskFlow includes an in-project automated test suite covering all functional, architectural, and edge-case requirements:

```bash
node tests.js
```
The test suite runs in pure Node.js without requiring `npm install` or third-party packages.

---

## Project File Structure

```text
D:\TaskFlow — Smart To-Do List\
├── assets\
│   └── workspace-bg.webp        # High-fidelity static visual fallback artwork
├── css\
│   └── three-background.css     # 3D canvas viewport, glassmorphic styling & fallback rules
├── js\
│   ├── three-background.js      # Three.js scene, geometry, panels, lighting & animation controller
│   └── vendor\
│       └── three.min.js         # Pinned Three.js 0.160.0 library (offline & local)
├── index.html                   # Semantic HTML5 scaffolding, form controls, stats, filters, live regions
├── style.css                    # CSS3 design tokens, responsive layout, states, and accessibility styles
├── script.js                    # Core JavaScript application logic, state manager, storage & delegated handlers
├── tests.js                     # In-project automated test runner (16 comprehensive tests)
└── README.md                    # Technical documentation, architectural deep-dives & compliance audit
```

---

## 3D Productivity Workspace Architecture

The 3D background is implemented as an independent, decoupled graphics layer in [`js/three-background.js`](file:///D:/TaskFlow%20—%20Smart%20To-Do%20List/js/three-background.js) and styled via [`css/three-background.css`](file:///D:/TaskFlow%20—%20Smart%20To-Do%20List/css/three-background.css).

### 1. Scene Composition & Reference Reproduction
- **Desk & Furniture:** A beveled pale cyan-blue desk (`color: 0xcde7f7`) supported by 4 tapered cylindrical legs, a pale cyan ceramic mug with handle on the left, a sleek dark slate laptop with keyboard texture and tilted display screen on the right, and an ergonomic modern chair in the foreground right.
- **Holographic Emitter & Projection Rays:** A rounded rectangular pad resting on the desk with an emissive cyan surface and 4 curved luminous tubes (`THREE.TubeGeometry` with `THREE.QuadraticBezierCurve3` and `THREE.AdditiveBlending`) arching up toward each floating panel.
- **Four Floating Holographic Panels:**
  - **AI TO-DO LIST:** Large bold "AI" title, "TO-DO LIST" subtitle, 3 task rows with rounded checkboxes, checkmarks, and horizontal task bars.
  - **DAILY SCHEDULE:** Rounded header pill, "DAILY SCHEDULE" title, 3 schedule rows with time blocks and event lines, plus a summary bar.
  - **NOTES:** "NOTES" title with 4 horizontal content lines.
  - **TOP PRIORITIES:** "TOP PRIORITIES" title with 3 circular bullet indicators and priority lines.
  - Each panel is dynamically textured using high-DPI HTML5 2D Canvas rendering with glowing cyan borders and soft aura planes.
- **Ambient Particles:** 65 drifting cyan particles that float upward from the desk pad with gentle sway and reset upon reaching the top boundary.

### 2. Interaction & Animation System
- **Frame-Rate Independent Animation:** Delta-time driven sine-wave oscillations for panel floating and subtle yaw rotation.
- **Clamped Pointer Parallax:** Mouse movements update normalized target coordinates `[-0.6, 0.6]` with smooth lerp easing (`camera.position.x += (targetX - camera.position.x) * 0.04`), preventing excessive camera swings or disorientation.
- **Tab Visibility Throttling:** Listens to `document.visibilitychange` to pause `requestAnimationFrame` when the tab is hidden, conserving battery and GPU resources.
- **Reduced Motion Support:** Respects `prefers-reduced-motion: reduce`. When enabled, animations and pointer parallax stop immediately, rendering a clean, static 3D composition.
- **Resilient WebGL Fallback:** If WebGL is unavailable or Three.js fails, `.fallback-active` activates, displaying the reference artwork as a static CSS background.
- **Pointer-Events Pass-Through:** The 3D container and canvas have `pointer-events: none` and `z-index: -1`, guaranteeing zero interference with clicks, touches, or form controls.

---

## How Local Storage Works

TaskFlow implements client-side persistence using the Web Storage API (`window.localStorage`) under the dedicated storage key:
```javascript
const STORAGE_KEY = 'taskflow_tasks';
```

### 1. Persistence Workflow
- **Save Operations (`saveTasks`):** Whenever a task is created, toggled, edited, or deleted, the authoritative `AppState.tasks` array is serialized to a JSON string using `JSON.stringify()` and written to `window.localStorage.setItem(STORAGE_KEY, serialized)`.
- **Load Operations (`loadTasks`):** During initialization (`initApp`), TaskFlow retrieves the stored string via `window.localStorage.getItem(STORAGE_KEY)`.

### 2. Defensive Deserialization & Schema Validation
Stored data in the browser cannot be trusted to match the expected schema. TaskFlow applies strict defensive validation (`validateAndSanitizeTask`):
- **`id`:** Must be a non-empty string.
- **`title`:** Must be a non-empty string after trimming whitespace.
- **`completed`:** Must be strictly of type `boolean`.
- **`createdAt`:** Must be a valid positive numeric timestamp; defaults to `Date.now()` if malformed.

### 3. Collision Resistance & Duplicate ID Resolution
In the event that stored data contains duplicate identifiers, `loadTasks` tracks IDs using a `Set`. Any duplicated ID is automatically regenerated with a collision-resistant UUID (`crypto.randomUUID()` or fallback generator), ensuring DOM element keys and state references remain unique.

### 4. Robust Focus Restoration (`restoreTaskFocus`)
When inline editing concludes (via save or cancel), `restoreTaskFocus(taskId)` returns keyboard focus to the task's Edit button (`.btn-edit`). It safely resolves the element using `CSS.escape(taskId)` with a direct `dataset.taskId` attribute traversal fallback, completely preventing CSS selector injection exceptions on unusual stored IDs.

### 5. Corruption Recovery & Error Handling
- **Malformed JSON:** If `JSON.parse()` fails (e.g., corrupted syntax), the error is caught, an accessible alert banner (`#storage-alert`) notifies the user, and the application initializes with an empty list. **Raw storage is preserved** rather than wiped, preventing accidental permanent data loss.
- **Partial Record Corruption:** If an array in storage contains a mix of valid and invalid items, invalid items are discarded while all valid records are successfully restored with a user-facing warning.
- **Storage Quota Exceeded:** `saveTasks()` intercepts browser quota errors (`QuotaExceededError` / code 22 / 1014) and surfaces an alert informing the user that latest changes could not be persisted.
- **Storage Disabled / Private Browsing:** If `localStorage` access is restricted, TaskFlow catches the security error and falls back gracefully to in-memory state.

---

## How Filtering Works

Filtering in TaskFlow is designed around a single-source-of-truth architecture with non-mutating projections.

### 1. Authoritative State vs. View Projection
- The global `AppState.tasks` array contains **all tasks** at all times.
- The `AppState.filter` property records the current filter mode: `'all'`, `'active'`, or `'completed'`.
- Switching filters calls `setFilter(filterName)` which sets `AppState.filter` and re-renders via `getFilteredTasks()`.
- **The authoritative `AppState.tasks` array is NEVER filtered, mutated, or truncated.**

### 2. Statistics Independence
Task metrics (Total Tasks, Active Tasks, Completed Tasks) are computed directly from `AppState.tasks`:
```javascript
function updateTaskStats() {
  const total = AppState.tasks.length;
  const active = AppState.tasks.filter(task => !task.completed).length;
  const completed = AppState.tasks.filter(task => task.completed).length;
}
```
This guarantees that counters always reflect the true global state, regardless of which filter is currently active in the view.

### 3. State Consistency During Operations
When a user adds, completes, edits, or deletes a task while a filter is active:
1. The mutation is applied directly to `AppState.tasks`.
2. The state is serialized and persisted to `localStorage`.
3. The view is re-rendered through `getFilteredTasks()`.
4. If a task in the **Active** view is marked complete, it immediately and cleanly leaves the visible list, and the completed counter increments.
5. If a task in the **Completed** view is marked active, it immediately transitions out of the completed view, and the active counter increments.

### 4. Contextual Empty States
When no tasks match the active filter, TaskFlow displays an intuitive, filter-specific empty state message:
- **All:** *"No tasks found. Add a task above to get started!"*
- **Active:** *"No active tasks found. Great job!"*
- **Completed:** *"No completed tasks yet. Finish a task to see it here!"*

---

## How Event Delegation Works

To optimize memory usage, avoid duplicate listeners, and ensure seamless interaction with dynamically created DOM elements, TaskFlow relies entirely on **event delegation**.

### 1. Container-Level Event Listeners
Rather than attaching listeners to each individual task item, button, or checkbox, event listeners are registered **once** on stable container elements during application initialization (`initApp`):
- **Task List Container (`#task-list`):**
  - `click`: Handles edit, save (`data-action="save"`), delete, and cancel action buttons.
  - `change`: Handles completion checkbox state transitions.
  - `submit`: Handles inline edit form submissions.
  - `keydown`: Captures the `Escape` key within `.task-edit-form` to cancel inline editing.
  - `input`: Clears inline edit validation errors (`.is-invalid` and `aria-invalid`) as the user types.
- **Filter Navigation (`.filter-group`):**
  - `click`: Handles filter button selection.

### 2. Target Resolution via `Element.closest()`
Dynamically rendered buttons contain child elements (such as `<span class="btn-text">Edit</span>`). Using `e.target` directly could return the internal `<span>` rather than the `<button>`. TaskFlow resolves this using `Element.closest()`:
```javascript
const actionTarget = e.target.closest('[data-action]');
if (!actionTarget || !DOM.taskList.contains(actionTarget)) return;

const action = actionTarget.dataset.action;
const taskId = actionTarget.dataset.taskId || actionTarget.closest('.task-item')?.dataset.taskId;
```

---

## Requirements Compliance Checklist

| # | Requirement | Status | Implementation Details |
|---|---|---|---|
| 1 | **Create Task** | **Compliant** | Trims input, rejects empty/whitespace titles, generates collision-resistant ID, prepends to `AppState.tasks`, saves, and updates UI. |
| 2 | **Read & Display Tasks** | **Compliant** | Dynamic rendering using `document.createElement()` and `textContent`. Safe against XSS injection. |
| 3 | **Update / Edit Task** | **Compliant** | Inline edit form with auto-focus, Enter to save, Escape or Cancel to abort without mutating data. |
| 4 | **Delete Task** | **Compliant** | Splices task from `AppState.tasks`, clears active edit mode if needed, saves, and updates UI. |
| 5 | **Toggle Complete / Active** | **Compliant** | Native checkbox bound via delegated `change` event; toggles boolean flag, persists, and updates stats. |
| 6 | **Filter: All Tasks** | **Compliant** | Displays all tasks in authoritative state; default view. |
| 7 | **Filter: Active Tasks** | **Compliant** | Projections showing only `completed === false`; completed items leave view instantly. |
| 8 | **Filter: Completed Tasks** | **Compliant** | Projections showing only `completed === true`; reactivated items leave view instantly. |
| 9 | **Storage Persistence** | **Compliant** | Stores JSON under `'taskflow_tasks'` key in `localStorage` with quota and access handling. |
| 10 | **State Restoration** | **Compliant** | Automatically loads and validates tasks on `DOMContentLoaded`. Preserves data across reloads. |
| 11 | **Dynamic DOM Generation** | **Compliant** | High-performance batch DOM creation using `DocumentFragment` and zero innerHTML injection. |
| 12 | **Event Delegation** | **Compliant** | Single listeners on `#task-list` and `.filter-group` handling click, change, submit, keydown, and input. |
| 13 | **State Consistency** | **Compliant** | Single source of truth; stats and storage reflect global state regardless of active filter. |
| 14 | **Input & Schema Validation** | **Compliant** | Rejects empty titles; sanitizes untrusted storage items; generates unique IDs for duplicate keys. |
| 15 | **Responsive Layout** | **Compliant** | Full-screen transparent glassmorphic dashboard on desktop (up to 1380px) with 2-column productivity workspace; single-column clean layout on tablet and mobile (320px, 375px, 768px, 1024px, 1440px) with zero horizontal overflow. |
| 16 | **Accessibility & Focus** | **Compliant** | High-contrast focus rings, ARIA live region status announcer, form labels, and focus restoration. |
| 17 | **3D Workspace Environment** | **Compliant** | Real-time Three.js scene faithfully recreating the reference productivity workspace with floating holographic panels, particles, parallax, and non-blocking pointer events. |
| 18 | **Reference Visual Design Language** | **Compliant** | Complete blue glassmorphism theme, rounded translucent panels, checkmark branding logo, summary metric cards with icons, segmented pill filters, and accessible high-contrast text tokens. |

---

## Test Verification Summary

### 1. In-Project Automated Test Suite (`node tests.js`)
- **Total Tests Executed:** 16
- **Tests Passed:** 16 (100%)
- **Tests Failed:** 0
- **Verified Areas:** Task creation, empty-input rejection, inline editing, edit cancellation, deletion, completion toggling, filtering (All, Active, Completed), statistics accuracy, localStorage serialization/restoration, malformed JSON recovery, invalid stored record sanitization, duplicate ID resolution, XSS defense, event delegation through nested elements, keyboard shortcuts, and special characters in stored task IDs.

### 2. Live Headless Google Chrome Runtime & CDP Verification
- Real Google Chrome browser automation executed via Chrome DevTools Protocol (CDP):
  - Three.js 0.160.0 loaded and WebGL initialized.
  - 3D `<canvas>` successfully created inside `#three-bg-container`.
  - Verified `pointer-events: none` on 3D container and canvas.
  - Executed actual DOM interactions (Task creation, completion toggling, filtering, deletion) with 100% success.
  - Responsive layout verified across viewports (320px, 375px, 768px, 1024px, 1440px) with 0 horizontal overflow.
  - Full-resolution visual rendering screenshot captured (`scratch/rendered_3d_workspace.png`).
  - Browser console audit verified **0 console errors** during full runtime execution.

---

## Known Limitations & Disclosures

1. **Origin Scoping:**
   `window.localStorage` is strictly partitioned by origin (protocol, domain, and port). Data entered when opening `index.html` via `file:///` is not shared if later served over `http://localhost:8000`.
2. **Storage Quota:**
   Browsers typically allocate ~5MB of storage for `localStorage` per origin. While sufficient for tens of thousands of tasks, extensive use will trigger the graceful `QuotaExceededError` warning banner.
3. **Hardware Acceleration:**
   The 3D environment utilizes WebGL via Three.js. On devices where hardware WebGL is unavailable or disabled, the application automatically displays the high-fidelity static visual fallback artwork without interrupting task management functionality.
