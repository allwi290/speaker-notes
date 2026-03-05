# PredictionEngine

## Purpose

Computes predicted arrival times at upcoming controls for top-N runners, using linear extrapolation from split data and a reference runner.

## Responsibilities

- For each top-N runner with at least one recorded split, predict the time at the **next control** they haven't reached yet
- Use the **fastest runner** in the same class who has already passed the target control as the reference
- Apply the prediction formula:   `predictedTime = T₁ + (T_ref₂ − T_ref₁) × paceRatio`   where `paceRatio = runnerSplitToC₁ / refSplitToC₁`
- Include a **finish prediction** when the next unvisited control is the finish
- Remove a prediction when the runner reaches the predicted control (or any later control)
- Auto-expire predictions after **15 minutes**
- Keep at most `maxPredictions` predictions, sorted by predicted time (soonest first)
- Compute a **confidence indicator** (e.g., "±2 min") based on the variance between the runner's pace and reference pace

## Interface

```js
// js/prediction-engine.js

/**
 * @typedef {Object} Prediction
 * @property {string}  id              — unique (runner + targetControl)
 * @property {string}  className
 * @property {string}  runner
 * @property {string}  club
 * @property {string}  targetControlName
 * @property {number}  targetControlCode
 * @property {number}  predictedTimeMs — wall-clock epoch ms
 * @property {string}  predictedTimeFormatted — "HH:MM:SS"
 * @property {string}  referenceRunner
 * @property {string}  confidence      — e.g. "±1 min", "±3 min"
 * @property {number}  createdAt       — epoch ms
 * @property {number}  expiresAt       — epoch ms (createdAt + 15 min)
 */

export default class PredictionEngine {

  /**
   * @param {Object}           deps
   * @param {RunnerStateStore} deps.store
   * @param {SettingsManager}  deps.settings
   */
  constructor(deps)

  /**
   * Recalculate predictions for a class after new data arrives.
   * Removes fulfilled / expired predictions; adds new ones for top-N runners.
   * @param {string} className
   */
  updatePredictions(className)

  /**
   * Get all active predictions sorted by predicted time (soonest first),
   * capped at maxPredictions.
   * @returns {Prediction[]}
   */
  getPredictions()

  /**
   * Remove a specific prediction (e.g., when the event occurs).
   * @param {string} predictionId
   */
  removePrediction(predictionId)

  /**
   * Clear all predictions (e.g., on competition change).
   */
  clear()
}
```

## Dependencies

| Module | Relationship |
|---|---|
| RunnerStateStore | reads runner splits, top-N, split controls, start times |
| SettingsManager | reads `topN`, `maxPredictions`, `followedClasses` |

## Prediction Algorithm Detail

```
Given:
  Runner A has passed control C₁ at cumulative split time S_A₁
  Reference runner B (fastest to have passed C₂) has:
    split to C₁ = S_B₁
    split to C₂ = S_B₂

  paceRatio = S_A₁ / S_B₁
  predictedSplit_A₂ = S_A₁ + (S_B₂ − S_B₁) × paceRatio

  predictedWallClock = competitionStartOfDay + runner.start + predictedSplit_A₂
```

### Reference Runner Selection

The reference runner is the **fastest finisher or fastest runner to have passed the target control** in the same class, measured by cumulative time to that control.

### Finish Prediction

When the target control is the last split control, a finish prediction is generated using the same formula with the reference runner's finish time as `S_B₂`.

### Confidence

Confidence is derived from how consistent the runner's pace ratio has been across previous controls:
- If only 1 split is available: confidence = `"± minutes"` (low)
- If 2+ splits: confidence = standard deviation of per-leg pace ratios, converted to a time range

### Expiry

Predictions expire at `createdAt + 15 minutes`. Expired predictions are pruned on every `updatePredictions` call.
