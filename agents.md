# Implementation Agents

This document defines the implementation tasks for the Speaker Notes web app. Each agent is a self-contained work unit that can be executed by an AI coding agent or a developer. Agents are ordered by dependency — later agents depend on earlier ones being complete.

## Global Rules

- **Language:** Modern modular JavaScript (ES modules, `import`/`export`). No TypeScript, no JSX, no build step.
- **Dependencies:** Zero npm dependencies. Use only browser APIs (`fetch`, `localStorage`, `Web Audio API`, DOM).
- **File structure:** Follow the layout in `docs/architecture.md`. All JS files go in `js/`, CSS in `css/`, single `index.html` at root.
- **Code style:** Classes with JSDoc type annotations. Use `const`/`let` (never `var`). Use `async`/`await` for promises.
- **Specification:** The product spec is `speaker-notes.md`. The software design is in `docs/architecture.md` and `docs/components/*.md`. Each component's `.md` file defines its **purpose**, **responsibilities**, **interface** (constructor + public methods with types), and **dependencies**. Follow them exactly.
- **Testing:** Each agent should include a brief manual test procedure at the end. If a module is pure logic (no DOM), include a simple test script in `tests/` that can be run with `node --experimental-vm-modules` or in the browser console.
- **API base URL:** `https://liveresultat.orientering.se/api.php`
- **Times:** The API returns centiseconds when `unformattedTimes=true`. All internal time handling should use centiseconds; format to `HH:MM:SS` only at display time.
- **Data sanitization:** The API may return responses with control characters. Sanitize response bytes before JSON parsing (see `docs/components/api-client.md` Notes section).

---

## Agent 1: Scaffold — `index.html` + `css/styles.css`

### Goal
Create the HTML shell and all CSS for the application.

### Input
- `docs/architecture.md` (file structure)
- `docs/components/latest-events-panel.md` (DOM structure, CSS classes)
- `docs/components/predictions-panel.md` (DOM structure, CSS classes)
- `docs/components/connection-monitor.md` (DOM structure, CSS classes)
- `docs/components/setup-wizard.md` (DOM structure)
- `speaker-notes.md` (readability requirements: Full HD, 1 m+)

### Tasks
1. Create `index.html` with:
   - `<div id="app">` root container
   - `<script type="module" src="js/app.js">` entry point
   - `<link rel="stylesheet" href="css/styles.css">`
   - Semantic structure: `<header>` (with connection monitor), `<main>` (split into `<section id="latest-events">` upper and `<section id="predictions">` lower), setup wizard overlay `<div id="setup-wizard">`
   - `<meta name="viewport">` for responsive display
2. Create `css/styles.css` with:
   - CSS custom properties for colours, font sizes, spacing (easy theming)
   - Base font size ≥ 24px for readability at 1 m on Full HD (1920×1080)
   - Layout: flexbox column, upper panel ~60% height, lower panel ~40%
   - `.event-row` grid: 7 columns (time, class, runner, club, control, place, timeplus)
   - `.prediction-row` grid: 6 columns (predicted time, class, runner, club, control, confidence)
   - `.event-row--new` slide-in animation (`@keyframes slideIn`)
   - `.event-row--club` coloured left border
   - `.event-row--status` muted/strikethrough style
   - `.prediction-row--overdue` subtle warning highlight
   - `.prediction-row--removing` fade-out animation
   - `.conn-monitor` with dot colour classes (`--green`, `--yellow`, `--red`)
   - `.wizard` overlay (centered, max-width 600px, step visibility toggling)
   - `.panel__list` with `overflow-y: auto` for scroll
   - Dark theme by default (high contrast for readability)
   - Column header row (sticky) for both panels

### Output
- `index.html`
- `css/styles.css`

### Verification
Open `index.html` in a browser. The layout should render with both panels visible (empty), the connection monitor in the header, and the setup wizard overlay. No JS errors in console.

---

## Agent 2: SettingsManager — `js/settings-manager.js`

### Goal
Implement the settings persistence module.

### Input
- `docs/components/settings-manager.md`

### Tasks
1. Implement `SettingsManager` class exactly as specified in the interface
2. Default values: `compId: null`, `compName: null`, `followedClasses: null` (= all), `followedClubs: []`, `topN: 4`, `maxLatestEvents: 10`, `maxPredictions: 5`
3. `localStorage` key: `"speaker-notes-settings"`
4. `set()` writes to memory and immediately persists the full settings object to `localStorage`
5. `get()` reads from memory (loaded once on construction from `localStorage`)
6. `onChange()` returns an unsubscribe function. Callbacks fire synchronously on `set()`
7. `reset()` clears all to defaults and persists

### Output
- `js/settings-manager.js`

### Verification
In browser console:
```js
import SettingsManager from './js/settings-manager.js';
const s = new SettingsManager();
s.set('topN', 6);
console.assert(s.get('topN') === 6);
console.assert(JSON.parse(localStorage.getItem('speaker-notes-settings')).topN === 6);
s.reset();
console.assert(s.get('topN') === 4);
```

---

## Agent 3: ApiClient — `js/api-client.js`

### Goal
Implement the HTTP client for the liveresultat API.

### Input
- `docs/components/api-client.md`
- `speaker-notes.md` (API section: endpoints, hash caching, response formats)

### Tasks
1. Implement `ApiClient` class exactly as specified
2. **URL builder:** `${baseUrl}?method=...&comp=...&class=...&unformattedTimes=true&last_hash=...`
3. **Hash caching:** Internal `Map<string, string>` keyed by `"compId:className"` (and `"classes:compId"` for getClasses). Send `last_hash` query parameter on subsequent calls. Return `null` when response is `{ "status": "NOT MODIFIED" }`.
4. **Data sanitization:** Before JSON parsing, read the response as `ArrayBuffer`, convert to `Uint8Array`, replace control characters (`0x00–0x1F` except `0x09`, `0x0A`, `0x0D`) with `0x20`, then decode as UTF-8 and `JSON.parse`.
5. **Circuit breaker:** Track consecutive failure count. After 3 failures → state = `"open"`. After 30 seconds in open → `"half-open"` (allow one request). On success → `"closed"`, reset counter.
6. **Retry with backoff:** On fetch failure, retry up to 3 times with delays of 1s, 2s, 4s. Respect `AbortSignal`.
7. **`lastDataTimestamp`:** Updated on every successful response that contains data (not `NOT MODIFIED`).
8. **`getCompetitions()`:** No hash caching needed. Filter to today's date is NOT done here (caller's responsibility).
9. **`getClasses(compId)`:** Hash-cached.
10. **`getClassResults(compId, className, options)`:** Hash-cached, sends `unformattedTimes=true`.

### Output
- `js/api-client.js`

### Verification
In browser console:
```js
import ApiClient from './js/api-client.js';
const api = new ApiClient();
const comps = await api.getCompetitions();
console.log('Competitions:', comps.length);
// Pick any comp with data:
// const classes = await api.getClasses(comps[0].id);
// console.log('Classes:', classes);
```

---

## Agent 4: AudioNotifier — `js/audio-notifier.js`

### Goal
Implement the audio chime module.

### Input
- `docs/components/audio-notifier.md`

### Tasks
1. Implement `AudioNotifier` class exactly as specified
2. Create `AudioContext` lazily on first `chime()` call
3. Unlock `AudioContext` via a one-time `click`/`touchstart` handler on `document` that calls `ctx.resume()`
4. Chime: sine wave at 880 Hz (A5), 0.5 s duration, gain ramp from 0.3 → 0.001
5. Debounce: ignore `chime()` calls within 300 ms of the last chime
6. `toggleMute()` returns the new muted state. When muted, `chime()` is a no-op
7. `muted` getter

### Output
- `js/audio-notifier.js`

### Verification
Open `index.html`, click anywhere on the page, then in console:
```js
import AudioNotifier from './js/audio-notifier.js';
const a = new AudioNotifier();
a.chime(); // should hear a short tone
```

---

## Agent 5: RunnerStateStore — `js/runner-state-store.js`

### Goal
Implement the in-memory runner state store with change detection.

### Input
- `docs/components/runner-state-store.md`
- `speaker-notes.md` (runner status codes, split data format, API response structure)

### Tasks
1. Implement `RunnerStateStore` exactly as specified
2. **Runner key:** `"name|club"` to handle name collisions
3. **`updateClass(className, splitcontrols, results)`:**
   - Store the split controls for the class (ordered)
   - For each runner in `results`, parse the flat `splits` object into a structured `Map<controlCode, SplitState>`. The API uses keys like `"1065"` for split time, `"1065_status"`, `"1065_place"`, `"1065_timeplus"`.
   - Compare against the previous snapshot to detect changes:
     - **split:** a control's split time changed from empty/missing to a number → type `"split"`
     - **finish:** `status` changed to `0` and `result` populated → type `"finish"`
     - **status_change:** `status` changed to 1, 2, 3, 4, 5, or 11 → type `"status_change"`
     - **started:** `status` changed from 10 to 9 → type `"started"` (detected but may not generate a visible event)
   - Return an array of `RunnerChange` objects for all detected changes
   - Replace `previous` snapshot with `current`, then rebuild `current` from the new data
4. **`getTopN(className, topN)`:**
   - For each runner with at least one split (`status === 0` on that control) or a finish result:
     - If finished: rank by `result` (cumulative time in centiseconds)
     - If in progress: rank by the cumulative time at their most recent passed split
   - Return a `Set<string>` of the top N runner keys (lowest time = best)
   - Exclude runners with status 1 (DNS), 2 (DNF), 3 (MP), 4 (DSQ), 5 (OT), 11 (WO), 12 (moved up)
5. **`getRunners(className)`:** Return all RunnerState objects for that class
6. **`getRunner(className, runnerKey)`:** Single lookup
7. **`getSplitControls(className)`:** Return the ordered `SplitControl[]`
8. **`clearClass(className)`:** Remove all data for a class

### Output
- `js/runner-state-store.js`

### Verification
Create `tests/test-runner-state-store.html` that imports the module, feeds it the sample API response from `speaker-notes.md`, calls `updateClass` twice (initial + one split change), and logs the changeset and top-N result.

---

## Agent 6: EventDetector — `js/event-detector.js`

### Goal
Implement the business-rule filter that turns raw changesets into visible latest events.

### Input
- `docs/components/event-detector.md`
- `speaker-notes.md` (top-N definition, club-follow bypass, status change display rules)

### Tasks
1. Implement `EventDetector` exactly as specified
2. **`processChanges(changes)`:**
   - For each `RunnerChange`:
     - Check if the runner is in the top-N set (`store.getTopN(className, settings.topN)`)
     - Check if the runner's club is in `settings.followedClubs`
     - If **neither** → skip (do not create a `LatestEvent`)
     - If eligible → create a `LatestEvent` object with:
       - `id`: unique string (e.g., `"${Date.now()}-${runner}-${controlCode}"`)
       - `timestamp`: `Date.now()`
       - `className`, `runner`, `club` from the change
       - `type`: from the change (`"split"`, `"finish"`, `"status_change"`)
       - `controlName`: from the change
       - `place`: `splitPlace` or final place
       - `timeplus`: formatted time behind leader
       - `clubFollowed`: `true` if club is in `followedClubs`
       - `status`: runner status code (for `status_change` type)
   - Prepend new events to the internal list
   - Trim the list to `settings.maxLatestEvents`
   - Return only the newly added events (for chime triggering)
3. **Demotion rule:** If a runner was in the previous top-N but is no longer, their change is still emitted (the change that bumped them out). Track previous top-N per class internally.
4. **`getLatestEvents()`:** Return the full current list, newest first
5. **`clear()`:** Empty the list
6. **Time formatting helper:** Convert centiseconds to `HH:MM:SS` display strings. Convert centisecond timeplus to `+M:SS`. Export this as a utility or keep it internal.

### Output
- `js/event-detector.js`

### Verification
Create `tests/test-event-detector.html` — feed mock changes for both a top-N runner and clubbed runner, verify both appear; feed a change for a non-top-N, non-clubbed runner, verify it's filtered out.

---

## Agent 7: PredictionEngine — `js/prediction-engine.js`

### Goal
Implement the prediction calculation module.

### Input
- `docs/components/prediction-engine.md`
- `speaker-notes.md` (prediction formula, reference runner selection, 15-min expiry)

### Tasks
1. Implement `PredictionEngine` exactly as specified
2. **`updatePredictions(className)`:**
   - Get the top-N runner keys for the class
   - For each top-N runner:
     - Find the runner's **last passed control** (last split with `status === 0`)
     - Find the **next control** in the ordered split controls list (or finish)
     - If the runner has no splits yet → skip (can't predict)
     - Find the **reference runner**: the fastest runner in the class who has already passed the target control (by cumulative time to target)
     - If no reference runner exists → skip
     - Compute: `paceRatio = runnerSplitTimeToLastControl / refSplitTimeToLastControl`
     - Compute: `predictedSplitTime = runnerSplitTimeToLastControl + (refSplitToTarget - refSplitToLastControl) * paceRatio`
     - Convert to wall-clock: `predictedWallClockMs = competitionDayStart + runner.start + predictedSplitTime` (all in centiseconds, convert to ms)
     - Note: `runner.start` and split times are already cumulative from competition start-of-day in centiseconds
     - Compute predicted wall clock: the runner's start time + predicted split = centiseconds from midnight. Convert to today's wall clock.
     - Confidence: if only 1 split → `"± minutes"`. If 2+ splits → compute std dev of per-leg pace ratios, convert to a time range string like `"± 1 min"`, `"± 2 min"`.
   - Remove predictions for runners who have now passed their predicted control
   - Remove predictions older than 15 minutes
   - If a prediction already exists for the same runner+control, update it rather than duplicating
3. **`getPredictions()`:** Return all active predictions sorted by `predictedTimeMs` ascending, capped at `maxPredictions`
4. **Finish prediction:** When the next unvisited control is the last split control, also generate a finish prediction using the reference runner's finish time.
5. **`removePrediction(id)`** and **`clear()`** as specified

### Output
- `js/prediction-engine.js`

### Verification
Create `tests/test-prediction-engine.html` — feed a class with 2 runners (one ahead as reference, one behind with 1 split) and verify a prediction is generated with sensible predicted time.

---

## Agent 8: ConnectionMonitor — `js/connection-monitor.js`

### Goal
Implement the connection health indicator.

### Input
- `docs/components/connection-monitor.md`
- `speaker-notes.md` (green/yellow/red thresholds)

### Tasks
1. Implement `ConnectionMonitor` exactly as specified
2. On `start()`:
   - Start a `setInterval` at 1000 ms
   - On each tick:
     - Update the clock display with current time (`HH:MM:SS`)
     - Read `apiClient.lastDataTimestamp`
     - Compute `age = Date.now() - lastDataTimestamp`
     - Update the dot class: `--green` if age < 30 000, `--yellow` if age < 90 000, `--red` otherwise
     - Update the "Last data" text with formatted timestamp
3. On `destroy()`: clear the interval
4. Render into the passed `containerEl` by creating the DOM elements on construction

### Output
- `js/connection-monitor.js`

### Verification
Open the app, observe the clock ticking. Since no polling is active yet, the dot should be red (no data ever received). Manually set `apiClient._lastDataTimestamp = Date.now()` and observe it turn green.

---

## Agent 9: SetupWizard — `js/setup-wizard.js`

### Goal
Implement the setup wizard overlay.

### Input
- `docs/components/setup-wizard.md`
- `speaker-notes.md` (user workflow: competition → classes → clubs → top-N)

### Tasks
1. Implement `SetupWizard` exactly as specified
2. **Step 1 — Competition:**
   - Call `apiClient.getCompetitions()`
   - Filter to today's date (`new Date().toISOString().slice(0, 10)`)
   - Render each as a clickable list item showing name + organizer
   - On click → save `compId` and `compName` → advance to step 2
3. **Step 2 — Classes:**
   - Call `apiClient.getClasses(compId)`
   - Render checkboxes, all checked by default
   - "Select All / Deselect All" toggle
   - On "Next" → save `followedClasses` (null if all selected, else the selected list)
4. **Step 3 — Clubs:**
   - Free-text input + "Add" button
   - Added clubs shown as removable tags
   - List known clubs: scan the class results if available, or just let the user type
   - On "Next" → save `followedClubs`
5. **Step 4 — Top N:**
   - Number input, min 1, max 20, default from settings
   - On "Finish" → save `topN`, call `onComplete()`
6. **Navigation:** Back/Next buttons. Back goes to previous step. Steps are shown/hidden by toggling a class.
7. **Pre-fill:** If settings already exist (re-opening wizard), pre-fill the selections
8. `open(onComplete)` shows the overlay; `close()` hides it

### Output
- `js/setup-wizard.js`

### Verification
Open `index.html`. The wizard should appear. Select a competition (if today has one on liveresultat — otherwise test with any date's competitions by temporarily removing the date filter). Navigate through all steps and confirm settings are persisted in localStorage.

---

## Agent 10: LatestEventsPanel — `js/latest-events-panel.js`

### Goal
Implement the upper display panel for latest events.

### Input
- `docs/components/latest-events-panel.md`

### Tasks
1. Implement `LatestEventsPanel` exactly as specified
2. **`render(events)`:** Full re-render. Clear container, create a header row, then one `.event-row` per event.
3. **`update(newEvents, allEvents)`:**
   - For each new event: create a `.event-row` DOM node, add class `event-row--new`, prepend to the list
   - Remove the `event-row--new` class after the CSS animation ends (`animationend` event)
   - If `allEvents.length` exceeds the visible count, remove the oldest rows from the DOM
   - Auto-scroll: `containerEl.scrollTo({ top: 0, behavior: 'smooth' })` to show the newest at top
4. **Conditional classes:**
   - `event-row--club` if `event.clubFollowed === true`
   - `event-row--status` if `event.type === "status_change"`
5. **Column content:** Time (formatted `HH:MM:SS`), Class, Runner, Club, Control, Place, Time behind
6. **`clear()`:** Remove all rows

### Output
- `js/latest-events-panel.js`

### Verification
Import the module, call `render()` with mock event data, and verify the rows appear with correct styling. Add a new event via `update()` and verify the slide-in animation fires.

---

## Agent 11: PredictionsPanel — `js/predictions-panel.js`

### Goal
Implement the lower display panel for predictions.

### Input
- `docs/components/predictions-panel.md`

### Tasks
1. Implement `PredictionsPanel` exactly as specified
2. **`render(predictions)`:** Full re-render. Clear container, create a header row, then one `.prediction-row` per prediction.
   - If `prediction.predictedTimeMs < Date.now()` → add class `prediction-row--overdue`
3. **Column content:** Predicted time (`HH:MM:SS`), Class, Runner, Club, Target Control, Confidence
4. **`clear()`:** Remove all rows

### Output
- `js/predictions-panel.js`

### Verification
Import the module, call `render()` with mock prediction data, verify rows show correctly. Set one prediction time to the past and verify the overdue class is applied.

---

## Agent 12: PollingScheduler — `js/polling-scheduler.js`

### Goal
Implement the staggered polling loop.

### Input
- `docs/components/polling-scheduler.md`
- `speaker-notes.md` (15-s polling interval, stagger requests, circuit breaker, visibility API)

### Tasks
1. Implement `PollingScheduler` exactly as specified
2. **`start(onClassUpdate)`:**
   - Read `settings.compId` and `settings.followedClasses`
   - If `followedClasses` is `null`, fetch the class list first via `apiClient.getClasses()`
   - Compute delay between requests: `15000 / N` ms (where N = number of classes)
   - Use `setTimeout` chain (not `setInterval`) to fire requests sequentially with the computed delay
   - For each class:
     - If `apiClient.circuitState === "open"` → skip
     - Call `apiClient.getClassResults(compId, className)`
     - If result is not `null` → call `onClassUpdate(className, result)`
   - After all classes are polled, schedule the next cycle (so total cycle ≈ 15 s)
3. **Visibility:** Listen to `document.visibilitychange`. When hidden → pause (clear pending timeouts). When visible → resume immediately.
4. **`stop()`:** Clear all pending timeouts
5. **`refresh()`:** Stop the current cycle, re-read settings, restart

### Output
- `js/polling-scheduler.js`

### Verification
Start polling with a real competition ID. Observe network requests in DevTools, verify they are spaced evenly across ~15 s. Verify `onClassUpdate` callback fires.

---

## Agent 13: App Orchestrator — `js/app.js`

### Goal
Wire all modules together into the main application.

### Input
- `docs/components/app.md`
- All other `docs/components/*.md` for interfaces

### Tasks
1. Implement `App` exactly as specified
2. **`constructor(rootEl)`:** Instantiate all modules, passing dependencies as specified in each component's doc.
   - `const settings = new SettingsManager()`
   - `const apiClient = new ApiClient()`
   - `const store = new RunnerStateStore()`
   - `const detector = new EventDetector({ store, settings })`
   - `const predictor = new PredictionEngine({ store, settings })`
   - `const notifier = new AudioNotifier()`
   - `const latestPanel = new LatestEventsPanel(rootEl.querySelector('#latest-events .panel__list'))`
   - `const predictionsPanel = new PredictionsPanel(rootEl.querySelector('#predictions .panel__list'))`
   - `const monitor = new ConnectionMonitor(rootEl.querySelector('#connection-monitor'), apiClient)`
   - `const scheduler = new PollingScheduler({ apiClient, settings })`
   - `const wizard = new SetupWizard({ containerEl: rootEl.querySelector('#setup-wizard'), apiClient, settings })`
3. **`init()`:**
   - Call `monitor.start()`
   - If `settings.compId` is null → `wizard.open(onSetupComplete)`
   - Else → `startLive()`
4. **`startLive()`** (private):
   - `scheduler.start((className, results) => { ... })` with the callback that:
     1. `const changes = store.updateClass(className, results.splitcontrols, results.results)`
     2. `const newEvents = detector.processChanges(changes)`
     3. `predictor.updatePredictions(className)`
     4. `latestPanel.update(newEvents, detector.getLatestEvents())`
     5. `predictionsPanel.render(predictor.getPredictions())`
     6. `if (newEvents.length > 0) notifier.chime()`
5. **"Change settings" button:** Add a gear icon / button in the header. On click → `scheduler.stop()`, `wizard.open(onSetupComplete)`.
6. **`onSetupComplete()`** (private): Clear detector and predictor state, call `scheduler.refresh()`, re-enter `startLive()`.
7. **`destroy()`:** `scheduler.stop()`, `monitor.destroy()`
8. **Entry point at bottom of file:**
   ```js
   const app = new App(document.getElementById('app'));
   app.init();
   ```

### Output
- `js/app.js`

### Verification
Open `index.html` in a browser. The full flow should work:
1. Wizard appears → select competition, classes, clubs
2. Live view activates → events and predictions populate as data arrives
3. Connection monitor shows green when data flows
4. Audio chime plays on new events
5. Refresh the page → settings persist, live view resumes without wizard

---

## Agent 14: Integration Testing & Polish

### Goal
End-to-end testing, bug fixing, and visual polish.

### Input
- The complete implemented application
- `speaker-notes.md` (all requirements)

### Tasks
1. **End-to-end test with live data:**
   - Open the app, select a real competition (if available today), follow all classes
   - Verify latest events appear and animate in
   - Verify predictions appear and update
   - Verify the chime plays
   - Verify connection monitor works (disconnect WiFi → goes yellow → red; reconnect → green)
   - Verify page reload preserves state
2. **Edge cases:**
   - Competition with no classes → wizard should show a message
   - Class with no runners yet → no errors
   - Runner with status change (DNF, DSQ) → appears in latest events with correct styling
   - Club-followed runner outside top-N → still appears in latest events, does NOT appear in predictions
   - All predictions expired → predictions panel shows empty state
3. **Visual check:**
   - Display on a 1920×1080 screen — text readable at 1 m?
   - Font size, contrast, row spacing all adequate?
   - Animations smooth, not distracting?
   - Auto-scroll works without jumpiness?
4. **Performance:**
   - Following 20+ classes — are requests properly staggered?
   - No memory leaks in the event/prediction lists (old entries properly removed)?
   - No excessive DOM nodes building up?
5. **Fix any bugs** discovered during testing
6. **Add a small `README.md`** at root:
   - What the app does
   - How to run (just open `index.html` or serve with any static file server)
   - Browser requirements (modern browser with ES module support)

### Output
- Bug fixes across any files
- `README.md`

### Verification
Complete the full test checklist above with no failures.

---

## Dependency Graph

```
Agent 1  (Scaffold)
Agent 2  (SettingsManager)
Agent 3  (ApiClient)
Agent 4  (AudioNotifier)
   ↓
Agent 5  (RunnerStateStore)         — needs no other agents but tests use Agent 1
   ↓
Agent 6  (EventDetector)            — needs Agent 2, Agent 5
Agent 7  (PredictionEngine)         — needs Agent 2, Agent 5
   ↓
Agent 8  (ConnectionMonitor)        — needs Agent 3
Agent 9  (SetupWizard)              — needs Agent 2, Agent 3
Agent 10 (LatestEventsPanel)        — needs Agent 1
Agent 11 (PredictionsPanel)         — needs Agent 1
   ↓
Agent 12 (PollingScheduler)         — needs Agent 2, Agent 3
   ↓
Agent 13 (App Orchestrator)         — needs ALL above
   ↓
Agent 14 (Integration & Polish)     — needs ALL above
```

Agents 1–4 can be executed in parallel.
Agents 6, 7 can be executed in parallel (both depend on 5).
Agents 8, 9, 10, 11 can be executed in parallel.
Agent 12 depends on 2, 3.
Agent 13 depends on everything.
Agent 14 is final.
