/**
 * PollingScheduler — staggers class-result requests across a 15-second window.
 * Pauses when the tab is hidden, resumes on visibility.
 * @module polling-scheduler
 */

const DEFAULT_CYCLE_MS = 15_000;

export default class PollingScheduler {

  /** @type {import('./api-client.js').default} */
  #api;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {((className: string, results: Object) => void)|null} */
  #onClassUpdate = null;

  /** @type {number[]} */
  #pendingTimeouts = [];

  /** @type {boolean} */
  #running = false;

  /** @type {boolean} */
  #paused = false;

  /** @type {string[]} */
  #classes = [];

  /** Cached class list from last successful resolve */
  #cachedClassList = [];

  /** Configurable cycle duration in ms */
  #cycleMs = DEFAULT_CYCLE_MS;

  /** Bound handler for cleanup */
  #visHandler;

  /**
   * @param {Object} deps
   * @param {import('./api-client.js').default}       deps.apiClient
   * @param {import('./settings-manager.js').default} deps.settings
   */
  constructor({ apiClient, settings }) {
    this.#api = apiClient;
    this.#settings = settings;

    this.#visHandler = () => {
      if (document.hidden) {
        this.#pause();
      } else if (this.#running) {
        this.#scheduleCycle();
      }
    };
  }

  /**
   * Begin the polling loop.
   * @param {(className: string, results: Object) => void} onClassUpdate
   */
  async start(onClassUpdate) {
    this.#onClassUpdate = onClassUpdate;
    this.#running = true;

    // Resolve class list
    this.#classes = await this.#resolveClasses();

    document.addEventListener('visibilitychange', this.#visHandler);
    this.#scheduleCycle();
  }

  /** Stop all polling. */
  stop() {
    this.#running = false;
    this.#clearTimeouts();
    document.removeEventListener('visibilitychange', this.#visHandler);
  }

  /** Re-read settings and restart. */
  async refresh() {
    this.stop();
    if (this.#onClassUpdate) {
      await this.start(this.#onClassUpdate);
    }
  }

  /**
   * Set the cycle duration in ms (useful for demo mode speed control).
   * Takes effect on the next cycle.
   * @param {number} ms
   */
  setCycleMs(ms) {
    this.#cycleMs = ms;
  }

  /** @returns {boolean} */
  get paused() {
    return this.#paused;
  }

  /** Pause the polling loop (keeps #running true so resume works). */
  pause() {
    this.#paused = true;
    this.#clearTimeouts();
  }

  /** Resume a paused polling loop. */
  resume() {
    if (!this.#paused) return;
    this.#paused = false;
    if (this.#running) {
      this.#scheduleCycle();
    }
  }

  /* ------------------------------------------------------------------
   * Internal
   * ----------------------------------------------------------------*/

  /**
   * Resolve followed classes (fetch if null = all).
   * @returns {Promise<string[]>}
   */
  async #resolveClasses() {
    const compId = this.#settings.compId;
    let classes = this.#settings.followedClasses;

    if (classes === null && compId) {
      const fetched = await this.#api.getClasses(compId);
      if (fetched) {
        classes = fetched.map(c => c.className);
      } else {
        // NOT MODIFIED — use cached list from previous resolve
        classes = this.#cachedClassList.length > 0 ? this.#cachedClassList : [];
      }
    }
    if (classes && classes.length > 0) {
      this.#cachedClassList = classes;
    }
    return classes ?? [];
  }

  /** Schedule one full cycle of requests using sequential chain. */
  #scheduleCycle() {
    this.#clearTimeouts();
    if (!this.#running || this.#classes.length === 0) return;

    const n = this.#classes.length;
    const cycle = this.#cycleMs;
    const delay = Math.floor(cycle / n);
    let i = 0;

    const next = () => {
      if (!this.#running || this.#paused || i >= n) {
        // All classes polled — schedule next cycle
        const remaining = Math.max(0, cycle - delay * n);
        const tid = setTimeout(() => this.#scheduleCycle(), remaining);
        this.#pendingTimeouts.push(tid);
        return;
      }
      const cls = this.#classes[i++];
      this.#pollClass(cls).finally(() => {
        if (!this.#running) return;
        const tid = setTimeout(next, delay);
        this.#pendingTimeouts.push(tid);
      });
    };

    next();
  }

  /**
   * @param {string} className
   */
  async #pollClass(className) {
    if (!this.#running) return;

    // Circuit breaker guard
    if (this.#api.circuitState === 'open') return;

    try {
      const compId = this.#settings.compId;
      if (!compId) return;

      const results = await this.#api.getClassResults(compId, className);
      if (results && this.#onClassUpdate) {
        this.#onClassUpdate(className, results);
      }
    } catch {
      // Errors handled by ApiClient circuit breaker / retry
    }
  }

  #pause() {
    this.#clearTimeouts();
  }

  #clearTimeouts() {
    for (const tid of this.#pendingTimeouts) {
      clearTimeout(tid);
    }
    this.#pendingTimeouts = [];
  }
}
