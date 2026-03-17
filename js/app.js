/**
 * App — top-level orchestrator that wires all modules together.
 * Supports both live and demo modes.
 * @module app
 */

import SettingsManager    from './settings-manager.js';
import ApiClient          from './api-client.js';
import DemoApiClient      from './demo-api-client.js';
import RunnerStateStore   from './runner-state-store.js';
import EventDetector, { formatTime, formatTimeplus } from './event-detector.js';
import PredictionEngine   from './prediction-engine.js';
import AudioNotifier      from './audio-notifier.js';
import LatestEventsPanel  from './latest-events-panel.js';
import PredictionsPanel   from './predictions-panel.js';
import ConnectionMonitor  from './connection-monitor.js';
import PollingScheduler   from './polling-scheduler.js';
import SetupWizard        from './setup-wizard.js';
import SpeechNotifier     from './speech-notifier.js';
import { getNow, setNow } from './clock.js';

/** Escape HTML entities. */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export default class App {

  /** @type {HTMLElement} */
  #root;

  // Modules
  #settings;
  #api;           // ApiClient or DemoApiClient — active client
  #liveApi;       // always the real ApiClient (for non-demo use)
  #store;
  #detector;
  #predictor;
  #notifier;
  #latestPanel;
  #predictionsPanel;
  #monitor;
  #scheduler;
  #wizard;
  #speech;

  /** Demo mode state */
  #demoMode = false;
  #demoSpeed = 10;
  #demoControls = null;

  /**
   * @param {HTMLElement} rootEl — <div id="app">
   */
  constructor(rootEl) {
    this.#root = rootEl;
    this.#settings = new SettingsManager();
    this.#liveApi  = new ApiClient();
    this.#api      = this.#liveApi;  // default; may be replaced in init()
    this.#store    = new RunnerStateStore();
    this.#detector = new EventDetector({ store: this.#store, settings: this.#settings });
    this.#predictor = new PredictionEngine({ store: this.#store, settings: this.#settings });
    this.#notifier = new AudioNotifier();
    this.#speech = new SpeechNotifier({ settings: this.#settings });

    this.#latestPanel = new LatestEventsPanel(
      rootEl.querySelector('#latest-events .panel__list')
    );
    this.#latestPanel.onClick = (evt) => this.#showRunnerModal(evt);
    this.#predictionsPanel = new PredictionsPanel(
      rootEl.querySelector('#predictions .panel__list')
    );
  }

  /** Bootstrap the application. */
  async init() {
    // Detect demo mode from URL
    const params = new URLSearchParams(location.search);
    this.#demoMode = params.has('demo');
    this.#demoSpeed = parseInt(params.get('speed') || '1', 10);

    if (this.#demoMode) {
      try {
        this.#api = await DemoApiClient.fromBundle('data/35680/bundle.json.gz', this.#demoSpeed);
        console.log('Demo: loaded from gzipped bundle');
      } catch (bundleErr) {
        console.warn('Bundle load failed, trying manifest fallback:', bundleErr.message);
        try {
          this.#api = await DemoApiClient.fromManifest('data/35680/manifest.json', 'data/35680', this.#demoSpeed);
          console.log('Demo: loaded from manifest (individual files)');
        } catch (manifestErr) {
          console.error('Demo mode failed entirely:', manifestErr);
          this.#demoMode = false;
          this.#api = this.#liveApi;
        }
      }

      // Set the application clock to the start of the recorded data so that
      // date filtering in the wizard matches the demo competition date
      if (this.#demoMode) {
        const tl = this.#api.manifest.timeline;
        if (tl && tl.length > 0) {
          setNow(tl[0].timestamp);
        }
      }
    }

    // Build modules that depend on the api client
    this.#monitor = new ConnectionMonitor(
      this.#root.querySelector('#connection-monitor'),
      this.#api
    );
    this.#scheduler = new PollingScheduler({
      apiClient: this.#api,
      settings:  this.#settings,
    });
    this.#wizard = new SetupWizard({
      containerEl: this.#root.querySelector('#setup-wizard'),
      apiClient:   this.#api,
      settings:    this.#settings,
    });

    this.#monitor.start();

    if (this.#demoMode) {
      this.#buildDemoControls();
      this.#showDemoControls();
    }

    // Audio toggle button
    const audioBtn = this.#root.querySelector('#audio-btn');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const muted = this.#notifier.toggleMute();
        audioBtn.textContent = muted ? '🔕' : '🔔';
        audioBtn.classList.toggle('app-header__btn--muted', muted);
        audioBtn.title = muted ? 'Unmute audio' : 'Mute audio';
      });
    }

    // Speech toggle button
    const speechBtn = this.#root.querySelector('#speech-btn');
    if (speechBtn) {
      speechBtn.addEventListener('click', () => {
        const muted = this.#speech.toggleMute();
        speechBtn.textContent = muted ? '🤐' : '🗣️';
        speechBtn.classList.toggle('app-header__btn--muted', muted);
        speechBtn.title = muted ? 'Enable speech' : 'Disable speech';
      });
    }

    // Fullscreen toggle button
    const fsBtn = this.#root.querySelector('#fullscreen-btn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
      document.addEventListener('fullscreenchange', () => {
        const isFs = !!document.fullscreenElement;
        fsBtn.textContent = isFs ? '⛶' : '⛶';
        fsBtn.title = isFs ? 'Exit fullscreen' : 'Enter fullscreen';
      });
    }

    // Settings button
    const settingsBtn = this.#root.querySelector('#settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.#scheduler.stop();
        this.#wizard.open(
          () => this.#onSetupComplete(),
          () => this.#startLive()
        );
      });
    }

    // Show empty panels
    this.#latestPanel.clear();
    this.#predictionsPanel.clear();

    // Decide: wizard or live
    if (!this.#settings.compId) {
      this.#wizard.open(() => this.#onSetupComplete());
    } else {
      this.#startLive();
    }
  }

  /** Tear down everything. */
  destroy() {
    this.#scheduler.stop();
    this.#monitor.destroy();
  }

  /* --- Private --- */

  #startLive() {
    this.#updateCompName();

    // In demo mode, compress the polling cycle
    if (this.#demoMode) {
      this.#scheduler.setCycleMs(Math.floor(15000 / this.#demoSpeed));
    }

    const onClassUpdate = (className, results) => {
      // 1. Update store & detect changes
      const changes = this.#store.updateClass(
        className,
        results.splitcontrols,
        results.results
      );

      // 2. Filter into visible events
      const newEvents = this.#detector.processChanges(changes, className);

      // 3. Update predictions
      this.#predictor.updatePredictions(className);

      // 4. Render
      this.#latestPanel.update(newEvents, this.#detector.getLatestEvents());
      this.#predictionsPanel.render(this.#predictor.getPredictions());

      // 5. Chime & speech
      if (newEvents.length > 0) {
        this.#notifier.chime();
        this.#speech.speak(newEvents);
      }

      // 6. Update demo progress if applicable
      if (this.#demoMode && this.#api instanceof DemoApiClient) {
        this.#updateDemoProgress(this.#api.progress, getNow());
        if (this.#api.isComplete) {
          this.#updateDemoStatus('Playback complete');
        }
      }
    };

    this.#scheduler.start(onClassUpdate)
      .catch(err => console.error('Failed to start polling:', err));
  }

  #onSetupComplete() {
    // Clear previous state
    this.#store.clear();
    this.#detector.clear();
    this.#predictor.clear();
    this.#latestPanel.clear();
    this.#predictionsPanel.clear();

    // Reset demo API client for fresh playback
    if (this.#demoMode && this.#api instanceof DemoApiClient) {
      this.#api.reset();
    }

    // Restart
    this.#scheduler.refresh()
      .catch(err => console.error('Failed to refresh scheduler:', err));
    this.#startLive();
  }

  #updateCompName() {
    const el = this.#root.querySelector('#comp-name');
    if (el) el.textContent = this.#settings.compName ? `— ${this.#settings.compName}` : '';
  }

  /* --- Runner detail modal --- */

  /**
   * @param {import('./event-detector.js').LatestEvent} evt
   */
  #showRunnerModal(evt) {
    const key = `${evt.runner}|${evt.club}`;
    const runner = this.#store.getRunner(evt.className, key);
    if (!runner) return;

    const controls = this.#store.getSplitControls(evt.className);
    const predictions = this.#predictor.getRunnerPredictions(evt.runner, evt.club);

    // Build modal
    const overlay = document.createElement('div');
    overlay.className = 'runner-modal';

    const dialog = document.createElement('div');
    dialog.className = 'runner-modal__dialog';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'runner-modal__close';
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Header
    const header = document.createElement('div');
    header.className = 'runner-modal__header';
    header.innerHTML = `
      <h2>${esc(runner.name)}</h2>
      <p>${esc(runner.club)} &middot; ${esc(evt.className)}</p>
      <p class="runner-modal__start">Start: ${formatTime(runner.start)}</p>
    `;

    // Splits table
    const table = document.createElement('table');
    table.className = 'runner-modal__splits';
    let thead = '<tr><th>Control</th><th>Time</th><th>+/-</th><th>Pos</th></tr>';
    table.innerHTML = `<thead>${thead}</thead>`;
    const tbody = document.createElement('tbody');

    for (const ctrl of controls) {
      const split = runner.splits.get(ctrl.code);
      if (!split || split.status !== 0 || split.time === 0) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(ctrl.name)}</td>
        <td>${formatTime(split.time)}</td>
        <td>${formatTimeplus(split.timeplus)}</td>
        <td>${esc(String(split.place ?? ''))}</td>
      `;
      tbody.appendChild(tr);
    }

    // Finish row
    if (runner.status === 0 && runner.result) {
      const tr = document.createElement('tr');
      tr.className = 'runner-modal__finish-row';
      tr.innerHTML = `
        <td><strong>Finish</strong></td>
        <td><strong>${formatTime(runner.result)}</strong></td>
        <td><strong>${formatTimeplus(runner.timeplus)}</strong></td>
        <td><strong>${esc(String(runner.place ?? ''))}</strong></td>
      `;
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);

    // Predictions section
    let predSection = '';
    if (predictions.length > 0) {
      const predRows = predictions.map(p =>
        `<tr><td>${esc(p.targetControlName)}</td><td>${esc(p.predictedTimeFormatted)}</td></tr>`
      ).join('');
      predSection = `
        <div class="runner-modal__predictions">
          <h3>Predictions</h3>
          <table class="runner-modal__splits">
            <thead><tr><th>Control</th><th>Predicted</th></tr></thead>
            <tbody>${predRows}</tbody>
          </table>
        </div>
      `;
    }

    dialog.append(closeBtn, header, table);
    if (predSection) {
      const tmp = document.createElement('div');
      tmp.innerHTML = predSection;
      dialog.appendChild(tmp.firstElementChild);
    }
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  /* --- Demo Controls --- */

  #buildDemoControls() {
    const bar = document.createElement('div');
    bar.id = 'demo-controls';
    bar.className = 'demo-controls';

    // Label
    const label = document.createElement('span');
    label.className = 'demo-controls__label';
    label.textContent = '🎬 DEMO';

    // Speed buttons
    const speedGroup = document.createElement('div');
    speedGroup.className = 'demo-controls__speeds';

    for (const speed of [1, 5, 10, 20, 50]) {
      const btn = document.createElement('button');
      btn.className = 'demo-controls__speed-btn';
      btn.dataset.speed = speed;
      btn.textContent = `×${speed}`;
      btn.addEventListener('click', () => {
        this.#demoSpeed = speed;
        if (this.#api instanceof DemoApiClient) {
          this.#api.speed = speed;
        }
        this.#updateSpeedButtons(speed);
        // Re-schedule polling with new speed
        this.#scheduler.setCycleMs(Math.floor(15000 / speed));
      });
      speedGroup.appendChild(btn);
    }

    // Pause button
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'demo-controls__pause-btn';
    pauseBtn.textContent = '⏸';
    pauseBtn.title = 'Pause demo';
    pauseBtn.addEventListener('click', () => this.#toggleDemoPause());

    // Progress bar
    const progressWrap = document.createElement('div');
    progressWrap.className = 'demo-controls__progress-wrap';

    const progressBar = document.createElement('div');
    progressBar.className = 'demo-controls__progress-bar';
    progressWrap.appendChild(progressBar);

    // Time display
    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'demo-controls__time';
    timeDisplay.textContent = '--:--:--';

    // Status
    const status = document.createElement('span');
    status.className = 'demo-controls__status';
    status.textContent = '';

    bar.append(label, pauseBtn, speedGroup, progressWrap, timeDisplay, status);

    // Insert after header
    const header = this.#root.querySelector('.app-header');
    if (header) {
      header.after(bar);
    } else {
      this.#root.prepend(bar);
    }

    this.#demoControls = { bar, pauseBtn, speedGroup, progressBar, timeDisplay, status };
  }

  #showDemoControls() {
    if (!this.#demoControls) return;
    this.#demoControls.bar.style.display = 'flex';
    this.#updateSpeedButtons(this.#demoSpeed);
  }

  /** @param {number} speed */
  #updateSpeedButtons(speed) {
    if (!this.#demoControls) return;
    const btns = this.#demoControls.speedGroup.querySelectorAll('.demo-controls__speed-btn');
    btns.forEach(btn => {
      btn.classList.toggle('demo-controls__speed-btn--active',
        parseInt(btn.dataset.speed) === speed);
    });
  }

  /**
   * @param {number} progress 0..1
   * @param {number} demoTime epoch ms
   */
  #updateDemoProgress(progress, demoTime) {
    if (!this.#demoControls) return;
    this.#demoControls.progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
    const d = new Date(demoTime);
    this.#demoControls.timeDisplay.textContent =
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    this.#demoControls.status.textContent = `${(progress * 100).toFixed(0)}%`;
  }

  #toggleDemoPause() {
    if (!this.#demoControls) return;
    const btn = this.#demoControls.pauseBtn;
    if (this.#scheduler.paused) {
      this.#scheduler.resume();
      btn.textContent = '⏸';
      btn.title = 'Pause demo';
      btn.classList.remove('demo-controls__pause-btn--active');
    } else {
      this.#scheduler.pause();
      btn.textContent = '▶';
      btn.title = 'Resume demo';
      btn.classList.add('demo-controls__pause-btn--active');
    }
  }

  /** @param {string} text */
  #updateDemoStatus(text) {
    if (!this.#demoControls) return;
    this.#demoControls.status.textContent = text;
  }
}

/* --- Entry point --- */
const app = new App(document.getElementById('app'));
app.init();
