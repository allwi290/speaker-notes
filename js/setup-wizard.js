/**
 * SetupWizard — multi-step overlay for competition / class / club selection.
 * @module setup-wizard
 */

import { getDate } from './clock.js';

const STEPS = ['competition', 'classes', 'clubs', 'topn', 'speech'];

export default class SetupWizard {

  /** @type {HTMLElement} */
  #container;

  /** @type {import('./api-client.js').default} */
  #api;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {(() => void)|null} */
  #onComplete = null;

  /** @type {(() => void)|null} */
  #onCancel = null;

  /** @type {number} */
  #currentStep = 0;

  /** DOM refs */
  #dialogEl;
  #stepsEl = {};
  #navBackBtn;
  #navNextBtn;

  /** Temp state */
  #selectedCompId = null;
  #selectedCompName = null;
  #classes = [];
  #clubs = [];

  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.containerEl
   * @param {import('./api-client.js').default} deps.apiClient
   * @param {import('./settings-manager.js').default} deps.settings
   */
  constructor({ containerEl, apiClient, settings }) {
    this.#container = containerEl;
    this.#api = apiClient;
    this.#settings = settings;
  }

  /**
   * Show the wizard overlay.
   * @param {() => void} onComplete
   * @param {(() => void)|null} [onCancel]
   */
  open(onComplete, onCancel = null) {
    this.#onComplete = onComplete;
    this.#onCancel = onCancel;
    this.#currentStep = 0;
    this.#prefill();
    this.#buildDOM();
    this.#container.classList.add('wizard--open');
    this.#showStep(0);
    this.#loadCompetitions();
  }

  /** Close the wizard overlay. */
  close() {
    this.#container.classList.remove('wizard--open');
    this.#container.innerHTML = '';
  }

  /* ------------------------------------------------------------------
   * DOM construction
   * ----------------------------------------------------------------*/

  #buildDOM() {
    this.#container.innerHTML = '';

    this.#dialogEl = document.createElement('div');
    this.#dialogEl.className = 'wizard__dialog';

    // Step 1: Competition
    this.#stepsEl.competition = this.#createStep('competition', 'Select Competition');

    // Step 2: Classes
    this.#stepsEl.classes = this.#createStep('classes', 'Select Classes');

    // Step 3: Clubs
    this.#stepsEl.clubs = this.#createStep('clubs', 'Follow Clubs (optional)');

    // Step 4: Top N
    this.#stepsEl.topn = this.#createStep('topn', 'Top N Runners');

    // Step 5: Speech
    this.#stepsEl.speech = this.#createStep('speech', 'Speech Settings');

    // Nav
    const nav = document.createElement('div');
    nav.className = 'wizard__nav';

    this.#navBackBtn = document.createElement('button');
    this.#navBackBtn.className = 'wizard__btn';
    this.#navBackBtn.textContent = 'Back';
    this.#navBackBtn.addEventListener('click', () => this.#goBack());

    this.#navNextBtn = document.createElement('button');
    this.#navNextBtn.className = 'wizard__btn wizard__btn--primary';
    this.#navNextBtn.textContent = 'Next';
    this.#navNextBtn.addEventListener('click', () => this.#goNext());

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wizard__btn wizard__close-btn';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Close';
    cancelBtn.setAttribute('aria-label', 'Close');
    cancelBtn.addEventListener('click', () => this.#cancel());

    this.#dialogEl.appendChild(cancelBtn);
    nav.append(this.#navBackBtn, this.#navNextBtn);

    for (const key of STEPS) {
      this.#dialogEl.appendChild(this.#stepsEl[key]);
    }
    this.#dialogEl.appendChild(nav);
    this.#container.appendChild(this.#dialogEl);
  }

  /**
   * @param {string} id
   * @param {string} title
   * @returns {HTMLElement}
   */
  #createStep(id, title) {
    const el = document.createElement('div');
    el.className = 'wizard__step';
    el.dataset.step = id;

    const h2 = document.createElement('h2');
    h2.textContent = title;
    el.appendChild(h2);

    // body container
    const body = document.createElement('div');
    body.className = 'wizard__step-body';
    el.appendChild(body);

    return el;
  }

  /**
   * @param {HTMLElement} stepEl
   * @returns {HTMLElement} the body div
   */
  #stepBody(stepEl) {
    return stepEl.querySelector('.wizard__step-body');
  }

  /* ------------------------------------------------------------------
   * Navigation
   * ----------------------------------------------------------------*/

  #showStep(idx) {
    this.#currentStep = idx;
    for (let i = 0; i < STEPS.length; i++) {
      this.#stepsEl[STEPS[i]].classList.toggle('wizard__step--active', i === idx);
    }
    this.#navBackBtn.disabled = idx === 0;
    this.#navNextBtn.textContent = idx === STEPS.length - 1 ? 'Finish' : 'Next';
  }

  #goBack() {
    if (this.#currentStep > 0) {
      this.#showStep(this.#currentStep - 1);
    }
  }

  #cancel() {
    this.close();
    if (this.#onCancel) this.#onCancel();
  }

  #goNext() {
    const step = STEPS[this.#currentStep];

    if (step === 'competition') {
      if (!this.#selectedCompId) return;
      this.#settings.set('compId', this.#selectedCompId);
      this.#settings.set('compName', this.#selectedCompName);
      this.#showStep(1);
      this.#loadClasses();

    } else if (step === 'classes') {
      this.#saveClasses();
      this.#showStep(2);
      this.#loadClubs();

    } else if (step === 'clubs') {
      const cbs = this.#stepsEl.clubs.querySelectorAll('input[type="checkbox"]');
      const selected = [...cbs].filter(cb => cb.checked).map(cb => cb.value);
      this.#settings.set('followedClubs', selected);
      this.#clubs = selected;
      this.#showStep(3);
      this.#renderTopN();

    } else if (step === 'topn') {
      this.#saveTopN();
      this.#showStep(4);
      this.#renderSpeech();

    } else if (step === 'speech') {
      this.#saveSpeech();
      this.close();
      if (this.#onComplete) this.#onComplete();
    }
  }

  #prefill() {
    this.#selectedCompId = this.#settings.compId;
    this.#selectedCompName = this.#settings.compName;
    this.#clubs = [...(this.#settings.followedClubs ?? [])];
  }

  /* ------------------------------------------------------------------
   * Step 1: Competitions
   * ----------------------------------------------------------------*/

  async #loadCompetitions() {
    const body = this.#stepBody(this.#stepsEl.competition);
    body.innerHTML = '<p>Loading competitions…</p>';

    try {
      const comps = await this.#api.getCompetitions();
      const d = getDate();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const todayComps = comps.filter(c => c.date === today);

      body.innerHTML = '';

      if (todayComps.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'wizard__empty';
        msg.textContent = `No competitions found for ${today}. Showing all.`;
        body.appendChild(msg);
        this.#renderCompList(body, comps.slice(0, 50));
      } else {
        this.#renderCompList(body, todayComps);
      }
    } catch (err) {
      body.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'wizard__empty';
      p.textContent = `Failed to load competitions: ${err.message}`;
      body.appendChild(p);
    }
  }

  /**
   * @param {HTMLElement} container
   * @param {Array} comps
   */
  #renderCompList(container, comps) {
    const ul = document.createElement('ul');
    ul.className = 'wizard__list';

    for (const comp of comps) {
      const li = document.createElement('li');
      li.className = 'wizard__item';
      if (comp.id === this.#selectedCompId) li.classList.add('wizard__item--selected');
      li.dataset.id = comp.id;
      li.textContent = `${comp.name} — ${comp.organizer}`;
      li.addEventListener('click', () => {
        this.#selectedCompId = comp.id;
        this.#selectedCompName = comp.name;
        ul.querySelectorAll('.wizard__item').forEach(el => el.classList.remove('wizard__item--selected'));
        li.classList.add('wizard__item--selected');
      });
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  /* ------------------------------------------------------------------
   * Step 2: Classes
   * ----------------------------------------------------------------*/

  async #loadClasses() {
    const body = this.#stepBody(this.#stepsEl.classes);
    body.innerHTML = '<p>Loading classes…</p>';

    try {
      const classes = await this.#api.getClasses(this.#selectedCompId);
      this.#classes = (classes ?? []).map(c => c.className);
      body.innerHTML = '';
      this.#renderClassCheckboxes(body);
    } catch (err) {
      body.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'wizard__empty';
      p.textContent = `Failed to load classes: ${err.message}`;
      body.appendChild(p);
    }
  }

  /**
   * @param {HTMLElement} container
   */
  #renderClassCheckboxes(container) {
    const followed = this.#settings.followedClasses;
    const allSelected = followed === null;

    // Toggle all button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'wizard__toggle-all';
    toggleBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
    toggleBtn.addEventListener('click', () => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      const anyUnchecked = [...checkboxes].some(cb => !cb.checked);
      checkboxes.forEach(cb => { cb.checked = anyUnchecked; });
      toggleBtn.textContent = anyUnchecked ? 'Deselect All' : 'Select All';
    });
    container.appendChild(toggleBtn);

    const wrapper = document.createElement('div');
    wrapper.className = 'wizard__classes';

    for (const cls of this.#classes) {
      const label = document.createElement('label');
      label.className = 'wizard__class-label';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cls;
      cb.checked = allSelected || (followed && followed.includes(cls));

      label.append(cb, document.createTextNode(` ${cls}`));
      wrapper.appendChild(label);
    }
    container.appendChild(wrapper);
  }

  #saveClasses() {
    const checkboxes = this.#stepsEl.classes.querySelectorAll('input[type="checkbox"]');
    const selected = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
    // null means "all"
    const value = selected.length === this.#classes.length ? null : selected;
    this.#settings.set('followedClasses', value);
  }

  /* ------------------------------------------------------------------
   * Step 3: Clubs
   * ----------------------------------------------------------------*/

  async #loadClubs() {
    const body = this.#stepBody(this.#stepsEl.clubs);
    body.innerHTML = '<p>Loading clubs from competition data…</p>';

    try {
      const followed = this.#settings.followedClasses;
      const classNames = followed ?? this.#classes;

      const results = await Promise.all(
        classNames.map(cls =>
          this.#api.getClassResults(this.#selectedCompId, cls, { skipCache: true }).catch(() => null)
        )
      );

      const clubSet = new Set();
      for (const res of results) {
        if (!res?.results) continue;
        for (const runner of res.results) {
          if (runner.club) clubSet.add(runner.club);
        }
      }

      const allClubs = [...clubSet].sort((a, b) => a.localeCompare(b, 'sv'));

      body.innerHTML = '';

      if (allClubs.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'wizard__empty';
        msg.textContent = 'No clubs found in competition data.';
        body.appendChild(msg);
        return;
      }

      const desc = document.createElement('p');
      desc.textContent = 'Select clubs to highlight. These runners always appear in latest events regardless of ranking.';
      body.appendChild(desc);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'wizard__toggle-all';
      toggleBtn.textContent = 'Select All';
      toggleBtn.addEventListener('click', () => {
        const checkboxes = wrapper.querySelectorAll('input[type="checkbox"]');
        const anyUnchecked = [...checkboxes].some(cb => !cb.checked);
        checkboxes.forEach(cb => { cb.checked = anyUnchecked; });
        toggleBtn.textContent = anyUnchecked ? 'Deselect All' : 'Select All';
      });
      body.appendChild(toggleBtn);

      const wrapper = document.createElement('div');
      wrapper.className = 'wizard__classes';

      for (const club of allClubs) {
        const label = document.createElement('label');
        label.className = 'wizard__class-label';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = club;
        cb.checked = this.#clubs.includes(club);

        label.append(cb, document.createTextNode(` ${club}`));
        wrapper.appendChild(label);
      }
      body.appendChild(wrapper);
    } catch (err) {
      body.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'wizard__empty';
      p.textContent = `Failed to load clubs: ${err.message}`;
      body.appendChild(p);
    }
  }

  /* ------------------------------------------------------------------
   * Step 4: Top N
   * ----------------------------------------------------------------*/

  #renderTopN() {
    const body = this.#stepBody(this.#stepsEl.topn);
    body.innerHTML = '';

    const desc = document.createElement('p');
    desc.textContent = 'Number of top runners to track per class:';
    body.appendChild(desc);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'wizard__topn-input';
    input.min = 1;
    input.max = 20;
    input.value = this.#settings.topN;
    input.id = 'wizard-topn';
    body.appendChild(input);
  }

  #saveTopN() {
    const input = this.#stepsEl.topn.querySelector('#wizard-topn');
    const val = parseInt(input?.value, 10);
    if (val >= 1 && val <= 20) {
      this.#settings.set('topN', val);
    }
  }

  /* ------------------------------------------------------------------
   * Step 5: Speech
   * ----------------------------------------------------------------*/

  #renderSpeech() {
    const body = this.#stepBody(this.#stepsEl.speech);
    body.innerHTML = '';

    // Language dropdown
    const langLabel = document.createElement('label');
    langLabel.textContent = 'Speech language: ';
    langLabel.className = 'wizard__label';

    const langSelect = document.createElement('select');
    langSelect.id = 'wizard-speech-lang';
    langSelect.className = 'wizard__select';

    const currentLang = this.#settings.speechLang ?? 'sv-SE';

    if (typeof speechSynthesis !== 'undefined') {
      const voices = speechSynthesis.getVoices();
      const langMap = new Map();
      for (const v of voices) {
        if (!langMap.has(v.lang)) {
          langMap.set(v.lang, v.name);
        }
      }
      // Sort by lang code
      const langs = [...langMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [lang, voiceName] of langs) {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = `${lang} — ${voiceName}`;
        if (lang === currentLang) opt.selected = true;
        langSelect.appendChild(opt);
      }
      // If no exact match is selected, try prefix match
      if (langSelect.selectedIndex === -1 && langs.length > 0) {
        const prefix = currentLang.split('-')[0];
        for (let i = 0; i < langSelect.options.length; i++) {
          if (langSelect.options[i].value.startsWith(prefix)) {
            langSelect.selectedIndex = i;
            break;
          }
        }
      }
    } else {
      const opt = document.createElement('option');
      opt.value = currentLang;
      opt.textContent = currentLang;
      opt.selected = true;
      langSelect.appendChild(opt);
    }

    langLabel.appendChild(langSelect);
    body.appendChild(langLabel);

    // Rate slider
    const rateLabel = document.createElement('label');
    rateLabel.className = 'wizard__label';
    rateLabel.textContent = 'Speech rate: ';

    const rateInput = document.createElement('input');
    rateInput.type = 'range';
    rateInput.id = 'wizard-speech-rate';
    rateInput.className = 'wizard__range';
    rateInput.min = '0.5';
    rateInput.max = '2.0';
    rateInput.step = '0.1';
    rateInput.value = String(this.#settings.speechRate ?? 1.1);

    const rateValue = document.createElement('span');
    rateValue.className = 'wizard__range-value';
    rateValue.textContent = rateInput.value;

    rateInput.addEventListener('input', () => {
      rateValue.textContent = rateInput.value;
    });

    rateLabel.append(rateInput, rateValue);
    body.appendChild(rateLabel);

    // Test button
    const testBtn = document.createElement('button');
    testBtn.className = 'wizard__btn';
    testBtn.textContent = 'Test speech';
    testBtn.addEventListener('click', () => {
      if (typeof speechSynthesis === 'undefined') return;
      speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance('This is a test of the speech synthesis.');
      utt.lang = langSelect.value;
      utt.rate = parseFloat(rateInput.value);
      utt.pitch = 1.0;
      const voices = speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang === langSelect.value)
        ?? voices.find(v => v.lang.startsWith(langSelect.value.split('-')[0]));
      if (voice) utt.voice = voice;
      speechSynthesis.speak(utt);
    });
    body.appendChild(testBtn);
  }

  #saveSpeech() {
    const langSelect = this.#stepsEl.speech.querySelector('#wizard-speech-lang');
    if (langSelect) {
      this.#settings.set('speechLang', langSelect.value);
    }
    const rateInput = this.#stepsEl.speech.querySelector('#wizard-speech-rate');
    if (rateInput) {
      const rate = parseFloat(rateInput.value);
      if (rate >= 0.5 && rate <= 2.0) {
        this.#settings.set('speechRate', rate);
      }
    }
  }
}
