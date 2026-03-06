# Demo Mode

Introduction of a demo mode should have as little as possible impact on the code base. To achieve this the following solution is suggested.

To be able to have demo mode, the app needs to have the same opinion about the time and we need to be able to manipulate the time in one place without affecting the complete code base.

## Activation

Demo mode is activated via a URL query parameter:

```
index.html?demo           → demo mode with default speed (10×)
index.html?demo&speed=20  → demo mode with 20× playback speed
```

No UI changes are required to enter demo mode.

## Implementation

### Time Handling — `js/clock.js`

Instead of using `Date.now()` and `new Date()` everywhere in the code base, introduce a centralised clock module that all other modules import.

```javascript
// js/clock.js
let _offset = 0; // ms offset from real time

/** @returns {number} milliseconds since epoch */
export function getNow() {
  return Date.now() + _offset;
}

/** @returns {Date} */
export function getDate() {
  return new Date(getNow());
}

/** Set the simulated time to a specific ms timestamp */
export function setNow(timestampMs) {
  _offset = timestampMs - Date.now();
}

/** Reset to real time */
export function resetClock() {
  _offset = 0;
}
```

In normal mode `_offset` is `0` and the functions behave identically to `Date.now()` / `new Date()`. In demo mode, `setNow()` is called to shift the application's clock to match the recorded data timestamps.

#### Modules that must replace `Date.now()` / `new Date()` with `getNow()` / `getDate()`

| Module | Change |
|---|---|
| `js/event-detector.js` | `Date.now()` → `getNow()` |
| `js/prediction-engine.js` | `Date.now()` → `getNow()` |
| `js/connection-monitor.js` | `Date.now()` and `new Date()` → `getNow()` / `getDate()` |
| `js/setup-wizard.js` | `new Date()` for date filtering → `getDate()` |
| `js/predictions-panel.js` | `Date.now()` for overdue check → `getNow()` |
| `js/app.js` | Detection of `?demo` parameter; swap `ApiClient` for `DemoApiClient` |

No changes are required to `js/api-client.js`, `js/audio-notifier.js`, `js/settings-manager.js`, `js/runner-state-store.js`, `js/latest-events-panel.js`.

`js/polling-scheduler.js` gains one new method `setCycleMs(ms)` to support compressed polling cycles in demo mode.

### Recorded Data Format

Pre-recorded API responses are stored under `./data/{competitionId}/classresults/{class}/data_YYYY-MM-DD_HH:MM:SS_{None (for baseline) or part-of-hash (for update)}`.

#### Manifest (`manifest.json`)

Each competition has a **manifest file** that describes all available data and their replay order. Timeline entries reference individual files by path:

```json
// data/35680/manifest.json
{
  "competitionId": 35680,
  "competitionName": "Demo Competition",
  "date": "2024-11-15",
  "classes": ["H21", "D21", "H16"],
  "clubs": ["OK Linné", "IFK Göteborg"],
  "timeline": [
    { "timestamp": 1770454975000, "class": "D12", "file": "classresults/D12/data_2026-02-07_10:02:55_none.json" },
    { "timestamp": 1770455006000, "class": "D12", "file": "classresults/D12/data_2026-02-07_10:03:26_78a41c27.json" },
    { "timestamp": 1770455007000, "class": "H17-20", "file": "classresults/H17-20/data_2026-02-07_10:03:27_3a88d667.json" }
  ]
}
```

#### Gzipped Bundle (`bundle.json.gz`)

For efficient loading (avoiding thousands of individual HTTP requests), the data can also be served as a single **gzipped bundle**. The bundle has the same structure as the manifest, but timeline entries contain inline `data` instead of `file` references:

```json
// data/35680/bundle.json.gz (gzipped JSON)
{
  "competitionId": 35680,
  "competitionName": "Demo Competition",
  "date": "2024-11-15",
  "classes": ["H21", "D21", "H16"],
  "clubs": ["OK Linné", "IFK Göteborg"],
  "timeline": [
    { "timestamp": 1770454975000, "class": "D12", "data": { "className": "D12", "splitcontrols": [...], "results": [...] } },
    { "timestamp": 1770455006000, "class": "D12", "data": { "className": "D12", "splitcontrols": [...], "results": [...] } }
  ]
}
```

The bundle is decompressed in the browser using the `DecompressionStream` API (Chrome 80+, Firefox 113+, Safari 16.4+). For the test dataset (7,676 entries, 20 classes), the bundle compresses from ~302 MB to ~36 MB (88% reduction).

#### Format Details

- **`timestamp`** — Unix epoch in milliseconds. Wall-clock time at which the response was originally captured.
- **`file`** — (Manifest only) Relative path to the JSON file containing the full `getClassResults` response.
- **`data`** — (Bundle only) The inner response object (className, splitcontrols, results, hash).
- **`timeline`** — Ordered chronologically. This is the master sequence for replay.

The manifest eliminates the need for filesystem listing (which is impossible from a browser) and makes the replay order unambiguous.

#### Generation

```bash
# Manifest only
python3 scripts/generate-manifest.py data/35680 --name "My Competition (Demo)"

# Manifest + gzipped bundle
python3 scripts/generate-manifest.py data/35680 --name "My Competition (Demo)" --bundle
```

### Demo API Client — `js/demo-api-client.js`

A `DemoApiClient` class implements the same public interface as `ApiClient` but reads from pre-recorded data. The `PollingScheduler` does not need to change — it calls the same API interface.

Two static factory methods handle the two loading modes:

```javascript
// Preferred: load from gzipped bundle (single request, all data in memory)
const api = await DemoApiClient.fromBundle('data/35680/bundle.json.gz', speed);

// Fallback: load manifest, fetch individual files during playback
const api = await DemoApiClient.fromManifest('data/35680/manifest.json', 'data/35680', speed);
```

In bundle mode, `getClassResults()` returns data directly from memory. In manifest mode, each call fetches the individual JSON file. The public interface is identical in both modes.

### Wiring in `js/app.js`

The orchestrator detects the query parameter and tries to load demo data with a bundle-first strategy:

```javascript
// In App.init()
if (demoMode) {
  try {
    apiClient = await DemoApiClient.fromBundle('data/35680/bundle.json.gz', speed);
  } catch (bundleErr) {
    console.warn('Bundle load failed, trying manifest fallback:', bundleErr.message);
    try {
      apiClient = await DemoApiClient.fromManifest('data/35680/manifest.json', 'data/35680', speed);
    } catch (manifestErr) {
      console.error('Demo mode failed:', manifestErr);
      // Fall back to live mode
    }
  }
}
```

The bundle path is attempted first (single 36 MB gzipped download, decompressed in-browser). If that fails (e.g. bundle not present, or `DecompressionStream` not supported), it falls back to the manifest with per-file fetches.

### Playback Speed

In demo mode, the polling scheduler runs with a compressed cycle time: `15000 / speed` ms instead of 15 000 ms. At the default speed of 10×, a full poll cycle takes 1.5 s. A 3-hour competition replays in approximately 18 minutes.

The clock module advances based on the timestamps in the recorded data (via `setNow()`), so all time-dependent logic (prediction expiry, overdue checks, connection monitor age) operates correctly in compressed time.

### End-of-Demo Behaviour

When all timeline entries have been served (`DemoApiClient.isComplete === true`), the system continues polling but `getClassResults` returns `null` for every class. The display holds the final state — all events and predictions remain visible. No special "demo complete" message is shown; the application simply stabilises.

Optionally, a **loop** mode could be added in the future by resetting `_timelineIndex` to `0` and clearing the `RunnerStateStore`.

### Setup Wizard in Demo Mode

When in demo mode, the setup wizard's competition step only shows the competitions from the manifest (i.e., the single demo competition). The classes and clubs steps are populated from the manifest's `classes` and `clubs` arrays. This prevents the wizard from making real API calls.

## Summary of Changes

| Item | Type | Description |
|---|---|---|
| `js/clock.js` | **New file** | Centralised time functions (`getNow`, `getDate`, `setNow`, `resetClock`) |
| `js/demo-api-client.js` | **New file** | Pre-recorded data API client with `fromBundle()` and `fromManifest()` factory methods |
| `data/{compId}/manifest.json` | **New file** | Manifest describing recorded data and replay timeline (file references) |
| `data/{compId}/bundle.json.gz` | **New file** | Gzipped JSON bundle with inline data (~36 MB for 7,676 entries) |
| `scripts/generate-manifest.py` | **New file** | Script to generate manifest and optional gzipped bundle from recorded data |
| `css/styles.css` | Modified | Added `.demo-controls` styles |
| `js/app.js` | Modified | Detect `?demo` param, bundle-first loading with manifest fallback, demo controls UI |
| `js/event-detector.js` | Modified | `Date.now()` → `getNow()` |
| `js/prediction-engine.js` | Modified | `Date.now()` / `new Date()` → `getNow()` / `getDate()` |
| `js/connection-monitor.js` | Modified | `Date.now()` / `new Date()` → `getNow()` / `getDate()` |
| `js/setup-wizard.js` | Modified | `new Date()` → `getDate()` for date filtering |
| `js/predictions-panel.js` | Modified | `Date.now()` → `getNow()` for overdue check |
| `js/polling-scheduler.js` | Modified | Added `setCycleMs()` for configurable cycle duration |

All modifications to existing files are mechanical `Date.now()` → `getNow()` replacements plus one new method on `PollingScheduler`. The `RunnerStateStore`, `ApiClient`, `AudioNotifier`, `SettingsManager`, and `LatestEventsPanel` remain untouched.
