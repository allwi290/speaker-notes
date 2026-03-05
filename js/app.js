/**
 * App — top-level orchestrator that wires all modules together.
 * @module app
 */

import SettingsManager    from './settings-manager.js';
import ApiClient          from './api-client.js';
import RunnerStateStore   from './runner-state-store.js';
import EventDetector      from './event-detector.js';
import PredictionEngine   from './prediction-engine.js';
import AudioNotifier      from './audio-notifier.js';
import LatestEventsPanel  from './latest-events-panel.js';
import PredictionsPanel   from './predictions-panel.js';
import ConnectionMonitor  from './connection-monitor.js';
import PollingScheduler   from './polling-scheduler.js';
import SetupWizard        from './setup-wizard.js';

export default class App {

  /** @type {HTMLElement} */
  #root;

  // Modules
  #settings;
  #api;
  #store;
  #detector;
  #predictor;
  #notifier;
  #latestPanel;
  #predictionsPanel;
  #monitor;
  #scheduler;
  #wizard;

  /**
   * @param {HTMLElement} rootEl — <div id="app">
   */
  constructor(rootEl) {
    this.#root = rootEl;

    this.#settings        = new SettingsManager();
    this.#api             = new ApiClient();
    this.#store           = new RunnerStateStore();
    this.#detector        = new EventDetector({ store: this.#store, settings: this.#settings });
    this.#predictor       = new PredictionEngine({ store: this.#store, settings: this.#settings });
    this.#notifier        = new AudioNotifier();

    this.#latestPanel     = new LatestEventsPanel(
      rootEl.querySelector('#latest-events .panel__list')
    );
    this.#predictionsPanel = new PredictionsPanel(
      rootEl.querySelector('#predictions .panel__list')
    );
    this.#monitor         = new ConnectionMonitor(
      rootEl.querySelector('#connection-monitor'),
      this.#api
    );
    this.#scheduler       = new PollingScheduler({
      apiClient: this.#api,
      settings:  this.#settings,
    });
    this.#wizard          = new SetupWizard({
      containerEl: rootEl.querySelector('#setup-wizard'),
      apiClient:   this.#api,
      settings:    this.#settings,
    });
  }

  /** Bootstrap the application. */
  init() {
    this.#monitor.start();

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
    this.#scheduler.start((className, results) => {
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
    }).catch(err => console.error('Failed to start polling:', err));
  }

  #onSetupComplete() {
    // Clear previous state
    this.#detector.clear();
    this.#predictor.clear();
    this.#latestPanel.clear();
    this.#predictionsPanel.clear();

    // Restart polling with new settings
    this.#startLive();
  }
}

/* --- Entry point --- */
const app = new App(document.getElementById('app'));
app.init();
