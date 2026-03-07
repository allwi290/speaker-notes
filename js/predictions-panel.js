/**
 * PredictionsPanel — renders the lower panel with predicted events.
 * @module predictions-panel
 */

import { getNow } from './clock.js';

export default class PredictionsPanel {

  /** @type {HTMLElement} */
  #container;

  /**
   * @param {HTMLElement} containerEl — the .panel__list element
   */
  constructor(containerEl) {
    this.#container = containerEl;
  }

  /**
   * Full re-render with current predictions.
   * @param {import('./prediction-engine.js').Prediction[]} predictions
   */
  render(predictions) {
    this.#container.innerHTML = '';

    if (!predictions || predictions.length === 0) {
      this.#showEmpty();
      return;
    }

    const now = getNow();
    const WINDOW_MS = 10 * 60 * 1000; // ±10 minutes
    const visible = predictions.filter(p =>
      p.predictedTimeMs >= now - WINDOW_MS && p.predictedTimeMs <= now + WINDOW_MS
    );

    if (visible.length === 0) {
      this.#showEmpty();
      return;
    }

    for (const pred of visible) {
      const row = document.createElement('div');
      row.className = 'prediction-row';
      row.dataset.id = pred.id;

      if (pred.predictedTimeMs < now) {
        row.classList.add('prediction-row--overdue');
      }

      row.innerHTML = `
        <span class="prediction-row__time">${esc(pred.predictedTimeFormatted)}</span>
        <span class="prediction-row__class">${esc(pred.className)}</span>
        <span class="prediction-row__runner">${esc(pred.runner)}</span>
        <span class="prediction-row__club">${esc(pred.club)}</span>
        <span class="prediction-row__control">${esc(pred.targetControlName)}</span>
        <span class="prediction-row__confidence">${esc(pred.confidence)}</span>
      `;
      this.#container.appendChild(row);
    }
  }

  /** Clear the panel. */
  clear() {
    this.#container.innerHTML = '';
    this.#showEmpty();
  }

  /* --- Private --- */

  #showEmpty() {
    const el = document.createElement('div');
    el.className = 'panel__empty';
    el.textContent = 'No predictions yet…';
    this.#container.appendChild(el);
  }
}

/**
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
