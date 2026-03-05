/**
 * AudioNotifier — plays a synthesised chime via Web Audio API.
 * Zero dependencies, no external files.
 * @module audio-notifier
 */

const DEBOUNCE_MS = 300;

export default class AudioNotifier {

  /** @type {AudioContext|null} */
  #ctx = null;

  /** @type {boolean} */
  #unlocked = false;

  /** @type {boolean} */
  #muted = false;

  /** @type {number} */
  #lastChimeAt = 0;

  constructor() {
    // Attach a one-time user-gesture handler to unlock AudioContext
    const unlock = () => {
      if (!this.#ctx) this.#ctx = new AudioContext();
      if (this.#ctx.state === 'suspended') this.#ctx.resume();
      this.#unlocked = true;
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click', unlock, { once: false });
    document.addEventListener('touchstart', unlock, { once: false });
  }

  /**
   * Play a short chime. No-op if muted, not unlocked, or debounced.
   */
  chime() {
    if (this.#muted) return;
    if (!this.#unlocked || !this.#ctx) return;

    const now = performance.now();
    if (now - this.#lastChimeAt < DEBOUNCE_MS) return;
    this.#lastChimeAt = now;

    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 880; // A5

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  }

  /**
   * Toggle mute state.
   * @returns {boolean} the new muted state
   */
  toggleMute() {
    this.#muted = !this.#muted;
    return this.#muted;
  }

  /** @type {boolean} */
  get muted() {
    return this.#muted;
  }
}
