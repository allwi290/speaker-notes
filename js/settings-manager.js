/**
 * SettingsManager — persists user settings to localStorage.
 * @module settings-manager
 */

const STORAGE_KEY = 'speaker-notes-settings';

/** @type {Object<string, *>} */
const DEFAULTS = {
  compId: null,
  compName: null,
  followedClasses: null,   // null = all classes
  followedClubs: [],
  topN: 4,
  maxLatestEvents: 10,
  maxPredictions: 5,
  predictionAlgorithm: 'median',  // 'fastest' | 'median'
  speechLang: 'sv-SE',
  speechEnabled: false,
  speechRate: 1.1,
};

export default class SettingsManager {

  /** @type {Object<string, *>} */
  #data;

  /** @type {Map<string, Set<Function>>} */
  #listeners = new Map();

  constructor() {
    this.#data = this.#load();
  }

  /**
   * Get a setting value.
   * @param   {string} key
   * @returns {*}
   */
  get(key) {
    return this.#data[key];
  }

  /**
   * Set a setting value (persists immediately).
   * @param {string} key
   * @param {*}      value
   */
  set(key, value) {
    this.#data[key] = value;
    this.#persist();
    this.#notify(key, value);
  }

  /**
   * Subscribe to changes for a specific key.
   * @param   {string}              key
   * @param   {(value: *) => void}  callback
   * @returns {() => void}          unsubscribe function
   */
  onChange(key, callback) {
    if (!this.#listeners.has(key)) {
      this.#listeners.set(key, new Set());
    }
    this.#listeners.get(key).add(callback);
    return () => this.#listeners.get(key)?.delete(callback);
  }

  /**
   * Reset all settings to defaults and persist.
   */
  reset() {
    this.#data = { ...DEFAULTS };
    this.#persist();
    for (const [key, value] of Object.entries(this.#data)) {
      this.#notify(key, value);
    }
  }

  /* --- Convenience getters --- */

  get compId()          { return this.#data.compId; }
  get compName()        { return this.#data.compName; }
  get followedClasses() { return this.#data.followedClasses; }
  get followedClubs()   { return this.#data.followedClubs; }
  get topN()            { return this.#data.topN; }
  get maxLatestEvents() { return this.#data.maxLatestEvents; }
  get maxPredictions()  { return this.#data.maxPredictions; }
  get predictionAlgorithm() { return this.#data.predictionAlgorithm; }
  get speechLang()      { return this.#data.speechLang; }
  get speechRate()      { return this.#data.speechRate; }
  get speechEnabled()   { return this.#data.speechEnabled; }

  /* --- Private helpers --- */

  /** @returns {Object<string, *>} */
  #load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULTS, ...parsed };
      }
    } catch { /* corrupt data — fall through to defaults */ }
    return { ...DEFAULTS };
  }

  #persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#data));
  }

  /**
   * @param {string} key
   * @param {*}      value
   */
  #notify(key, value) {
    const cbs = this.#listeners.get(key);
    if (cbs) {
      for (const cb of cbs) {
        cb(value);
      }
    }
  }
}
