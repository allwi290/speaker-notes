/**
 * PredictionEngine — predicts arrival times at upcoming controls
 * for top-N runners using linear extrapolation.
 * @module prediction-engine
 */

import { formatWallClock } from './event-detector.js';
import { getNow, getDate } from './clock.js';

const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * @typedef {Object} Prediction
 * @property {string}  id
 * @property {string}  className
 * @property {string}  runner
 * @property {string}  club
 * @property {string}  targetControlName
 * @property {number}  targetControlCode
 * @property {number}  predictedTimeMs     — wall-clock epoch ms
 * @property {string}  predictedTimeFormatted
 * @property {string}  referenceRunner
 * @property {number}  createdAt           — epoch ms
 * @property {number}  expiresAt           — epoch ms
 */

/**
 * Cached competition-day midnight (epoch ms).
 * Set once on first use, prevents breakage if app runs past midnight.
 * @type {number|null}
 */
let competitionMidnightMs = null;

/**
 * Get the competition day's midnight in epoch ms.
 * Cached on first call.
 * @returns {number}
 */
function getCompetitionMidnight() {
  if (competitionMidnightMs === null) {
    const d = getDate();
    d.setHours(0, 0, 0, 0);
    competitionMidnightMs = d.getTime();
  }
  return competitionMidnightMs;
}

/**
 * Convert centiseconds-from-midnight to wall-clock epoch ms.
 * @param {number} cs — centiseconds from midnight
 * @returns {number}  epoch ms
 */
function csToWallMs(cs) {
  return getCompetitionMidnight() + (cs / 100) * 1000;
}

export default class PredictionEngine {

  /** @type {import('./runner-state-store.js').default} */
  #store;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {Map<string, Prediction>} keyed by id */
  #predictions = new Map();

  /**
   * @param {Object} deps
   * @param {import('./runner-state-store.js').default} deps.store
   * @param {import('./settings-manager.js').default}   deps.settings
   */
  constructor({ store, settings }) {
    this.#store = store;
    this.#settings = settings;
  }

  /**
   * Recalculate predictions for a class.
   * @param {string} className
   */
  updatePredictions(className) {
    const now = getNow();
    const topN = this.#settings.topN;
    const topNSet = this.#store.getTopN(className, topN);
    const controls = this.#store.getSplitControls(className);
    const allRunners = this.#store.getRunners(className);

    // Purge expired and fulfilled predictions
    for (const [id, pred] of this.#predictions) {
      if (pred.expiresAt <= now) {
        this.#predictions.delete(id);
        continue;
      }
      // Fulfilled: runner has now passed the predicted control
      if (pred.className === className) {
        const runner = this.#store.getRunner(className, `${pred.runner}|${pred.club}`);
        if (runner) {
          const split = runner.splits.get(pred.targetControlCode);
          if (split && split.status === 0 && split.time > 0) {
            this.#predictions.delete(id);
            continue;
          }
          // Runner finished
          if (runner.status === 0 && runner.result) {
            this.#predictions.delete(id);
          }
        }
      }
    }

    // Generate new predictions for top-N runners
    for (const key of topNSet) {
      const runner = this.#store.getRunner(className, key);
      if (!runner) continue;
      // Skip finished runners
      if (runner.status === 0 && runner.result) continue;

      const { lastControlIdx } = this.#findLastPassedControl(runner, controls);
      if (lastControlIdx === -1) continue; // no splits yet

      // Determine target control (next control, or finish)
      const isLastSplit = lastControlIdx === controls.length - 1;
      const targetIdx = isLastSplit ? -1 : lastControlIdx + 1;
      const targetCode = isLastSplit ? null : controls[targetIdx].code;
      const targetName = isLastSplit ? 'Finish' : controls[targetIdx].name;

      const predId = `${runner.name}|${runner.club}|${targetName}`;

      // Find reference (fastest single runner, or median virtual runner)
      const algo = this.#settings.predictionAlgorithm ?? 'fastest';
      const ref = algo === 'median'
        ? this.#findMedianReference(allRunners, controls, lastControlIdx, targetIdx, isLastSplit)
        : this.#findReference(allRunners, controls, lastControlIdx, targetIdx, isLastSplit);
      if (!ref) continue;

      // Compute prediction
      const prediction = this.#computePrediction(
        runner, ref, controls, lastControlIdx, targetIdx, isLastSplit, className, targetCode, targetName, predId
      );
      if (!prediction) continue;

      // Update or insert
      const existing = this.#predictions.get(predId);
      if (existing) {
        existing.predictedTimeMs = prediction.predictedTimeMs;
        existing.predictedTimeFormatted = prediction.predictedTimeFormatted;
        existing.referenceRunner = prediction.referenceRunner;
      } else {
        this.#predictions.set(predId, prediction);
      }
    }
  }

  /**
   * Get all active predictions (sorted by predicted time, capped).
   * @returns {Prediction[]}
   */
  getPredictions() {
    const now = getNow();
    const preds = [...this.#predictions.values()]
      .filter(p => p.expiresAt > now)
      .sort((a, b) => a.predictedTimeMs - b.predictedTimeMs);
    return preds.slice(0, this.#settings.maxPredictions);
  }

  /**
   * Remove a specific prediction.
   * @param {string} id
   */
  removePrediction(id) {
    this.#predictions.delete(id);
  }

  /**
   * Clear all predictions.
   */
  clear() {
    this.#predictions.clear();
    // Reset the cached competition midnight so it recalculates
    // (important when switching between demo and live mode)
    competitionMidnightMs = null;
  }

  /* --- Private helpers --- */

  /**
   * Find the index of the last control the runner has passed.
   * @param {import('./runner-state-store.js').RunnerState} runner
   * @param {Array} controls
   * @returns {{ lastControlIdx: number, lastSplitTime: number }}
   */
  #findLastPassedControl(runner, controls) {
    let lastControlIdx = -1;
    let lastSplitTime = 0;
    for (let i = 0; i < controls.length; i++) {
      const split = runner.splits.get(controls[i].code);
      if (split && split.status === 0 && split.time > 0) {
        lastControlIdx = i;
        lastSplitTime = split.time;
      }
    }
    return { lastControlIdx, lastSplitTime };
  }

  /**
   * Find the best reference runner (fastest to the target control/finish).
   * @param {Array}  allRunners
   * @param {Array}  controls
   * @param {number} lastIdx
   * @param {number} targetIdx    — -1 for finish
   * @param {boolean} isFinish
   * @returns {{ runner: *, refTimeToLast: number, refTimeToTarget: number }|null}
   */
  #findReference(allRunners, controls, lastIdx, targetIdx, isFinish) {
    let best = null;
    let bestTargetTime = Infinity;

    for (const r of allRunners) {
      // Reference must have passed both controls
      const lastSplit = r.splits.get(controls[lastIdx].code);
      if (!lastSplit || lastSplit.status !== 0 || lastSplit.time <= 0) continue;

      let targetTime;
      if (isFinish) {
        if (r.status !== 0 || !r.result) continue;
        targetTime = typeof r.result === 'number' ? r.result : Number(r.result);
        if (Number.isNaN(targetTime) || targetTime <= 0) continue;
      } else {
        const targetSplit = r.splits.get(controls[targetIdx].code);
        if (!targetSplit || targetSplit.status !== 0 || targetSplit.time <= 0) continue;
        targetTime = targetSplit.time;
      }

      if (targetTime < bestTargetTime) {
        bestTargetTime = targetTime;
        best = {
          runner: r,
          refTimeToLast: lastSplit.time,
          refTimeToTarget: targetTime,
        };
      }
    }
    return best;
  }

  /**
   * Build a virtual reference from the median cumulative times of all
   * eligible runners at the last and target controls.
   * @param {Array}  allRunners
   * @param {Array}  controls
   * @param {number} lastIdx
   * @param {number} targetIdx    — -1 for finish
   * @param {boolean} isFinish
   * @returns {{ runner: { name: string, splits: Map, status: number, result: * }, refTimeToLast: number, refTimeToTarget: number }|null}
   */
  #findMedianReference(allRunners, controls, lastIdx, targetIdx, isFinish) {
    const lastTimes = [];
    const targetTimes = [];
    const eligible = [];

    for (const r of allRunners) {
      const lastSplit = r.splits.get(controls[lastIdx].code);
      if (!lastSplit || lastSplit.status !== 0 || lastSplit.time <= 0) continue;

      let targetTime;
      if (isFinish) {
        if (r.status !== 0 || !r.result) continue;
        targetTime = typeof r.result === 'number' ? r.result : Number(r.result);
        if (Number.isNaN(targetTime) || targetTime <= 0) continue;
      } else {
        const targetSplit = r.splits.get(controls[targetIdx].code);
        if (!targetSplit || targetSplit.status !== 0 || targetSplit.time <= 0) continue;
        targetTime = targetSplit.time;
      }

      lastTimes.push(lastSplit.time);
      targetTimes.push(targetTime);
      eligible.push(r);
    }

    if (eligible.length === 0) return null;

    lastTimes.sort((a, b) => a - b);
    targetTimes.sort((a, b) => a - b);

    const mid = Math.floor(lastTimes.length / 2);
    const medianLast   = lastTimes.length % 2 === 1
      ? lastTimes[mid]
      : (lastTimes[mid - 1] + lastTimes[mid]) / 2;
    const medianTarget = targetTimes.length % 2 === 1
      ? targetTimes[mid]
      : (targetTimes[mid - 1] + targetTimes[mid]) / 2;

    const virtualRunner = {
      name: `Median (n=${eligible.length})`,
      club: '',
      splits: new Map(),
      status: 0,
      result: null,
    };

    return {
      runner: virtualRunner,
      refTimeToLast: medianLast,
      refTimeToTarget: medianTarget,
    };
  }

  /**
   * Compute a Prediction.
   * @returns {Prediction|null}
   */
  #computePrediction(runner, ref, controls, lastIdx, targetIdx, isFinish, className, targetCode, targetName, predId) {
    const runnerLastSplit = runner.splits.get(controls[lastIdx].code);
    if (!runnerLastSplit || runnerLastSplit.time <= 0) return null;

    const s_a1 = runnerLastSplit.time;
    const s_b1 = ref.refTimeToLast;
    const s_b2 = ref.refTimeToTarget;

    if (s_b1 <= 0) return null;

    const paceRatio = s_a1 / s_b1;
    const predictedSplit = s_a1 + (s_b2 - s_b1) * paceRatio;

    // Convert to wall clock: runner.start + predictedSplit (both in centiseconds from midnight)
    const predictedCs = runner.start + predictedSplit;
    const predictedMs = csToWallMs(predictedCs);

    const now = getNow();
    return {
      id: predId,
      className,
      runner: runner.name,
      club: runner.club,
      targetControlName: targetName,
      targetControlCode: targetCode,
      predictedTimeMs: predictedMs,
      predictedTimeFormatted: formatWallClock(predictedMs),
      referenceRunner: ref.runner.name,
      createdAt: now,
      expiresAt: now + EXPIRY_MS,
    };
  }

}
