/**
 * SpeechNotifier — speaks event announcements using the Web Speech API.
 * Events are queued with priority: finish > status_change > split.
 * Stale split events (>2 min) are purged before dequeuing.
 * @module speech-notifier
 */

import { getNow } from './clock.js';
import { getLocale, parseToSeconds } from './speech-locales.js';

const MAX_QUEUE = 10;
const STALE_MS = 2 * 60 * 1000;

const TYPE_PRIORITY = { finish: 0, status_change: 1, split: 2 };

/**
 * Format a time value as spoken duration in the given language.
 * Accepts centiseconds (number), or formatted strings like "12:34", "1:02:34", "+1:23".
 * @param {number|string} val
 * @param {string} [lang] — BCP-47 language code, defaults to English
 * @returns {string}
 */
export function spokenDuration(val, lang) {
  const totalSeconds = parseToSeconds(val);
  if (totalSeconds <= 0) return '';
  return getLocale(lang).spokenDuration(totalSeconds);
}

/**
 * Build spoken text from an event in the given language.
 * @param {import('./event-detector.js').LatestEvent} evt
 * @param {string} [lang] — BCP-47 language code, defaults to English
 * @returns {string}
 */
export function buildSpeechText(evt, lang) {
  const loc = getLocale(lang);

  if (evt.type === 'finish') {
    if (evt.place === 1 || evt.place === '1') {
      const time = spokenDuration(evt.splitTime, lang);
      return loc.finishLeader(evt, time);
    } else {
      const tp = spokenDuration(evt.timeplus, lang);
      const place = evt.place ?? '';
      return loc.finishOther(evt, tp, place);
    }
  }

  if (evt.type === 'status_change') {
    const label = loc.statusLabels[evt.status] ?? `status ${evt.status}`;
    return loc.statusChange(evt, label);
  }

  if (evt.type === 'split') {
    const control = evt.controlName ? `"${evt.controlName}"` : loc.aControl;
    if (evt.place === 1 || evt.place === '1') {
      return loc.splitLeader(evt, control, spokenDuration(evt.splitTime, lang));
    } else {
      const tp = spokenDuration(evt.timeplus, lang);
      const behind = tp ? loc.splitBehind(tp) : '';
      return loc.splitOther(evt, control, spokenDuration(evt.splitTime, lang), behind);
    }
  }

  return loc.fallback(evt);
}

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
    const text = buildSpeechText(evt, this.#settings.speechLang);

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
