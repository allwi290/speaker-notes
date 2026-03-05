# PollingScheduler

## Purpose

Manages the timed polling loop for all followed classes. Staggers requests evenly within a 15-second window to avoid bursts and coordinates the data pipeline on each tick.

## Responsibilities

- Maintain a list of classes to poll (derived from `SettingsManager`)
- Spread requests evenly: if following *N* classes, fire one request every `15 000 / N` ms
- Call `ApiClient.getClassResults` for each class in turn
- On receiving new data, invoke a callback (`onClassUpdate`) so `App` can run the pipeline
- Skip a class if the circuit breaker is open
- Pause/resume polling (e.g., when the tab is hidden via `document.visibilitychange`)
- Clean up all timers on `stop()`

## Interface

```js
// js/polling-scheduler.js
export default class PollingScheduler {

  /**
   * @param {Object}          deps
   * @param {ApiClient}       deps.apiClient
   * @param {SettingsManager} deps.settings
   */
  constructor(deps)

  /**
   * Begin the polling loop for all currently followed classes.
   * @param {OnClassUpdateFn} onClassUpdate — called with fresh data
   * @returns {void}
   *
   * @callback OnClassUpdateFn
   * @param {string}       className
   * @param {ClassResults} results
   */
  start(onClassUpdate)

  /**
   * Stop all polling timers.
   * @returns {void}
   */
  stop()

  /**
   * Re-read followed classes from settings and adjust schedule.
   * Call after settings change.
   * @returns {void}
   */
  refresh()
}
```

## Dependencies

| Module | Relationship |
|---|---|
| ApiClient | invokes `getClassResults` |
| SettingsManager | reads `compId` and `followedClasses` |
