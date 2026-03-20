/**
 * GoogleTtsNotifier — speaks event announcements using Google Cloud TTS API.
 * Same public interface as SpeechNotifier: speak(events), toggleMute(), muted.
 * Requires a user-provided API key stored in settings.googleTtsApiKey.
 * @module google-tts-notifier
 */

import { getNow } from './clock.js';
import { buildSpeechText } from './speech-notifier.js';

const API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const MAX_QUEUE = 10;
const STALE_MS = 2 * 60 * 1000;

const TYPE_PRIORITY = { finish: 0, status_change: 1, split: 2 };

/**
 * Convert plain text to SSML, spelling out standalone 1–3 letter
 * uppercase abbreviations (e.g. "OK", "IF", "IK") as individual characters.
 * @param {string} text
 * @returns {string} SSML string wrapped in <speak> tags
 */
export function textToSsml(text) {
  // Escape XML special characters first
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  // Wrap standalone 1–3 uppercase letter sequences in <say-as> tags.
  // Uses lookaround to match word boundaries correctly for non-ASCII
  // letters (Å, Ä, Ö, Æ, Ø, Ü) which JS \b does not treat as word chars.
  s = s.replace(/(^|[\s,])([A-ZÅÄÖÆØÜ]{1,3})(?=[\s,.:;!?]|$)/g,
    '$1<say-as interpret-as="characters">$2</say-as>');

  return `<speak>${s}</speak>`;
}

/** Map speechLang codes to Google Cloud TTS Chirp3-HD voice names.
 *  Chirp3-HD voices are multi-lingual; the same persona works across languages.
 */
export const VOICE_MAP = {
  'sv-SE':  { name: 'sv-SE-Chirp3-HD-Erinome' },
  'en-GB':  { name: 'en-GB-Chirp3-HD-Erinome' },
  'en-US':  { name: 'en-US-Chirp3-HD-Erinome' },
  'nb-NO':  { name: 'nb-NO-Chirp3-HD-Erinome' },
  'da-DK':  { name: 'da-DK-Chirp3-HD-Erinome' },
  'fi-FI':  { name: 'fi-FI-Chirp3-HD-Erinome' },
  'de-DE':  { name: 'de-DE-Chirp3-HD-Erinome' },
  'fr-FR':  { name: 'fr-FR-Chirp3-HD-Erinome' },
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

  /**
   * Synthesize and play arbitrary text via Google TTS.
   * Useful for test/preview outside the event queue.
   * @param {string} text
   * @returns {Promise<void>}
   */
  async speakText(text) {
    const audioContent = await this.#synthesize(text);
    const blob = this.#base64ToBlob(audioContent, 'audio/mp3');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    audio.addEventListener('error', () => URL.revokeObjectURL(url));
    await audio.play();
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
    const text = buildSpeechText(evt, this.#settings.speechLang);

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
    const voiceConfig = VOICE_MAP[lang] ?? { name: `${lang}-Chirp3-HD-Erinome` };

    const ssml = textToSsml(text);

    const body = {
      input: { ssml },
      voice: {
        languageCode: lang,
        name: voiceConfig.name,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.25, Math.min(4.0, this.#settings.speechRate ?? 1.1)),
      },
    };

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
