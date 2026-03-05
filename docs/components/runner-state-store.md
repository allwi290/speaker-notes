# RunnerStateStore

## Purpose

In-memory store of the current state of every runner in every followed class. Detects what has changed between polls by comparing the new data against a snapshot of the previous state.

## Responsibilities

- Store runner state per class, keyed by runner name (or a composite key of name + club)
- On each update, diff the incoming results against the stored snapshot and produce a **changeset**
- Track per-runner:
  - `status`, `progress`, `place`, `result`, `timeplus`
  - `splits`: Map of control code → `{ time, place, timeplus, status }`
  - `start` time
- Determine **top N** runners per class at any given moment (lowest cumulative time at their most recent split, or final result)
- Provide lookups: runners by class, runner by name+class, top-N set, finished runners
- Clear state for a class when it is unfollowed

## Interface

```js
// js/runner-state-store.js

/**
 * @typedef {Object} RunnerState
 * @property {string}   name
 * @property {string}   club
 * @property {string}   className
 * @property {number}   status
 * @property {number}   progress
 * @property {string}   place
 * @property {number|string} result
 * @property {number|string} timeplus
 * @property {number}   start
 * @property {Map<number, SplitState>} splits
 *
 * @typedef {Object} SplitState
 * @property {number}        time       — centiseconds
 * @property {number|string} place
 * @property {number|string} timeplus
 * @property {number}        status     — 0 = passed, 1 = not yet
 */

/**
 * @typedef {Object} RunnerChange
 * @property {RunnerState} runner
 * @property {string}      className
 * @property {"split"|"finish"|"status_change"|"started"} type
 * @property {number}      [controlCode]   — for split events
 * @property {string}      [controlName]   — for split events
 * @property {number}      [splitPlace]    — place at that control
 * @property {number|string} [splitTimeplus]
 */

export default class RunnerStateStore {

  constructor()

  /**
   * Update state for a class and return detected changes.
   * @param {string}         className
   * @param {SplitControl[]} splitcontrols
   * @param {RunnerResult[]} results
   * @returns {RunnerChange[]}
   */
  updateClass(className, splitcontrols, results)

  /**
   * Get all runner states for a class.
   * @param   {string} className
   * @returns {RunnerState[]}
   */
  getRunners(className)

  /**
   * Get a single runner.
   * @param   {string} className
   * @param   {string} runnerKey — "name|club"
   * @returns {RunnerState|undefined}
   */
  getRunner(className, runnerKey)

  /**
   * Return the top N runners for a class, ranked by lowest cumulative
   * time at their most recent split (or final result).
   * @param   {string} className
   * @param   {number} topN
   * @returns {Set<string>}  — set of runner keys
   */
  getTopN(className, topN)

  /**
   * Get split controls for a class (ordered).
   * @param   {string} className
   * @returns {SplitControl[]}
   */
  getSplitControls(className)

  /**
   * Remove all data for a class.
   * @param {string} className
   */
  clearClass(className)
}
```

## Dependencies

| Module | Relationship |
|---|---|
| _none_ | standalone, pure data store |

## Notes

- Runner key is `"name|club"` to handle name collisions across clubs.
- The store keeps **two snapshots** per class: `previous` and `current`. `updateClass` overwrites `previous` with `current`, then rebuilds `current` from the API payload, and diffs the two.
- Top-N calculation: for each runner, find the last split with `status === 0`. The cumulative time is the split time. Finished runners use their `result`. Runners are ranked by this time ascending; ties broken by place.
