/**
 * GoogleTtsNotifier — speaks event announcements using Google Cloud TTS API.
 * Same public interface as SpeechNotifier: speak(events), toggleMute(), muted.
 * Requires a user-provided API key stored in settings.googleTtsApiKey.
 * @module google-tts-notifier
 */

import { getNow } from './clock.js';
import { formatTime, formatTimeplus } from './event-detector.js';

const API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
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

/** Map speechLang codes to Google Cloud TTS Wavenet voice names. */
const VOICE_MAP = {
  'sv-SE':  { name: 'sv-SE-Wavenet-A', ssmlGender: 'FEMALE' },
  'en-GB':  { name: 'en-GB-Wavenet-B', ssmlGender: 'MALE' },
  'en-US':  { name: 'en-US-Wavenet-D', ssmlGender: 'MALE' },
  'nb-NO':  { name: 'nb-NO-Wavenet-A', ssmlGender: 'FEMALE' },
  'da-DK':  { name: 'da-DK-Wavenet-A', ssmlGender: 'FEMALE' },
  'fi-FI':  { name: 'fi-FI-Wavenet-A', ssmlGender: 'FEMALE' },
  'de-DE':  { name: 'de-DE-Wavenet-A', ssmlGender: 'FEMALE' },
  'fr-FR':  { name: 'fr-FR-Wavenet-A', ssmlGender: 'FEMALE' },
};

export default class GoogleTtsNotifier {

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {Array<import('./event-detector.js').LatestEvent>} */
  #queue = [];

  /** @type {boolean} */
  #muted = true;

  /** @type {boolean} */
  #speaking = false;

  /** @type {HTMLAudioElement|null} */
  #audio = null;

  /**
   * @param {Object} deps
   * @param {import('./settings-manager.js').default} deps.settings
   */
  constructor({ settings }) {
    this.#settings = settings;
  }

  /**
   * Add events to the speech queue and start processing.
   * @param {import('./event-detector.js').LatestEvent[]} events
   */
  speak(events) {
    if (this.#muted) return;
    if (!this.#settings.googleTtsApiKey) return;
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
   * Toggle mute state. When muting, clears queue and stops current audio.
   * @returns {boolean} new muted state
   */
  toggleMute() {
    this.#muted = !this.#muted;
    if (this.#muted) {
      this.#queue.length = 0;
      this.#speaking = false;
      if (this.#audio) {
        this.#audio.pause();
        this.#audio = null;
      }
    }
    return this.#muted;
  }

  /** @returns {boolean} */
  get muted() {
    return this.#muted;
  }

  /* --- Private --- */

  async #processNext() {
    if (this.#muted || this.#queue.length === 0) {
      this.#speaking = false;
      return;
    }

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

    try {
      const audioContent = await this.#synthesize(text);
      if (this.#muted) { this.#speaking = false; return; }

      const blob = this.#base64ToBlob(audioContent, 'audio/mp3');
      const url = URL.createObjectURL(blob);
      this.#audio = new Audio(url);

      this.#audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        this.#audio = null;
        this.#processNext();
      });
      this.#audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        this.#audio = null;
        this.#processNext();
      });

      await this.#audio.play();
    } catch (err) {
      console.warn('Google TTS failed:', err.message);
      this.#speaking = false;
      setTimeout(() => this.#processNext(), 500);
    }
  }

  /**
   * Call Google Cloud TTS API.
   * @param {string} text
   * @returns {Promise<string>} base64-encoded audio content
   */
  async #synthesize(text) {
    const apiKey = this.#settings.googleTtsApiKey;
    if (!apiKey) throw new Error('No API key configured');

    const lang = this.#settings.speechLang ?? 'sv-SE';
    const voiceConfig = VOICE_MAP[lang] ?? { name: null, ssmlGender: 'NEUTRAL' };

    const body = {
      input: { text },
      voice: {
        languageCode: lang,
        ssmlGender: voiceConfig.ssmlGender,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.25, Math.min(4.0, this.#settings.speechRate ?? 1.1)),
      },
    };

    if (voiceConfig.name) {
      body.voice.name = voiceConfig.name;
    }

    const resp = await fetch(`${API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Google TTS HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data.audioContent;
  }

  /**
   * @param {string} base64
   * @param {string} mimeType
   * @returns {Blob}
   */
  #base64ToBlob(base64, mimeType) {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      arr[i] = bytes.charCodeAt(i);
    }
    return new Blob([arr], { type: mimeType });
  }

  /**
   * Build spoken text from event.
   * @param {import('./event-detector.js').LatestEvent} evt
   * @returns {string}
   */
  #buildText(evt) {
    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);

    if (evt.type === 'finish') {
      parts.push('finish');
      if (evt.place) parts.push(`place ${evt.place}`);
      const time = formatTime(evt.splitTime);
      if (time) parts.push(time);
      const tp = formatTimeplus(evt.timeplus);
      if (tp && tp !== '+0:00') parts.push(tp);
    } else if (evt.type === 'status_change') {
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

  #sortQueue() {
    this.#queue.sort((a, b) => {
      const pa = TYPE_PRIORITY[a.type] ?? 2;
      const pb = TYPE_PRIORITY[b.type] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.timestamp - b.timestamp;
    });
  }

  #enforceQueueCap() {
    while (this.#queue.length > MAX_QUEUE) {
      const splitIdx = this.#findOldestByType('split');
      if (splitIdx !== -1) { this.#queue.splice(splitIdx, 1); continue; }
      const statusIdx = this.#findOldestByType('status_change');
      if (statusIdx !== -1) { this.#queue.splice(statusIdx, 1); continue; }
      break;
    }
  }

  /**
   * @param {string} type
   * @returns {number}
   */
  #findOldestByType(type) {
    for (let i = this.#queue.length - 1; i >= 0; i--) {
      if (this.#queue[i].type === type) return i;
    }
    return -1;
  }

  #purgeStale() {
    const now = getNow();
    const cutoff = now - STALE_MS;
    this.#queue = this.#queue.filter(
      evt => evt.type !== 'split' || evt.timestamp >= cutoff
    );
  }
}
