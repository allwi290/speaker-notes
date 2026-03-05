# EventDetector

## Purpose

Interprets raw changesets from `RunnerStateStore` and applies business rules (top-N filtering, club following) to decide which changes become visible **latest events**.

## Responsibilities

- Receive a changeset (array of `RunnerChange`) from a class update
- Apply the **top-N filter**: only emit events for runners currently in the top N for their class
- Apply the **club-follow bypass**: always emit events for runners whose club is in `followedClubs`, regardless of top-N standing
- Emit **status-change events** (DNF, DSQ, MP, etc.) for top-N and club-followed runners
- Emit events when a runner **drops out of top-N** (their last event in top-N is still shown)
- Maintain an ordered list of the latest events (max `maxLatestEvents`, newest first)
- Auto-expire events older than a configurable TTL (optional, default: no expiry — just capped by count)
- Mark club-followed events with a `clubFollowed: true` flag for visual highlighting

## Interface

```js
// js/event-detector.js

/**
 * @typedef {Object} LatestEvent
 * @property {string}  id             — unique (timestamp + runner + control)
 * @property {number}  timestamp      — wall-clock ms when detected
 * @property {string}  className
 * @property {string}  runner
 * @property {string}  club
 * @property {"split"|"finish"|"status_change"} type
 * @property {string}  [controlName]  — e.g. "Radio K65"
 * @property {number|string} [place]  — place at control or final
 * @property {string}  [timeplus]     — formatted time behind leader
 * @property {boolean} clubFollowed   — true if club is in followedClubs
 * @property {number}  [status]       — runner status code (for status_change)
 */

export default class EventDetector {

  /**
   * @param {Object}          deps
   * @param {RunnerStateStore} deps.store
   * @param {SettingsManager}  deps.settings
   */
  constructor(deps)

  /**
   * Process a changeset and update the internal latest-events list.
   * @param   {RunnerChange[]} changes
   * @returns {LatestEvent[]}  newly added events (for chime trigger)
   */
  processChanges(changes)

  /**
   * Get the current list of latest events (newest first, capped).
   * @returns {LatestEvent[]}
   */
  getLatestEvents()

  /**
   * Clear all events (e.g., on competition change).
   */
  clear()
}
```

## Dependencies

| Module | Relationship |
|---|---|
| RunnerStateStore | reads top-N sets and runner state |
| SettingsManager | reads `topN`, `followedClubs`, `maxLatestEvents` |

## Business Rules

1. A runner is **eligible** if they are in `getTopN(className, topN)` OR their club is in `followedClubs`.
2. A runner who **was** in top-N on the previous poll but is no longer still gets their latest change emitted (demotion event).
3. Status changes (status ∈ {1, 2, 3, 4, 5, 11}) for eligible runners are emitted as `type: "status_change"`.
4. The event list is capped at `maxLatestEvents`; oldest events are dropped when the cap is exceeded.
