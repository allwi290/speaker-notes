/**
 * App — top-level orchestrator that wires all modules together.
 * Supports both live and demo modes.
 * @module app
 */

import SettingsManager    from './settings-manager.js';
import ApiClient          from './api-client.js';
import DemoApiClient      from './demo-api-client.js';
import RunnerStateStore   from './runner-state-store.js';
import EventDetector      from './event-detector.js';
import PredictionEngine   from './prediction-engine.js';
import AudioNotifier      from './audio-notifier.js';
import LatestEventsPanel  from './latest-events-panel.js';
import PredictionsPanel   from './predictions-panel.js';
import ConnectionMonitor  from './connection-monitor.js';
import PollingScheduler   from './polling-scheduler.js';
import SetupWizard        from './setup-wizard.js';
import { getNow, setNow } from './clock.js';

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

    this.#latestPanel = new LatestEventsPanel(
      rootEl.querySelector('#latest-events .panel__list')
    );
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

    // Settings button
    const settingsBtn = this.#root.querySelector('#settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        this.#scheduler.stop();
        this.#wizard.open(() => this.#onSetupComplete());
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

      // 5. Chime
      if (newEvents.length > 0) {
        this.#notifier.chime();
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

    bar.append(label, speedGroup, progressWrap, timeDisplay, status);

    // Insert after header
    const header = this.#root.querySelector('.app-header');
    if (header) {
      header.after(bar);
    } else {
      this.#root.prepend(bar);
    }

    this.#demoControls = { bar, speedGroup, progressBar, timeDisplay, status };
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

  /** @param {string} text */
  #updateDemoStatus(text) {
    if (!this.#demoControls) return;
    this.#demoControls.status.textContent = text;
  }
}

/* --- Entry point --- */
const app = new App(document.getElementById('app'));
app.init();
