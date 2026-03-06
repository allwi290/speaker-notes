/**
 * DemoApiClient — pre-recorded data API client implementing the same
 * public interface as ApiClient. Loads demo data either from a gzipped
 * inline-data bundle (preferred) or from individual JSON files via a manifest.
 *
 * Use the static factory methods:
 *   await DemoApiClient.fromBundle('data/35680/bundle.json.gz', speed)
 *   await DemoApiClient.fromManifest('data/35680/manifest.json', 'data/35680', speed)
 *
 * @module demo-api-client
 */

import { getNow, setNow } from './clock.js';

export default class DemoApiClient {

  /** @type {Object} manifest/bundle with timeline */
  #manifest;

  /** @type {number} playback speed multiplier */
  #speed;

  /** @type {number} current position in the timeline */
  #timelineIndex = 0;

  /** @type {number|null} */
  #lastDataTimestamp = null;

  /** @type {number} */
  #lastApiTimestamp = 0;

  /** @type {boolean} true when timeline entries contain inline data */
  #bundleMode;

  /** @type {string|null} base directory for file fetches (manifest mode only) */
  #baseDir;

  /**
   * Always 'closed' — demo mode never has connection problems.
   * @type {"closed"}
   */
  circuitState = 'closed';

  /**
   * Use the static factory methods instead of calling the constructor directly.
   * @param {Object}  manifest
   * @param {Object}  opts
   * @param {number}  [opts.speed=10]
   * @param {boolean} [opts.bundleMode=false]
   * @param {string|null} [opts.baseDir=null]
   */
  constructor(manifest, { speed = 10, bundleMode = false, baseDir = null } = {}) {
    this.#manifest = manifest;
    this.#speed = speed;
    this.#bundleMode = bundleMode;
    this.#baseDir = baseDir;
  }

  /* ----------------------------------------------------------------
   * Factory methods
   * ----------------------------------------------------------------*/

  /**
   * Load from a gzipped bundle with inline data.
   * Uses the browser DecompressionStream API (Chrome 80+, Firefox 113+, Safari 16.4+).
   *
   * @param {string} url   — path to bundle.json.gz
   * @param {number} [speed=10]
   * @returns {Promise<DemoApiClient>}
   */
  static async fromBundle(url, speed = 10) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch bundle: ${resp.status}`);

    const ds = new DecompressionStream('gzip');
    const decompressed = resp.body.pipeThrough(ds);
    const text = await new Response(decompressed).text();
    const manifest = JSON.parse(text);

    return new DemoApiClient(manifest, { speed, bundleMode: true });
  }

  /**
   * Load from a manifest that references individual JSON files.
   * Falls back to per-file fetches during playback.
   *
   * @param {string} url      — path to manifest.json
   * @param {string} baseDir  — directory containing the class result files
   * @param {number} [speed=10]
   * @returns {Promise<DemoApiClient>}
   */
  static async fromManifest(url, baseDir, speed = 10) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch manifest: ${resp.status}`);

    const manifest = await resp.json();
    return new DemoApiClient(manifest, { speed, baseDir, bundleMode: false });
  }

  /* ----------------------------------------------------------------
   * Public interface (mirrors ApiClient)
   * ----------------------------------------------------------------*/

  /** @returns {Object} the loaded manifest/bundle metadata */
  get manifest() {
    return this.#manifest;
  }

  /** @returns {number|null} */
  get lastDataTimestamp() {
    return this.#lastDataTimestamp;
  }

  /** @returns {number} */
  get lastApiTimestamp() {
    return this.#lastApiTimestamp;
  }

  /** @returns {number} */
  get speed() {
    return this.#speed;
  }

  /** @param {number} s */
  set speed(s) {
    this.#speed = s;
  }

  /**
   * Return only the demo competition from the manifest.
   * @returns {Promise<Array>}
   */
  async getCompetitions() {
    return [{
      id:        this.#manifest.competitionId,
      name:      this.#manifest.competitionName,
      date:      this.#manifest.date,
      organizer: 'Demo',
    }];
  }

  /**
   * Return classes from the manifest.
   * @param {number} _compId
   * @returns {Promise<Array>}
   */
  async getClasses(_compId) {
    return this.#manifest.classes.map(c => ({ className: c }));
  }

  /**
   * Serve the next pre-recorded response for the requested class.
   *
   * In bundle mode, data is returned directly from memory (no network request).
   * In manifest mode, the individual file is fetched.
   *
   * @param {number}  compId
   * @param {string}  className
   * @param {Object}  [_options]
   * @returns {Promise<Object|null>}
   */
  async getClassResults(compId, className, _options = {}) {
    const entry = this.#findNextEntry(className);
    if (!entry) return null;

    let data;
    if (this.#bundleMode && entry.data) {
      // Inline data from bundle — zero network overhead
      data = entry.data;
    } else if (entry.file && this.#baseDir) {
      // Fetch individual file (manifest mode fallback)
      const url = `${this.#baseDir}/${entry.file}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`DemoApiClient: failed to fetch ${url}: ${resp.status}`);
        return null;
      }
      const raw = await resp.json();
      data = raw.response ?? raw;
    } else {
      return null;
    }

    // Advance the application clock to the recorded timestamp
    setNow(entry.timestamp);
    const now = getNow();
    this.#lastDataTimestamp = now;
    this.#lastApiTimestamp = now;

    return data;
  }

  /**
   * True when all timeline entries have been served.
   * @returns {boolean}
   */
  get isComplete() {
    return this.#timelineIndex >= this.#manifest.timeline.length;
  }

  /**
   * Current progress through the timeline (0..1).
   * @returns {number}
   */
  get progress() {
    const total = this.#manifest.timeline.length;
    return total > 0 ? this.#timelineIndex / total : 0;
  }

  /**
   * Reset playback to the beginning.
   */
  reset() {
    this.#timelineIndex = 0;
    this.#lastDataTimestamp = null;
    this.#lastApiTimestamp = 0;
  }

  /* ----------------------------------------------------------------
   * Internal
   * ----------------------------------------------------------------*/

  /**
   * Walk forward from the current timeline index to find the next
   * unserved entry for the given class.
   * @param {string} className
   * @returns {Object|null}
   */
  #findNextEntry(className) {
    const timeline = this.#manifest.timeline;
    for (let i = this.#timelineIndex; i < timeline.length; i++) {
      if (timeline[i].class === className) {
        this.#timelineIndex = i + 1;
        return timeline[i];
      }
    }
    return null;
  }
}
