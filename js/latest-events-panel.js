/**
 * LatestEventsPanel — renders the upper panel with animated event rows.
 * @module latest-events-panel
 */

import { formatWallClock } from './event-detector.js';

export default class LatestEventsPanel {

  /** @type {HTMLElement} */
  #container;

  /**
   * @param {HTMLElement} containerEl — the .panel__list element
   */
  constructor(containerEl) {
    this.#container = containerEl;
  }

  /**
   * Full re-render.
   * @param {import('./event-detector.js').LatestEvent[]} events
   */
  render(events) {
    this.#container.innerHTML = '';
    if (!events || events.length === 0) {
      this.#showEmpty();
      return;
    }
    for (const evt of events) {
      this.#container.appendChild(this.#createRow(evt, false));
    }
  }

  /**
   * Incrementally add new events (prepend with animation).
   * @param {import('./event-detector.js').LatestEvent[]} newEvents
   * @param {import('./event-detector.js').LatestEvent[]} allEvents
   */
  update(newEvents, allEvents) {
    // Remove empty state only if we have new events to show
    if (newEvents.length > 0) {
      const empty = this.#container.querySelector('.panel__empty');
      if (empty) empty.remove();
    }

    // Prepend new rows in reverse so newest ends up on top
    for (let i = newEvents.length - 1; i >= 0; i--) {
      const row = this.#createRow(newEvents[i], true);
      this.#container.prepend(row);

      // Remove animation class after it ends
      row.addEventListener('animationend', () => {
        row.classList.remove('event-row--new');
      }, { once: true });
    }

    // Trim overflow rows from the bottom
    const max = allEvents.length;
    while (this.#container.children.length > max) {
      this.#container.lastElementChild?.remove();
    }

    // Auto-scroll to top (newest)
    this.#container.scrollTo({ top: 0, behavior: 'smooth' });

    // Re-show empty state if all events are gone
    if (allEvents.length === 0 && !this.#container.querySelector('.panel__empty')) {
      this.#showEmpty();
    }
  }

  /** Clear the panel. */
  clear() {
    this.#container.innerHTML = '';
    this.#showEmpty();
  }

  /* --- Private --- */

  /**
   * @param {import('./event-detector.js').LatestEvent} evt
   * @param {boolean} animate
   * @returns {HTMLElement}
   */
  #createRow(evt, animate) {
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.id = evt.id;

    if (animate) row.classList.add('event-row--new');
    if (evt.clubFollowed) row.classList.add('event-row--club');
    if (evt.type === 'status_change') row.classList.add('event-row--status');

    row.innerHTML = `
      <span class="event-row__time">${formatWallClock(evt.timestamp)}</span>
      <span class="event-row__class">${esc(evt.className)}</span>
      <span class="event-row__runner">${esc(evt.runner)}</span>
      <span class="event-row__club">${esc(evt.club)}</span>
      <span class="event-row__control">${esc(evt.controlName)}</span>
      <span class="event-row__place">${esc(String(evt.place ?? ''))}</span>
      <span class="event-row__splittime">${esc(evt.splitTime ?? '')}</span>
      <span class="event-row__timeplus">${esc(evt.timeplus ?? '')}</span>
    `;
    return row;
  }

  #showEmpty() {
    const el = document.createElement('div');
    el.className = 'panel__empty';
    el.textContent = 'Waiting for events…';
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
