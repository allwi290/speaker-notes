/**
 * Clock — centralised time functions for the application.
 *
 * In normal mode, behaves identically to Date.now() / new Date().
 * In demo mode, setNow() shifts the application clock to match
 * recorded data timestamps.
 *
 * @module clock
 */

/** @type {number} ms offset from real time */
let _offset = 0;

/**
 * Get the current application time in milliseconds since epoch.
 * @returns {number}
 */
export function getNow() {
  return Date.now() + _offset;
}

/**
 * Get a Date object representing the current application time.
 * @returns {Date}
 */
export function getDate() {
  return new Date(getNow());
}

/**
 * Set the simulated time to a specific ms timestamp.
 * @param {number} timestampMs — epoch milliseconds
 */
export function setNow(timestampMs) {
  _offset = timestampMs - Date.now();
}

/**
 * Reset to real time.
 */
export function resetClock() {
  _offset = 0;
}
