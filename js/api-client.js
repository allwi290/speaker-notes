/**
 * ApiClient — HTTP layer for the liveresultat.orientering.se API.
 * Hash caching, circuit breaker, retry with backoff, response sanitization.
 * @module api-client
 */

const DEFAULT_BASE_URL = 'https://liveresultat.orientering.se/api.php';

const MAX_RETRIES      = 3;
const RETRY_DELAYS     = [1000, 2000, 4000];   // ms

const CB_FAILURE_THRESHOLD = 3;
const CB_OPEN_DURATION     = 30_000; // ms

/**
 * Replace control characters (0x00–0x1F) except HT, LF, CR with space.
 * @param {Uint8Array} bytes
 */
function sanitizeBytes(bytes) {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      bytes[i] = 0x20;
    }
  }
}

export default class ApiClient {

  /** @type {string} */
  #baseUrl;

  /** Hash cache: key → hash string */
  #hashes = new Map();

  /** Circuit breaker state */
  #cbState = 'closed';
  #cbFailures = 0;
  #cbOpenedAt = 0;

  /** Epoch ms of last data-bearing response */
  #lastDataTimestamp = 0;

  /**
   * @param {string} [baseUrl]
   */
  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.#baseUrl = baseUrl;
  }

  /* ------------------------------------------------------------------
   * Public API
   * ----------------------------------------------------------------*/

  /**
   * Fetch all competitions (no hash caching).
   * @returns {Promise<Array>}
   */
  async getCompetitions() {
    const params = new URLSearchParams({ method: 'getcompetitions' });
    const data = await this.#request(params, null);
    return data?.competitions ?? [];
  }

  /**
   * Fetch classes for a competition (hash-cached).
   * @param   {number} compId
   * @returns {Promise<Array|null>}  null = not modified
   */
  async getClasses(compId) {
    const hashKey = `classes:${compId}`;
    const params = new URLSearchParams({ method: 'getclasses', comp: String(compId) });
    const lastHash = this.#hashes.get(hashKey);
    if (lastHash) params.set('last_hash', lastHash);

    const data = await this.#request(params, hashKey);
    if (data === null) return null;

    if (data.hash) this.#hashes.set(hashKey, data.hash);
    return data.classes ?? [];
  }

  /**
   * Fetch results for one class (hash-cached, unformatted times).
   * @param   {number}  compId
   * @param   {string}  className
   * @param   {Object}  [options]
   * @param   {AbortSignal} [options.signal]
   * @returns {Promise<Object|null>}  null = not modified
   */
  async getClassResults(compId, className, options = {}) {
    const hashKey = `${compId}:${className}`;
    const params = new URLSearchParams({
      method: 'getclassresults',
      comp: String(compId),
      class: className,
      unformattedTimes: 'true',
    });
    const lastHash = this.#hashes.get(hashKey);
    if (lastHash) params.set('last_hash', lastHash);

    const data = await this.#request(params, hashKey, options.signal);
    if (data === null) return null;

    if (data.hash) this.#hashes.set(hashKey, data.hash);
    return data;
  }

  /** Epoch ms of the last successful data-bearing response. */
  get lastDataTimestamp() {
    return this.#lastDataTimestamp;
  }

  /** @returns {"closed"|"open"|"half-open"} */
  get circuitState() {
    if (this.#cbState === 'open') {
      if (Date.now() - this.#cbOpenedAt >= CB_OPEN_DURATION) {
        this.#cbState = 'half-open';
      }
    }
    return this.#cbState;
  }

  /* ------------------------------------------------------------------
   * Internal: fetch with retry, circuit breaker, sanitization
   * ----------------------------------------------------------------*/

  /**
   * @param {URLSearchParams} params
   * @param {string|null}     hashKey   — if non-null, check for NOT MODIFIED
   * @param {AbortSignal}     [signal]
   * @returns {Promise<Object|null>}
   */
  async #request(params, hashKey, signal) {
    // Circuit breaker check
    const state = this.circuitState;
    if (state === 'open') {
      throw new Error('Circuit breaker is open');
    }

    const url = `${this.#baseUrl}?${params.toString()}`;
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS.at(-1);
        await this.#sleep(delay, signal);
      }

      try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Read & sanitize
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        sanitizeBytes(bytes);
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        const data = JSON.parse(text);

        // NOT MODIFIED
        if (data.status === 'NOT MODIFIED') {
          this.#cbSuccess();
          return null;
        }

        // Successful data
        this.#lastDataTimestamp = Date.now();
        this.#cbSuccess();
        return data;

      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err;
      }
    }

    // All retries exhausted
    this.#cbFail();
    throw lastError;
  }

  /* --- Circuit breaker helpers --- */

  #cbSuccess() {
    this.#cbFailures = 0;
    this.#cbState = 'closed';
  }

  #cbFail() {
    this.#cbFailures++;
    if (this.#cbFailures >= CB_FAILURE_THRESHOLD) {
      this.#cbState = 'open';
      this.#cbOpenedAt = Date.now();
    }
  }

  /**
   * @param {number}       ms
   * @param {AbortSignal}  [signal]
   * @returns {Promise<void>}
   */
  #sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const id = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(id);
        reject(signal.reason);
      }, { once: true });
    });
  }
}
