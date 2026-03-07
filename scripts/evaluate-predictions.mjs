#!/usr/bin/env node
/**
 * Evaluate prediction engine accuracy against recorded competition data.
 *
 * Replays the recorded timeline through the ACTUAL PredictionEngine and
 * RunnerStateStore modules, then compares predictions against known outcomes.
 *
 * Usage:
 *   node scripts/evaluate-predictions.mjs [data/35680] [--top-n 4]
 *
 * The script:
 *   1. Builds "ground truth" — the actual wall-clock time each runner reaches each control
 *   2. Replays the timeline chronologically, feeding data to the real store & predictor
 *   3. Captures every prediction the engine generates
 *   4. Compares predicted times to actual times
 *   5. Prints a detailed accuracy report
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Polyfill localStorage (required by SettingsManager) ─────────────────────
// Must be set before importing SettingsManager, but ES import hoisting makes
// static imports run first. So we set it here — globalThis assignment IS
// evaluated before the module-level code of the imported modules executes
// their *constructor* calls (imports just define bindings, constructors are
// called later). However, SettingsManager accesses localStorage in its
// constructor, which we call explicitly, so this works fine.
const _store = {};
globalThis.localStorage = {
  getItem:    (k) => _store[k] ?? null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
  clear:      () => { for (const k of Object.keys(_store)) delete _store[k]; },
};

// ─── Resolve project root ────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');

// ─── Import actual application modules ───────────────────────────────────────
import { setNow, getNow } from '../js/clock.js';
import RunnerStateStore  from '../js/runner-state-store.js';
import PredictionEngine  from '../js/prediction-engine.js';
import SettingsManager   from '../js/settings-manager.js';

// ─── CLI argument parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
let compDir = path.join(ROOT, 'data', '35680');
let topN = 4;
let verbose = false;
let algorithm = 'both';  // 'fastest', 'median', or 'both'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top-n' && args[i + 1]) {
    topN = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--algorithm' && args[i + 1]) {
    algorithm = args[i + 1];
    i++;
  } else if (args[i] === '--verbose' || args[i] === '-v') {
    verbose = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Usage: node scripts/evaluate-predictions.mjs [comp-dir] [options]

Arguments:
  comp-dir          Path to competition data dir (default: data/35680)

Options:
  --top-n <N>       Top-N runners to track (default: 4)
  --algorithm <a>   Algorithm: fastest, median, or both (default: both)
  --verbose, -v     Show per-prediction details
  --help, -h        Show this help
`);
    process.exit(0);
  } else if (!args[i].startsWith('--')) {
    compDir = path.resolve(args[i]);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a formatted time string ("MM:SS" or "H:MM:SS") to centiseconds.
 * Returns original value if not parseable.
 */
function parseFormattedResult(result) {
  if (typeof result === 'number') return result;
  if (!result || typeof result !== 'string') return result;
  if (/^[a-z]/i.test(result)) return result;        // "mp", "dns", etc.
  if (/^\d+$/.test(result)) return Number(result);   // already centiseconds

  const parts = result.split(':').map(Number);
  if (parts.some(Number.isNaN)) return result;

  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 100;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 100;
  return result;
}

/**
 * Preprocess raw API results: convert formatted `result` strings to cs
 * so PredictionEngine's Number(r.result) works for finish predictions.
 */
function preprocessResults(results) {
  if (!results) return results;
  for (const r of results) {
    if (r.result != null) {
      r.result = parseFormattedResult(r.result);
    }
  }
  return results;
}

/** Get midnight epoch ms for a date string like "2026-02-07". */
function midnightMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** Format seconds as human-readable "Xm YYs". */
function fmtSec(totalSec) {
  const absSec = Math.abs(totalSec);
  const m = Math.floor(absSec / 60);
  const s = Math.round(absSec % 60);
  const sign = totalSec < 0 ? '-' : '';
  return m > 0 ? `${sign}${m}m ${String(s).padStart(2, '0')}s` : `${sign}${s}s`;
}

function percentStr(n, total) {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '  0.0%';
}

function pad(str, len) { return String(str).padEnd(len); }
function rpad(str, len) { return String(str).padStart(len); }

function hhmmss(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Load manifest and build ground truth (shared across algorithm runs).
 */
function loadGroundTruth(compDir) {
  const manifestPath = path.join(compDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const midnight = midnightMs(manifest.date);

  /** @type {Map<string, number>} "runner|club|controlName" → actual wall-clock ms */
  const groundTruth = new Map();
  /** @type {Map<string, string>} "className|runner|club" → final status label */
  const runnerFinalStatus = new Map();

  const statusLabels = {
    0: 'OK', 1: 'DNS', 2: 'DNF', 3: 'MP', 4: 'DSQ',
    5: 'OT', 9: 'running', 10: 'not started', 11: 'WO', 12: 'moved up',
  };

  const lastFilePerClass = new Map();
  for (const entry of manifest.timeline) {
    lastFilePerClass.set(entry.class, entry.file);
  }

  let totalRunners = 0;
  let finishedRunners = 0;

  for (const [className, relFile] of lastFilePerClass) {
    const filePath = path.join(compDir, relFile);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const response = raw.response ?? raw;
    const controls = response.splitcontrols ?? [];
    const results = response.results ?? [];

    preprocessResults(results);

    for (const r of results) {
      const key = `${r.name}|${r.club}`;
      totalRunners++;

      runnerFinalStatus.set(
        `${className}|${key}`,
        statusLabels[r.status] ?? `status=${r.status}`
      );

      const start = r.start ?? 0;

      for (const ctrl of controls) {
        const splitTime = r.splits?.[String(ctrl.code)];
        const splitStatus = r.splits?.[`${ctrl.code}_status`];
        if (typeof splitTime === 'number' && splitTime > 0 && splitStatus === 0) {
          const actualMs = midnight + ((start + splitTime) / 100) * 1000;
          groundTruth.set(`${key}|${ctrl.name}`, actualMs);
        }
      }

      if (r.status === 0 && r.result) {
        const resultCs = typeof r.result === 'number' ? r.result : Number(r.result);
        if (!Number.isNaN(resultCs) && resultCs > 0) {
          const actualMs = midnight + ((start + resultCs) / 100) * 1000;
          groundTruth.set(`${key}|Finish`, actualMs);
          finishedRunners++;
        }
      }
    }
  }

  return { manifest, groundTruth, runnerFinalStatus, totalRunners, finishedRunners };
}

/**
 * Pre-load and preprocess all timeline data files (shared across runs).
 */
function loadTimelineData(compDir, manifest) {
  const timelineData = [];
  for (const entry of manifest.timeline) {
    const filePath = path.join(compDir, entry.file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const response = raw.response ?? raw;
    preprocessResults(response.results);
    timelineData.push({ timestamp: entry.timestamp, className: entry.class, response });
  }
  return timelineData;
}

/**
 * Replay the timeline with a given algorithm and capture predictions.
 * Returns { predRecords, entriesProcessed }.
 */
function replayTimeline(timelineData, manifest, algorithmName) {
  const settings = new SettingsManager();
  settings.set('compId', manifest.competitionId);
  settings.set('topN', topN);
  settings.set('maxPredictions', 99999);
  settings.set('followedClasses', null);
  settings.set('followedClubs', []);
  settings.set('predictionAlgorithm', algorithmName);

  const store     = new RunnerStateStore();
  const predictor = new PredictionEngine({ store, settings });

  /** @type {Map<string, Object>} */
  const predRecords = new Map();
  let entriesProcessed = 0;
  const progressInterval = Math.max(1, Math.floor(timelineData.length / 20));

  for (const entry of timelineData) {
    setNow(entry.timestamp);

    store.updateClass(entry.className, entry.response.splitcontrols, entry.response.results);
    predictor.updatePredictions(entry.className);

    const preds = predictor.getPredictions();

    for (const p of preds) {
      const existing = predRecords.get(p.id);
      if (!existing) {
        predRecords.set(p.id, {
          id:                 p.id,
          className:          p.className,
          runner:             p.runner,
          club:               p.club,
          targetControlName:  p.targetControlName,
          targetControlCode:  p.targetControlCode,
          firstPredictedMs:   p.predictedTimeMs,
          lastPredictedMs:    p.predictedTimeMs,
          firstSeenAt:        getNow(),
          lastSeenAt:         getNow(),
          updateCount:        1,
          referenceRunner:    p.referenceRunner,
          confidence:         p.confidence,
        });
      } else {
        existing.lastPredictedMs  = p.predictedTimeMs;
        existing.lastSeenAt       = getNow();
        existing.updateCount++;
        existing.referenceRunner  = p.referenceRunner;
        existing.confidence       = p.confidence;
      }
    }

    entriesProcessed++;
    if (entriesProcessed % progressInterval === 0) {
      const pct = ((entriesProcessed / timelineData.length) * 100).toFixed(0);
      process.stdout.write(`\r  [${algorithmName}] Progress: ${pct}% (${entriesProcessed}/${timelineData.length}) — ${predRecords.size} predictions`);
    }
  }

  process.stdout.write('\r');
  console.log(`  [${algorithmName}] Completed: ${entriesProcessed} entries, ${predRecords.size} unique predictions captured`);

  return { predRecords, entriesProcessed };
}

/**
 * Evaluate predictions against ground truth, return structured results.
 */
function evaluate(predRecords, groundTruth, runnerFinalStatus) {
  const fulfilled = [];
  const unfulfilled = [];
  const splitPreds = [];
  const finishPreds = [];

  for (const rec of predRecords.values()) {
    const gtKey = `${rec.runner}|${rec.club}|${rec.targetControlName}`;
    const actualMs = groundTruth.get(gtKey);

    if (actualMs != null) {
      const errorMs     = rec.lastPredictedMs - actualMs;
      const firstErrorMs = rec.firstPredictedMs - actualMs;
      const entry = {
        record: rec, actualMs,
        errorMs, firstErrorMs,
        absErrorMs: Math.abs(errorMs),
        absFirstErrorMs: Math.abs(firstErrorMs),
      };
      fulfilled.push(entry);

      if (rec.targetControlName === 'Finish') {
        finishPreds.push(entry);
      } else {
        splitPreds.push(entry);
      }
    } else {
      const statusKey = `${rec.className}|${rec.runner}|${rec.club}`;
      const status = runnerFinalStatus.get(statusKey) ?? 'unknown';
      unfulfilled.push({ record: rec, reason: status });
    }
  }

  const n = fulfilled.length;
  if (n === 0) return { fulfilled, unfulfilled, splitPreds, finishPreds, metrics: null };

  const absErrors    = fulfilled.map(f => f.absErrorMs / 1000).sort((a, b) => a - b);
  const signedErrors = fulfilled.map(f => f.errorMs / 1000);
  const absFirstErrs = fulfilled.map(f => f.absFirstErrorMs / 1000);

  const mean     = absErrors.reduce((a, b) => a + b, 0) / n;
  const median   = absErrors[Math.floor(n / 2)];
  const p90      = absErrors[Math.floor(n * 0.9)];
  const p95      = absErrors[Math.floor(n * 0.95)];
  const maxErr   = absErrors[n - 1];
  const meanSigned = signedErrors.reduce((a, b) => a + b, 0) / n;
  const meanFirst  = absFirstErrs.reduce((a, b) => a + b, 0) / n;
  const within30s  = absErrors.filter(e => e <= 30).length;
  const within1m   = absErrors.filter(e => e <= 60).length;
  const within2m   = absErrors.filter(e => e <= 120).length;
  const within5m   = absErrors.filter(e => e <= 300).length;
  const within10m  = absErrors.filter(e => e <= 600).length;

  return {
    fulfilled, unfulfilled, splitPreds, finishPreds,
    metrics: { mean, median, p90, p95, maxErr, meanSigned, meanFirst,
               within30s, within1m, within2m, within5m, within10m, n },
  };
}
/**
 * Print the detailed report for a single algorithm run.
 */
function printReport(algorithmName, { fulfilled, unfulfilled, splitPreds, finishPreds, metrics }, predRecords) {
  if (!metrics) {
    console.log(`  [${algorithmName}] No fulfilled predictions to evaluate.`);
    return;
  }
  const { mean, median, p90, p95, maxErr, meanSigned, meanFirst,
          within30s, within1m, within2m, within5m, within10m, n } = metrics;
  const total = predRecords.size;

  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│  SUMMARY                                                       │');
  console.log('├────────────────────────────────────────────────────────────────┤');
  console.log(`│  Total unique predictions:     ${rpad(total, 6)}                         │`);
  console.log(`│  Fulfilled (actual known):     ${rpad(fulfilled.length, 6)}                         │`);
  console.log(`│  Unfulfilled (no actual data): ${rpad(unfulfilled.length, 6)}                         │`);
  console.log(`│    ├─ Split predictions:       ${rpad(splitPreds.length, 6)}                         │`);
  console.log(`│    └─ Finish predictions:      ${rpad(finishPreds.length, 6)}                         │`);
  console.log('└────────────────────────────────────────────────────────────────┘');
  console.log('');

  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│  OVERALL ACCURACY (last prediction vs actual)                  │');
  console.log('├────────────────────────────────────────────────────────────────┤');
  console.log(`│  Mean absolute error:        ${pad(fmtSec(mean), 14)}                   │`);
  console.log(`│  Median absolute error:      ${pad(fmtSec(median), 14)}                   │`);
  console.log(`│  90th percentile:            ${pad(fmtSec(p90), 14)}                   │`);
  console.log(`│  95th percentile:            ${pad(fmtSec(p95), 14)}                   │`);
  console.log(`│  Max error:                  ${pad(fmtSec(maxErr), 14)}                   │`);
  console.log(`│  Mean signed error:          ${pad(fmtSec(meanSigned), 14)}                   │`);
  console.log(`│    (positive = predicted too late, negative = too early)        │`);
  console.log(`│                                                                │`);
  console.log(`│  Mean abs error (FIRST prediction): ${pad(fmtSec(meanFirst), 10)}               │`);
  console.log(`│  Improvement from refinement: ${pad(fmtSec(meanFirst - mean), 10)}                    │`);
  console.log('└────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Error distribution
  const buckets = [
    { label: '≤ 30s',     count: within30s },
    { label: '30s – 1m',  count: within1m - within30s },
    { label: '1m – 2m',   count: within2m - within1m },
    { label: '2m – 5m',   count: within5m - within2m },
    { label: '5m – 10m',  count: within10m - within5m },
    { label: '> 10m',     count: n - within10m },
  ];

  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│  ERROR DISTRIBUTION                                            │');
  console.log('├────────────────────────────────────────────────────────────────┤');
  for (const b of buckets) {
    const pct = percentStr(b.count, n);
    const barLen = Math.round((b.count / n) * 35);
    const bar = '█'.repeat(barLen) + '░'.repeat(35 - barLen);
    console.log(`│  ${pad(b.label, 10)} ${rpad(b.count, 4)}  ${rpad(pct, 6)}  ${bar} │`);
  }
  console.log(`├────────────────────────────────────────────────────────────────┤`);
  console.log(`│  Within 1 min: ${rpad(percentStr(within1m, n), 6)}    Within 2 min: ${rpad(percentStr(within2m, n), 6)}              │`);
  console.log(`│  Within 5 min: ${rpad(percentStr(within5m, n), 6)}    Within 10 min: ${rpad(percentStr(within10m, n), 6)}            │`);
  console.log('└────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Split vs Finish
  if (splitPreds.length > 0 || finishPreds.length > 0) {
    console.log('┌────────────────────────────────────────────────────────────────┐');
    console.log('│  SPLIT vs FINISH PREDICTIONS                                  │');
    console.log('├────────────────────────────────────────────────────────────────┤');

    for (const [label, items] of [['Split', splitPreds], ['Finish', finishPreds]]) {
      if (items.length === 0) continue;
      const errs = items.map(f => f.absErrorMs / 1000).sort((a, b) => a - b);
      const m   = errs.reduce((a, b) => a + b, 0) / errs.length;
      const med = errs[Math.floor(errs.length / 2)];
      const w1m = errs.filter(e => e <= 60).length;
      const w2m = errs.filter(e => e <= 120).length;
      console.log(`│  ${pad(label + ' predictions:', 22)} ${rpad(items.length, 5)}                           │`);
      console.log(`│    MAE: ${pad(fmtSec(m), 12)} Median: ${pad(fmtSec(med), 12)}                  │`);
      console.log(`│    Within 1 min: ${rpad(percentStr(w1m, items.length), 6)}   Within 2 min: ${rpad(percentStr(w2m, items.length), 6)}              │`);
    }

    console.log('└────────────────────────────────────────────────────────────────┘');
    console.log('');
  }

  // Per-class
  const byClass = new Map();
  for (const f of fulfilled) {
    const cn = f.record.className;
    if (!byClass.has(cn)) byClass.set(cn, []);
    byClass.get(cn).push(f);
  }

  const classRows = [...byClass.entries()]
    .map(([cn, entries]) => {
      const errs   = entries.map(f => f.absErrorMs / 1000).sort((a, b) => a - b);
      const signed = entries.map(f => f.errorMs / 1000);
      const mae  = errs.reduce((a, b) => a + b, 0) / errs.length;
      const med  = errs[Math.floor(errs.length / 2)];
      const w2m  = errs.filter(e => e <= 120).length;
      const ms   = signed.reduce((a, b) => a + b, 0) / signed.length;
      return { cn, count: entries.length, mae, med, w2m, ms };
    })
    .sort((a, b) => a.mae - b.mae);

  console.log('┌───────────────┬───────┬───────────┬───────────┬──────────┬────────────────┐');
  console.log('│ Class         │ Count │ MAE       │ Median    │ Within2m │ Mean Signed     │');
  console.log('├───────────────┼───────┼───────────┼───────────┼──────────┼────────────────┤');

  for (const row of classRows) {
    console.log(
      `│ ${pad(row.cn, 13)} │ ${rpad(row.count, 5)} │ ${pad(fmtSec(row.mae), 9)} │ ${pad(fmtSec(row.med), 9)} │ ${rpad(percentStr(row.w2m, row.count), 8)} │ ${pad(fmtSec(row.ms), 14)} │`
    );
  }

  console.log('└───────────────┴───────┴───────────┴───────────┴──────────┴────────────────┘');
  console.log('');

  // Worst 10
  const worst = [...fulfilled].sort((a, b) => b.absErrorMs - a.absErrorMs).slice(0, 10);

  console.log('┌─────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  TOP 10 WORST PREDICTIONS                                                           │');
  console.log('├───────────────┬──────────────────────┬──────────────┬──────────┬──────────┬─────────┤');
  console.log('│ Class         │ Runner               │ Target       │ Predict  │ Actual   │ Error   │');
  console.log('├───────────────┼──────────────────────┼──────────────┼──────────┼──────────┼─────────┤');

  for (const w of worst) {
    const errSec = w.errorMs / 1000;
    console.log(
      `│ ${pad(w.record.className, 13)} │ ${pad(w.record.runner.slice(0, 20), 20)} │ ${pad(w.record.targetControlName.slice(0, 12), 12)} │ ${hhmmss(w.record.lastPredictedMs)} │ ${hhmmss(w.actualMs)} │ ${pad(fmtSec(errSec), 7)} │`
    );
  }

  console.log('└───────────────┴──────────────────────┴──────────────┴──────────┴──────────┴─────────┘');
  console.log('');

  // Unfulfilled
  if (unfulfilled.length > 0) {
    const reasonCounts = new Map();
    for (const u of unfulfilled) {
      reasonCounts.set(u.reason, (reasonCounts.get(u.reason) || 0) + 1);
    }

    console.log('┌────────────────────────────────────────────────────────────────┐');
    console.log('│  UNFULFILLED PREDICTIONS (by runner final status)             │');
    console.log('├──────────────────┬─────────────────────────────────────────────┤');
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`│  ${pad(reason, 16)} │  ${rpad(count, 5)} predictions                            │`);
    }
    console.log('└──────────────────┴─────────────────────────────────────────────┘');
    console.log('');
  }

  // Verbose
  if (verbose && fulfilled.length > 0) {
    console.log('──── Per-prediction details (sorted by error) ────');
    const sorted = [...fulfilled].sort((a, b) => b.absErrorMs - a.absErrorMs);
    for (const f of sorted) {
      const r = f.record;
      console.log(
        `  ${pad(r.className, 10)} ${pad(r.runner, 20)} → ${pad(r.targetControlName, 12)}  ` +
        `predicted=${hhmmss(r.lastPredictedMs)}  actual=${hhmmss(f.actualMs)}  ` +
        `error=${fmtSec(f.errorMs / 1000)}  updates=${r.updateCount}  conf=${r.confidence}`
      );
    }
    console.log('');
  }

  console.log(`✓ [${algorithmName}] ${fulfilled.length} fulfilled predictions across ${byClass.size} classes.`);
  console.log(`  MAE: ${fmtSec(mean)}   Median: ${fmtSec(median)}   Within 2min: ${percentStr(within2m, n)}`);
  console.log('');
}

/**
 * Print side-by-side comparison of two algorithm results.
 */
function printComparison(resultA, resultB) {
  const mA = resultA.metrics;
  const mB = resultB.metrics;
  if (!mA || !mB) return;

  const delta = (a, b) => {
    const diff = b - a;
    const sign = diff < 0 ? '' : '+';
    return `${sign}${fmtSec(diff)}`;
  };

  const deltaPct = (a, b, nA, nB) => {
    const pctA = (a / nA) * 100;
    const pctB = (b / nB) * 100;
    const diff = pctB - pctA;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}pp`;
  };

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  HEAD-TO-HEAD COMPARISON:  fastest  vs  median                                  ║');
  console.log('╠══════════════════════════╦═══════════════╦═══════════════╦═══════════════════════╣');
  console.log('║  Metric                  ║    fastest    ║    median     ║   Δ (median-fastest)  ║');
  console.log('╠══════════════════════════╬═══════════════╬═══════════════╬═══════════════════════╣');

  const rows = [
    ['Predictions',         String(mA.n),                    String(mB.n),                    `${mB.n - mA.n}`],
    ['MAE',                 fmtSec(mA.mean),                 fmtSec(mB.mean),                 delta(mA.mean, mB.mean)],
    ['Median error',        fmtSec(mA.median),               fmtSec(mB.median),               delta(mA.median, mB.median)],
    ['P90',                 fmtSec(mA.p90),                  fmtSec(mB.p90),                  delta(mA.p90, mB.p90)],
    ['P95',                 fmtSec(mA.p95),                  fmtSec(mB.p95),                  delta(mA.p95, mB.p95)],
    ['Max error',           fmtSec(mA.maxErr),               fmtSec(mB.maxErr),               delta(mA.maxErr, mB.maxErr)],
    ['Mean signed error',   fmtSec(mA.meanSigned),           fmtSec(mB.meanSigned),           delta(mA.meanSigned, mB.meanSigned)],
    ['Within 30s',          percentStr(mA.within30s, mA.n),  percentStr(mB.within30s, mB.n),  deltaPct(mA.within30s, mB.within30s, mA.n, mB.n)],
    ['Within 1 min',        percentStr(mA.within1m, mA.n),   percentStr(mB.within1m, mB.n),   deltaPct(mA.within1m, mB.within1m, mA.n, mB.n)],
    ['Within 2 min',        percentStr(mA.within2m, mA.n),   percentStr(mB.within2m, mB.n),   deltaPct(mA.within2m, mB.within2m, mA.n, mB.n)],
    ['Within 5 min',        percentStr(mA.within5m, mA.n),   percentStr(mB.within5m, mB.n),   deltaPct(mA.within5m, mB.within5m, mA.n, mB.n)],
    ['Within 10 min',       percentStr(mA.within10m, mA.n),  percentStr(mB.within10m, mB.n),  deltaPct(mA.within10m, mB.within10m, mA.n, mB.n)],
  ];

  for (const [label, vA, vB, d] of rows) {
    console.log(`║  ${pad(label, 24)} ║  ${pad(vA, 12)} ║  ${pad(vB, 12)} ║  ${pad(d, 20)} ║`);
  }

  console.log('╚══════════════════════════╩═══════════════╩═══════════════╩═══════════════════════╝');

  // Split vs finish comparison
  const splitA  = resultA.splitPreds;
  const splitB  = resultB.splitPreds;
  const finA    = resultA.finishPreds;
  const finB    = resultB.finishPreds;

  const maeOf = (items) => {
    if (items.length === 0) return 0;
    return items.map(f => f.absErrorMs / 1000).reduce((a, b) => a + b, 0) / items.length;
  };
  const w2mOf = (items) => items.filter(f => f.absErrorMs / 1000 <= 120).length;

  console.log('');
  console.log('┌──────────────┬───────────────────────────┬───────────────────────────┐');
  console.log('│              │       fastest              │       median               │');
  console.log('│  Type        │  Count   MAE    Within2m  │  Count   MAE    Within2m  │');
  console.log('├──────────────┼───────────────────────────┼───────────────────────────┤');
  console.log(`│  Split       │  ${rpad(splitA.length, 5)}  ${pad(fmtSec(maeOf(splitA)), 7)} ${rpad(percentStr(w2mOf(splitA), splitA.length), 7)}  │  ${rpad(splitB.length, 5)}  ${pad(fmtSec(maeOf(splitB)), 7)} ${rpad(percentStr(w2mOf(splitB), splitB.length), 7)}  │`);
  console.log(`│  Finish      │  ${rpad(finA.length, 5)}  ${pad(fmtSec(maeOf(finA)), 7)} ${rpad(percentStr(w2mOf(finA), finA.length), 7)}  │  ${rpad(finB.length, 5)}  ${pad(fmtSec(maeOf(finB)), 7)} ${rpad(percentStr(w2mOf(finB), finB.length), 7)}  │`);
  console.log('└──────────────┴───────────────────────────┴───────────────────────────┘');

  // Per-class comparison
  const classesA = new Map();
  const classesB = new Map();
  for (const f of resultA.fulfilled) { if (!classesA.has(f.record.className)) classesA.set(f.record.className, []); classesA.get(f.record.className).push(f); }
  for (const f of resultB.fulfilled) { if (!classesB.has(f.record.className)) classesB.set(f.record.className, []); classesB.get(f.record.className).push(f); }

  const allClasses = new Set([...classesA.keys(), ...classesB.keys()]);

  console.log('');
  console.log('┌───────────────┬──────────────────────────┬──────────────────────────┬────────────┐');
  console.log('│               │       fastest             │       median              │            │');
  console.log('│ Class         │  Count   MAE     Median   │  Count   MAE     Median   │  MAE Δ     │');
  console.log('├───────────────┼──────────────────────────┼──────────────────────────┼────────────┤');

  const classCompRows = [...allClasses].map(cn => {
    const a = classesA.get(cn) ?? [];
    const b = classesB.get(cn) ?? [];
    const maeA = maeOf(a);
    const maeB = maeOf(b);
    const medA = a.length ? a.map(f => f.absErrorMs / 1000).sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
    const medB = b.length ? b.map(f => f.absErrorMs / 1000).sort((x, y) => x - y)[Math.floor(b.length / 2)] : 0;
    return { cn, cntA: a.length, maeA, medA, cntB: b.length, maeB, medB, d: maeB - maeA };
  }).sort((a, b) => a.d - b.d);

  for (const r of classCompRows) {
    const dStr = r.d < 0 ? fmtSec(r.d) : `+${fmtSec(r.d)}`;
    console.log(
      `│ ${pad(r.cn, 13)} │  ${rpad(r.cntA, 4)}  ${pad(fmtSec(r.maeA), 8)} ${pad(fmtSec(r.medA), 8)} │  ${rpad(r.cntB, 4)}  ${pad(fmtSec(r.maeB), 8)} ${pad(fmtSec(r.medB), 8)} │ ${pad(dStr, 10)} │`
    );
  }

  console.log('└───────────────┴──────────────────────────┴──────────────────────────┴────────────┘');

  // Winner summary
  const better = classCompRows.filter(r => r.d < 0).length;
  const worse  = classCompRows.filter(r => r.d > 0).length;
  const tied   = classCompRows.filter(r => r.d === 0).length;
  console.log('');
  console.log(`  Median wins: ${better} classes    Fastest wins: ${worse} classes    Tied: ${tied}`);
  console.log('');
}

function main() {
  const { manifest, groundTruth, runnerFinalStatus, totalRunners, finishedRunners } = loadGroundTruth(compDir);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          PREDICTION ENGINE EVALUATION REPORT                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Competition:  ${manifest.competitionName}`);
  console.log(`  Date:         ${manifest.date}`);
  console.log(`  Classes:      ${manifest.classes.length}`);
  console.log(`  Timeline:     ${manifest.timeline.length} entries`);
  console.log(`  Top-N:        ${topN}`);
  console.log(`  Algorithm:    ${algorithm}`);
  console.log('');

  console.log('Phase 1: Building ground truth from final snapshots...');
  console.log(`  Runners:       ${totalRunners} total, ${finishedRunners} finished`);
  console.log(`  Ground truth:  ${groundTruth.size} control passages + finishes`);
  console.log('');

  console.log('Phase 2: Loading timeline data...');
  const timelineData = loadTimelineData(compDir, manifest);
  console.log(`  Loaded ${timelineData.length} entries.`);
  console.log('');

  const algosToRun = algorithm === 'both' ? ['fastest', 'median'] : [algorithm];
  const results = {};

  for (const algo of algosToRun) {
    console.log(`════════════════════════════════════════════════════════════════`);
    console.log(`  Algorithm: ${algo.toUpperCase()}`);
    console.log(`════════════════════════════════════════════════════════════════`);
    console.log('');

    console.log(`Phase 3: Replaying timeline with "${algo}" algorithm...`);
    const { predRecords } = replayTimeline(timelineData, manifest, algo);
    console.log('');

    console.log(`Phase 4: Evaluating accuracy...`);
    console.log('');
    const result = evaluate(predRecords, groundTruth, runnerFinalStatus);
    results[algo] = result;
    results[algo].predRecords = predRecords;

    printReport(algo, result, predRecords);
  }

  if (algorithm === 'both' && results.fastest && results.median) {
    printComparison(results.fastest, results.median);
  }
}

main();
