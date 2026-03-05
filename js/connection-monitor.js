/**
 * ConnectionMonitor — real-time connection health indicator.
 * @module connection-monitor
 */

export default class ConnectionMonitor {

  /** @type {HTMLElement} */
  #container;

  /** @type {import('./api-client.js').default} */
  #apiClient;

  /** @type {number|null} */
  #intervalId = null;

  /** DOM refs */
  #dotEl;
  #lastDataEl;
  #clockEl;

  /**
   * @param {HTMLElement} containerEl
   * @param {import('./api-client.js').default} apiClient
   */
  constructor(containerEl, apiClient) {
    this.#container = containerEl;
    this.#apiClient = apiClient;
    this.#buildDOM();
  }

  /** Start the 1-second update loop. */
  start() {
    this.#tick(); // immediate first tick
    this.#intervalId = setInterval(() => this.#tick(), 1000);
  }

  /** Stop the update loop. */
  destroy() {
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
  }

  /* --- Private --- */

  #buildDOM() {
    this.#container.innerHTML = '';

    this.#dotEl = document.createElement('span');
    this.#dotEl.className = 'conn-monitor__dot conn-monitor__dot--red';

    this.#lastDataEl = document.createElement('span');
    this.#lastDataEl.className = 'conn-monitor__last-data';
    this.#lastDataEl.textContent = 'Last data: —';

    this.#clockEl = document.createElement('span');
    this.#clockEl.className = 'conn-monitor__clock';
    this.#clockEl.textContent = '00:00:00';

    this.#container.append(this.#dotEl, this.#lastDataEl, this.#clockEl);
  }

  #tick() {
    const now = Date.now();

    // Clock
    const d = new Date(now);
    this.#clockEl.textContent =
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

    // Connection status
    const lastTs = this.#apiClient.lastApiTimestamp;
    const age = lastTs ? now - lastTs : Infinity;

    // Dot colour
    this.#dotEl.className = 'conn-monitor__dot';
    if (age < 30_000) {
      this.#dotEl.classList.add('conn-monitor__dot--green');
    } else if (age < 90_000) {
      this.#dotEl.classList.add('conn-monitor__dot--yellow');
    } else {
      this.#dotEl.classList.add('conn-monitor__dot--red');
    }

    // Last data text
    if (this.#apiClient.lastDataTimestamp) {
      const ld = new Date(this.#apiClient.lastDataTimestamp);
      this.#lastDataEl.textContent =
        `Last data: ${String(ld.getHours()).padStart(2, '0')}:${String(ld.getMinutes()).padStart(2, '0')}:${String(ld.getSeconds()).padStart(2, '0')}`;
    } else {
      this.#lastDataEl.textContent = 'Last data: —';
    }
  }
}
