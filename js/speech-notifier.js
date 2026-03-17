/**
 * SpeechNotifier — speaks event announcements using the Web Speech API.
 * Events are queued with priority: finish > status_change > split.
 * Stale split events (>2 min) are purged before dequeuing.
 * @module speech-notifier
 */

import { getNow } from './clock.js';
import { formatTimeplus } from './event-detector.js';

const MAX_QUEUE = 10;
const STALE_MS = 2 * 60 * 1000;

const TYPE_PRIORITY = { finish: 0, status_change: 1, split: 2 };

const STATUS_LABELS = {
  1: 'Did Not Start',
  2: 'Did Not Finish',
  3: 'Mispunch',
  4: 'Disqualified',
  5: 'Overtime',
  11: 'Walkover',
};

export default class SpeechNotifier {

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {Array<import('./event-detector.js').LatestEvent>} */
  #queue = [];

  /** @type {boolean} */
  #muted = true; // opt-in: starts muted

  /** @type {boolean} */
  #speaking = false;

  /** @type {SpeechSynthesisVoice[]} */
  #voices = [];

  /**
   * @param {Object} deps
   * @param {import('./settings-manager.js').default} deps.settings
   */
  constructor({ settings }) {
    this.#settings = settings;

    if (typeof speechSynthesis === 'undefined') return;

    // Load voices (may be async on some browsers)
    this.#voices = speechSynthesis.getVoices();
    speechSynthesis.addEventListener('voiceschanged', () => {
      this.#voices = speechSynthesis.getVoices();
    });
  }

  /**
   * Add events to the speech queue and start processing.
   * @param {import('./event-detector.js').LatestEvent[]} events
   */
  speak(events) {
    if (this.#muted || typeof speechSynthesis === 'undefined') return;
    if (!events || events.length === 0) return;

    for (const evt of events) {
      this.#queue.push(evt);
    }

    this.#sortQueue();
    this.#enforceQueueCap();

    if (!this.#speaking) {
      this.#processNext();
    }
  }

  /**
   * Toggle mute state. When muting, clears queue and cancels current speech.
   * @returns {boolean} new muted state
   */
  toggleMute() {
    this.#muted = !this.#muted;
    if (this.#muted) {
      this.#queue.length = 0;
      this.#speaking = false;
      if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
      }
    }
    return this.#muted;
  }

  /** @returns {boolean} */
  get muted() {
    return this.#muted;
  }

  /**
   * Get available voices for the configured language.
   * @returns {SpeechSynthesisVoice[]}
   */
  getVoices() {
    const lang = this.#settings.speechLang ?? 'sv-SE';
    return this.#voices.filter(v => v.lang.startsWith(lang.split('-')[0]));
  }

  /**
   * Get all available voices.
   * @returns {SpeechSynthesisVoice[]}
   */
  getAllVoices() {
    return [...this.#voices];
  }

  /* --- Private --- */

  #processNext() {
    if (this.#muted || this.#queue.length === 0) {
      this.#speaking = false;
      return;
    }

    // Purge stale splits before dequeuing (only when queue has items)
    this.#purgeStale();

    if (this.#queue.length === 0) {
      this.#speaking = false;
      return;
    }

    this.#speaking = true;
    const evt = this.#queue.shift();
    const text = this.#buildText(evt);

    if (!text) {
      this.#processNext();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.#settings.speechLang ?? 'sv-SE';
    utterance.rate = Math.max(0.5, Math.min(2.0, this.#settings.speechRate ?? 1.1));
    utterance.pitch = 1.0;

    // Pick best voice for language
    const voice = this.#pickVoice(utterance.lang);
    if (voice) utterance.voice = voice;

    utterance.addEventListener('end', () => this.#processNext());
    utterance.addEventListener('error', () => this.#processNext());

    speechSynthesis.speak(utterance);
  }

  /**
   * Format centiseconds as spoken duration, e.g. "12 minutes and 34 seconds".
   * @param {number|string} cs
   * @returns {string}
   */
  #spokenDuration(cs) {
    const n = Number(cs);
    if (Number.isNaN(n) || n === 0) return '';
    const totalSeconds = Math.floor(Math.abs(n) / 100);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const parts = [];
    if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
    if (s > 0) parts.push(`${s} second${s !== 1 ? 's' : ''}`);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /**
   * Build spoken text from event.
   * @param {import('./event-detector.js').LatestEvent} evt
   * @returns {string}
   */
  #buildText(evt) {
    if (evt.type === 'finish') {
      if (evt.place === 1 || evt.place === '1') {
        const time = this.#spokenDuration(evt.splitTime);
        return `We have a new leader in class ${evt.className}, ${evt.runner} from ${evt.club}, with a time of ${time}`;
      } else {
        const tp = this.#spokenDuration(evt.timeplus);
        const place = evt.place ?? '';
        return `We have a new runner in ${place} place: ${evt.runner} from ${evt.club}, ${tp} behind the leader.`;
      }
    }

    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);

    if (evt.type === 'status_change') {
      const label = STATUS_LABELS[evt.status] ?? `status ${evt.status}`;
      parts.push(label);
    } else if (evt.type === 'split') {
      if (evt.controlName) parts.push(evt.controlName);
      if (evt.place) parts.push(`place ${evt.place}`);
      const tp = formatTimeplus(evt.timeplus);
      if (tp && tp !== '+0:00') parts.push(tp);
    }

    return parts.join(', ');
  }

  /** Sort queue by priority then chronological order. */
  #sortQueue() {
    this.#queue.sort((a, b) => {
      const pa = TYPE_PRIORITY[a.type] ?? 2;
      const pb = TYPE_PRIORITY[b.type] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.timestamp - b.timestamp;
    });
  }

  /** Enforce max queue size. Drop oldest splits first, then status_change. Never drop finish. */
  #enforceQueueCap() {
    while (this.#queue.length > MAX_QUEUE) {
      // Find oldest split to drop
      const splitIdx = this.#findOldestByType('split');
      if (splitIdx !== -1) {
        this.#queue.splice(splitIdx, 1);
        continue;
      }
      // Then oldest status_change
      const statusIdx = this.#findOldestByType('status_change');
      if (statusIdx !== -1) {
        this.#queue.splice(statusIdx, 1);
        continue;
      }
      // All finish — shouldn't normally happen, but stop to avoid infinite loop
      break;
    }
  }

  /**
   * Find index of the oldest event of the given type (searching from end for most recent = last in sorted order).
   * @param {string} type
   * @returns {number} index or -1
   */
  #findOldestByType(type) {
    for (let i = this.#queue.length - 1; i >= 0; i--) {
      if (this.#queue[i].type === type) return i;
    }
    return -1;
  }

  /** Purge split events older than 2 minutes when queue has items. */
  #purgeStale() {
    const now = getNow();
    const cutoff = now - STALE_MS;
    this.#queue = this.#queue.filter(
      evt => evt.type !== 'split' || evt.timestamp >= cutoff
    );
  }

  /**
   * Pick the best voice for a language.
   * @param {string} lang
   * @returns {SpeechSynthesisVoice|null}
   */
  #pickVoice(lang) {
    if (this.#voices.length === 0) return null;
    // Exact match first
    const exact = this.#voices.find(v => v.lang === lang);
    if (exact) return exact;
    // Prefix match (e.g. 'sv' matches 'sv-SE')
    const prefix = lang.split('-')[0];
    return this.#voices.find(v => v.lang.startsWith(prefix)) ?? null;
  }
}
