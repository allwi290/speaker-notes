/**
 * RunnerStateStore — in-memory runner state with change detection.
 * @module runner-state-store
 */

/**
 * @typedef {Object} SplitState
 * @property {number}        time      — centiseconds  (0 or empty if not passed)
 * @property {number|string} place
 * @property {number|string} timeplus
 * @property {number}        status    — 0 = passed, 1 = not yet
 */

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
 * @property {number}   start         — centiseconds from midnight
 * @property {Map<number, SplitState>} splits   — keyed by control code
 */

/**
 * @typedef {Object} RunnerChange
 * @property {RunnerState} runner
 * @property {string}      className
 * @property {"split"|"finish"|"status_change"|"started"} type
 * @property {number}      [controlCode]
 * @property {string}      [controlName]
 * @property {number}      [splitPlace]
 * @property {number|string} [splitTimeplus]
 */

/**
 * Build a unique runner key from name + club.
 * @param {string} name
 * @param {string} club
 * @returns {string}
 */
function runnerKey(name, club) {
  return `${name}|${club}`;
}

/**
 * Parse the flat API splits object into a Map<code, SplitState>.
 * API keys: "1065" (time), "1065_status", "1065_place", "1065_timeplus"
 * @param {Object}          raw           — splits from API
 * @param {Array<{code:number}>} controls — ordered split controls
 * @returns {Map<number, SplitState>}
 */
function parseSplits(raw, controls) {
  const splits = new Map();
  if (!raw || !controls) return splits;

  for (const ctrl of controls) {
    const code = ctrl.code;
    const timeVal = raw[String(code)];
    splits.set(code, {
      time:     typeof timeVal === 'number' ? timeVal : 0,
      status:   raw[`${code}_status`] ?? 1,
      place:    raw[`${code}_place`]  ?? '',
      timeplus: raw[`${code}_timeplus`] ?? '',
    });
  }
  return splits;
}

/**
 * Build a RunnerState from raw API data.
 * @param {Object} raw
 * @param {string} className
 * @param {Array}  controls
 * @returns {RunnerState}
 */
function buildRunnerState(raw, className, controls) {
  return {
    name:      raw.name,
    club:      raw.club,
    className,
    status:    raw.status,
    progress:  raw.progress ?? 0,
    place:     raw.place ?? '',
    result:    raw.result ?? '',
    timeplus:  raw.timeplus ?? '',
    start:     raw.start ?? 0,
    splits:    parseSplits(raw.splits, controls),
  };
}

/** Status codes that should be excluded from top-N ranking */
const EXCLUDED_STATUSES = new Set([1, 2, 3, 4, 5, 11, 12]);

export default class RunnerStateStore {

  /**
   * Per-class data.
   * @type {Map<string, {
   *   controls: Array<{code:number, name:string}>,
   *   previous: Map<string, RunnerState>,
   *   current:  Map<string, RunnerState>
   * }>}
   */
  #classes = new Map();

  constructor() {}

  /**
   * Update state for a class and detect changes.
   * @param {string} className
   * @param {Array<{code:number, name:string}>} splitcontrols
   * @param {Array}  results
   * @returns {RunnerChange[]}
   */
  updateClass(className, splitcontrols, results) {
    if (!this.#classes.has(className)) {
      this.#classes.set(className, {
        controls: splitcontrols ?? [],
        previous: new Map(),
        current:  new Map(),
      });
    }

    const cls = this.#classes.get(className);
    cls.controls = splitcontrols ?? cls.controls;

    // Shift current → previous
    cls.previous = cls.current;

    // Build new current from API data
    const newCurrent = new Map();
    const changes = [];

    for (const raw of (results ?? [])) {
      const key = runnerKey(raw.name, raw.club);
      const state = buildRunnerState(raw, className, cls.controls);
      newCurrent.set(key, state);

      const prev = cls.previous.get(key);
      const detected = this.#detectChanges(prev, state, className, cls.controls);
      changes.push(...detected);
    }

    cls.current = newCurrent;
    return changes;
  }

  /**
   * Get all runner states for a class.
   * @param   {string} className
   * @returns {RunnerState[]}
   */
  getRunners(className) {
    const cls = this.#classes.get(className);
    return cls ? [...cls.current.values()] : [];
  }

  /**
   * Get a single runner by key ("name|club").
   * @param   {string} className
   * @param   {string} key
   * @returns {RunnerState|undefined}
   */
  getRunner(className, key) {
    return this.#classes.get(className)?.current.get(key);
  }

  /**
   * Return the top N runner keys (lowest cumulative time).
   * @param   {string} className
   * @param   {number} topN
   * @returns {Set<string>}
   */
  getTopN(className, topN) {
    const cls = this.#classes.get(className);
    if (!cls) return new Set();

    const ranked = [];
    for (const [key, runner] of cls.current) {
      if (EXCLUDED_STATUSES.has(runner.status)) continue;

      const time = this.#effectiveTime(runner);
      if (time === null) continue;

      ranked.push({ key, time });
    }

    ranked.sort((a, b) => a.time - b.time);
    return new Set(ranked.slice(0, topN).map(r => r.key));
  }

  /**
   * Get split controls for a class (ordered).
   * @param   {string} className
   * @returns {Array<{code:number, name:string}>}
   */
  getSplitControls(className) {
    return this.#classes.get(className)?.controls ?? [];
  }

  /**
   * Remove all data for a class.
   * @param {string} className
   */
  clearClass(className) {
    this.#classes.delete(className);
  }

  /* ------------------------------------------------------------------
   * Private helpers
   * ----------------------------------------------------------------*/

  /**
   * Get the effective ranking time for a runner (centiseconds).
   * Finished → result. In progress → last passed split time.
   * @param   {RunnerState} runner
   * @returns {number|null}
   */
  #effectiveTime(runner) {
    // Finished
    if (runner.status === 0 && runner.result) {
      const n = Number(runner.result);
      if (!Number.isNaN(n) && n > 0) return n;
    }

    // In progress — find the last split with status 0
    let lastTime = null;
    for (const [, split] of runner.splits) {
      if (split.status === 0 && split.time > 0) {
        lastTime = split.time;
      }
    }
    return lastTime;
  }

  /**
   * Compare previous and current state, emit RunnerChange objects.
   * @param {RunnerState|undefined} prev
   * @param {RunnerState}           curr
   * @param {string}                className
   * @param {Array<{code:number, name:string}>} controls
   * @returns {RunnerChange[]}
   */
  #detectChanges(prev, curr, className, controls) {
    const changes = [];

    // New runner (no previous state) — only emit if they have meaningful data
    if (!prev) {
      // Don't emit events for initial load (status 9 or 10 with no splits)
      return changes;
    }

    // Started: 10 → 9
    if ((prev.status === 10) && curr.status === 9) {
      changes.push({
        runner: curr,
        className,
        type: 'started',
      });
    }

    // Finish: status changed to 0 with a result
    if (prev.status !== 0 && curr.status === 0 && curr.result) {
      changes.push({
        runner: curr,
        className,
        type: 'finish',
        controlCode: null,
        controlName: 'Finish',
        splitPlace: curr.place,
        splitTimeplus: curr.timeplus,
      });
    }

    // Status change (DNS, DNF, MP, DSQ, OT, WO)
    const statusChangeSet = new Set([1, 2, 3, 4, 5, 11]);
    if (!statusChangeSet.has(prev.status) && statusChangeSet.has(curr.status)) {
      changes.push({
        runner: curr,
        className,
        type: 'status_change',
      });
    }

    // New splits
    for (const ctrl of controls) {
      const prevSplit = prev.splits.get(ctrl.code);
      const currSplit = curr.splits.get(ctrl.code);
      if (!currSplit) continue;

      const prevPassed = prevSplit && prevSplit.status === 0 && prevSplit.time > 0;
      const currPassed = currSplit.status === 0 && currSplit.time > 0;

      if (!prevPassed && currPassed) {
        changes.push({
          runner: curr,
          className,
          type: 'split',
          controlCode: ctrl.code,
          controlName: ctrl.name,
          splitPlace: currSplit.place,
          splitTimeplus: currSplit.timeplus,
        });
      }
    }

    return changes;
  }
}
