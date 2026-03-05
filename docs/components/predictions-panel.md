# PredictionsPanel

## Purpose

Renders the **lower section** of the display — a list of upcoming predicted runner events sorted by predicted time (soonest first).

## Responsibilities

- Render a list of `Prediction` objects as rows in a styled container
- Each row displays: **Predicted time**, **Class**, **Runner**, **Club**, **Target Control**, **Confidence**
- Re-render when predictions are added, removed, or expire
- Visually distinguish predictions that are **overdue** (predicted time has passed but the event hasn't occurred)
- Smoothly remove fulfilled/expired predictions (fade-out animation)
- Scale typography for readability at 1 m+ on Full HD
- Limit display to `maxPredictions` rows

## Interface

```js
// js/predictions-panel.js
export default class PredictionsPanel {

  /**
   * @param {HTMLElement} containerEl — the DOM element to render into
   */
  constructor(containerEl)

  /**
   * Full re-render with the current predictions list.
   * @param {Prediction[]} predictions — sorted by predictedTimeMs ascending
   */
  render(predictions)

  /**
   * Clear the panel.
   */
  clear()
}
```

## DOM Structure

```html
<section id="predictions" class="panel panel--predictions">
  <h2 class="panel__title">Upcoming Predictions</h2>
  <div class="panel__list">
    <div class="prediction-row" data-id="...">
      <span class="prediction-row__time">14:45:20</span>
      <span class="prediction-row__class">Herrar</span>
      <span class="prediction-row__runner">Bruno Godefroy</span>
      <span class="prediction-row__club">OK Ravinen</span>
      <span class="prediction-row__control">Radio K50</span>
      <span class="prediction-row__confidence">± 1 min</span>
    </div>
  </div>
</section>
```

## CSS Classes

| Class | Purpose |
|---|---|
| `prediction-row--overdue` | Subtle highlight when predicted time has passed |
| `prediction-row--removing` | Fade-out animation before DOM removal |

## Dependencies

| Module | Relationship |
|---|---|
| PredictionEngine | data source (receives `Prediction[]`) |
