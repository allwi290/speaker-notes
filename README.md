# Speaker Notes — Orienteering Live

A real-time display tool for orienteering event speakers. Shows the latest race events (split times, finishes, status changes) and predicts upcoming arrivals for top runners — all from [liveresultat.orientering.se](https://liveresultat.orientering.se).

## Features

- **Live event feed** — new split times, finishes, and status changes (DNF, DSQ, etc.) appear with animations
- **Arrival predictions** — estimates when top runners will reach the next radio control, using pace-ratio extrapolation
- **Club following** — highlight runners from specific clubs regardless of ranking
- **Audio chime** — plays a short tone when new events arrive
- **Connection monitor** — green/yellow/red indicator showing data freshness
- **Dark theme** — high-contrast design readable at 1 m+ on a Full HD display
- **Zero dependencies** — pure browser JavaScript, no build step, no npm packages

## How to Run

1. Serve the files with any static HTTP server:

   ```sh
   # Python
   python3 -m http.server 8080

   # Node
   npx serve .

   # Or any other static file server
   ```

2. Open `http://localhost:8080` in a browser.

3. The setup wizard walks you through:
   - Selecting today's competition
   - Choosing which classes to follow
   - Optionally adding clubs to highlight
   - Setting how many top runners to track per class (default: 4)

4. The live view starts automatically. Events and predictions update every ~15 seconds.

> **Note:** Opening `index.html` directly via `file://` will not work due to ES module CORS restrictions. You must use an HTTP server.

## Browser Requirements

- Any modern browser with ES module support (Chrome 61+, Firefox 60+, Safari 11+, Edge 79+)
- Web Audio API for the chime notification

## Architecture

The app is built as 12 ES modules with no external dependencies:

| Module | Purpose |
|--------|---------|
| `app.js` | Top-level orchestrator |
| `settings-manager.js` | localStorage persistence |
| `api-client.js` | HTTP client with hash caching, circuit breaker, retry |
| `runner-state-store.js` | In-memory state with change detection |
| `event-detector.js` | Filters changes into visible events (top-N + club rules) |
| `prediction-engine.js` | Pace-ratio arrival predictions |
| `polling-scheduler.js` | Staggered 15s polling loop |
| `setup-wizard.js` | Competition/class/club selection |
| `latest-events-panel.js` | Upper display panel |
| `predictions-panel.js` | Lower display panel |
| `connection-monitor.js` | Health indicator |
| `audio-notifier.js` | Web Audio chime |

See `docs/architecture.md` for the full design and `docs/components/` for per-module specifications.

## License

MIT
