# ConnectionMonitor

## Purpose

Displays a real-time visual indicator of the connection health to the liveresultat API, plus timestamps for the last data received and the current browser time.

## Responsibilities

- Show a coloured status dot:
  - 🟢 **Green** — data received within the last 30 seconds
  - 🟡 **Yellow** — no data received for 30–90 seconds
  - 🔴 **Red** — no data received for 90+ seconds OR fetch errors
- Display **"Last data"** timestamp (updated on each successful API response)
- Display **current browser time** (updated every second via `setInterval`)
- Poll `ApiClient.lastDataTimestamp` to compute the colour
- Clean up the 1-second timer on `destroy()`

## Interface

```js
// js/connection-monitor.js
export default class ConnectionMonitor {

  /**
   * @param {HTMLElement} containerEl
   * @param {ApiClient}   apiClient
   */
  constructor(containerEl, apiClient)

  /**
   * Start the 1-second update loop.
   */
  start()

  /**
   * Stop the update loop.
   */
  destroy()
}
```

## DOM Structure

```html
<div id="connection-monitor" class="conn-monitor">
  <span class="conn-monitor__dot conn-monitor__dot--green"></span>
  <span class="conn-monitor__last-data">Last data: 14:32:57</span>
  <span class="conn-monitor__clock">14:33:02</span>
</div>
```

## CSS Classes

| Class | Purpose |
|---|---|
| `conn-monitor__dot--green` | Green indicator |
| `conn-monitor__dot--yellow` | Yellow indicator |
| `conn-monitor__dot--red` | Red indicator |

## Dependencies

| Module | Relationship |
|---|---|
| ApiClient | reads `lastDataTimestamp` |
