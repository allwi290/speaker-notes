# App

## Purpose

Top-level orchestrator that bootstraps the application, wires all modules together, and manages the main lifecycle (setup → polling → rendering).

## Responsibilities

- Import and instantiate all modules
- Show `SetupWizard` if no competition is selected; transition to live view on selection
- Subscribe to `PollingScheduler` tick events and coordinate the data pipeline:
  1. Receive fresh class results
  2. Feed them to `RunnerStateStore`
  3. Pass changesets to `EventDetector`
  4. Pass runner states to `PredictionEngine`
  5. Update `LatestEventsPanel` and `PredictionsPanel`
  6. Trigger `AudioNotifier` on new events
- Re-enter setup when the user clicks a "change competition" control
- Handle top-level errors (display a non-blocking toast)

## Interface

```js
// js/app.js  —  default export
export default class App {

  /**
   * @param {HTMLElement} rootEl — the mount point (<div id="app">)
   */
  constructor(rootEl)

  /**
   * Bootstrap: restore settings, decide setup vs live, start polling.
   * Called once from index.html.
   * @returns {void}
   */
  init()

  /**
   * Tear down polling and listeners (useful for tests).
   * @returns {void}
   */
  destroy()
}
```

## Dependencies

| Module | Relationship |
|---|---|
| SettingsManager | reads/writes persisted settings |
| ApiClient | passed to PollingScheduler and SetupWizard |
| PollingScheduler | starts/stops polling loop |
| RunnerStateStore | holds live runner state |
| EventDetector | produces latest events |
| PredictionEngine | produces predictions |
| LatestEventsPanel | renders latest events |
| PredictionsPanel | renders predictions |
| ConnectionMonitor | renders connection status |
| AudioNotifier | plays chime |
| SetupWizard | competition/class/club selection UI |
