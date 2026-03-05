# AudioNotifier

## Purpose

Plays an audio chime when new events arrive, using the Web Audio API to avoid loading external sound files (zero dependencies, tiny footprint).

## Responsibilities

- Synthesise a short, pleasant chime using `OscillatorNode` and `GainNode`
- Require a user gesture before playing (browsers block autoplay); attach a one-time click/touch handler to unlock the `AudioContext`
- Debounce: if multiple events arrive in the same batch, play only **one** chime
- Expose a mute toggle (persisted via `SettingsManager` if desired)

## Interface

```js
// js/audio-notifier.js
export default class AudioNotifier {

  constructor()

  /**
   * Play a chime. No-op if muted or AudioContext not yet unlocked.
   */
  chime()

  /**
   * Toggle mute state.
   * @returns {boolean} new muted state
   */
  toggleMute()

  /**
   * @type {boolean}
   */
  get muted()
}
```

## Implementation Notes

```js
// Simplified chime implementation sketch
const ctx = new AudioContext();
const osc = ctx.createOscillator();
const gain = ctx.createGain();
osc.type = 'sine';
osc.frequency.value = 880;       // A5
gain.gain.setValueAtTime(0.3, ctx.currentTime);
gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
osc.connect(gain).connect(ctx.destination);
osc.start(ctx.currentTime);
osc.stop(ctx.currentTime + 0.5);
```

## Dependencies

| Module | Relationship |
|---|---|
| _none_ | standalone; uses Web Audio API |
