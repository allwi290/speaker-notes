/**
 * EventDetector — filters RunnerChange[] into visible LatestEvents
 * based on top-N ranking and club-follow rules.
 * @module event-detector
 */

import { getNow } from './clock.js';

/**
 * @typedef {Object} LatestEvent
 * @property {string}  id
 * @property {number}  timestamp      — wall-clock ms
 * @property {string}  className
 * @property {string}  runner
 * @property {string}  club
 * @property {"split"|"finish"|"status_change"} type
 * @property {string}  controlName
 * @property {number|string} place
 * @property {string}  timeplus       — formatted
 * @property {string}  splitTime      — formatted runner cumulative time (HH:MM:SS)
 * @property {boolean} clubFollowed
 * @property {number}  [status]
 */

const STATUS_LABELS = {
  1: 'Did Not Start',
  2: 'Did Not Finish',
  3: 'Mispunch',
  4: 'Disqualified',
  5: 'Overtime',
  11: 'Walkover',
};

/**
 * Format centiseconds as HH:MM:SS.
 * @param {number} cs — centiseconds since midnight
 * @returns {string}
 */
export function formatTime(cs) {
  if (cs == null || cs === '') return '';
  const s = String(cs);
  // Already formatted as M:SS, MM:SS, or H:MM:SS — normalise to HH:MM:SS
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length === 2) return `00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    if (parts.length === 3) return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
    return s;
  }
  const n = Number(cs);
  if (Number.isNaN(n) || n === 0) return '';
  const totalSeconds = Math.floor(n / 100);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Format centisecond timeplus as +M:SS or +H:MM:SS.
 * @param {number|string} tp
 * @returns {string}
 */
export function formatTimeplus(tp) {
  if (tp == null || tp === '' || tp === '+') return '';
  const val = Number(tp);
  if (Number.isNaN(val)) return String(tp);
  if (val === 0) return '+0:00';
  const totalSeconds = Math.floor(Math.abs(val) / 100);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const sign = val >= 0 ? '+' : '-';
  if (h > 0) {
    return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format a wall-clock ms timestamp as HH:MM:SS.
 * @param {number} ms
 * @returns {string}
 */
export function formatWallClock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default class EventDetector {

  /** @type {import('./runner-state-store.js').default} */
  #store;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {LatestEvent[]} */
  #events = [];

  /** Previous top-N per class for demotion detection */
  #prevTopN = new Map();

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
   * Process a changeset and return newly added events.
   * @param   {import('./runner-state-store.js').RunnerChange[]} changes
   * @param   {string} [className]  — class name for prevTopN tracking (used when changes is empty)
   * @returns {LatestEvent[]}
   */
  processChanges(changes, className) {
    const newEvents = [];
    const topN = this.#settings.topN;
    const followedClubs = this.#settings.followedClubs ?? [];

    if (changes && changes.length > 0) {
      for (const change of changes) {
        // Skip "started" — not a visible event
        if (change.type === 'started') continue;

        const key = `${change.runner.name}|${change.runner.club}`;
        const cls = change.className;

        const currentTopN = this.#store.getTopN(cls, topN);
        const previousTopN = this.#prevTopN.get(cls) ?? new Set();

        const isTopN = currentTopN.has(key);
        const wasTopN = previousTopN.has(key);
        const isClub = followedClubs.some(
          c => c.toLowerCase() === change.runner.club.toLowerCase()
        );

        // Eligible: currently top-N, was top-N (demotion), or club-followed
        if (!isTopN && !wasTopN && !isClub) continue;

        const event = this.#buildEvent(change, isClub);
        newEvents.push(event);
      }
    }

    // Always update previous top-N for every class represented
    const classesUpdated = new Set((changes ?? []).map(c => c.className));
    if (className) classesUpdated.add(className);
    for (const cls of classesUpdated) {
      this.#prevTopN.set(cls, this.#store.getTopN(cls, topN));
    }

    // Prepend new events
    if (newEvents.length > 0) {
      this.#events = [...newEvents, ...this.#events];
      const max = this.#settings.maxLatestEvents;
      if (this.#events.length > max) {
        this.#events.length = max;
      }
    }

    return newEvents;
  }

  /**
   * Get the full current list of latest events (newest first).
   * @returns {LatestEvent[]}
   */
  getLatestEvents() {
    return this.#events;
  }

  /**
   * Clear all events.
   */
  clear() {
    this.#events = [];
    this.#prevTopN.clear();
  }

  /* --- Private --- */

  /**
   * @param {import('./runner-state-store.js').RunnerChange} change
   * @param {boolean} isClub
   * @returns {LatestEvent}
   */
  #buildEvent(change, isClub) {
    const controlName = change.type === 'status_change'
      ? (STATUS_LABELS[change.runner.status] ?? `Status ${change.runner.status}`)
      : (change.controlName ?? '');

    const place = change.type === 'finish'
      ? change.runner.place
      : (change.splitPlace ?? '');

    const tp = change.type === 'finish'
      ? formatTimeplus(change.runner.timeplus)
      : formatTimeplus(change.splitTimeplus);

    const splitTime = change.type === 'finish'
      ? formatTime(change.runner.result)
      : formatTime(change.splitTime);

    return {
      id: `${getNow()}-${change.runner.name}-${change.controlCode ?? change.type}`,
      timestamp: getNow(),
      className: change.className,
      runner: change.runner.name,
      club: change.runner.club,
      type: change.type,
      controlName,
      place,
      splitTime,
      timeplus: tp,
      clubFollowed: isClub,
      status: change.runner.status,
    };
  }
}
