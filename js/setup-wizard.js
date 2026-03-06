/**
 * SetupWizard — multi-step overlay for competition / class / club selection.
 * @module setup-wizard
 */

import { getDate } from './clock.js';

const STEPS = ['competition', 'classes', 'clubs', 'topn'];

export default class SetupWizard {

  /** @type {HTMLElement} */
  #container;

  /** @type {import('./api-client.js').default} */
  #api;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {(() => void)|null} */
  #onComplete = null;

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
   */
  open(onComplete) {
    this.#onComplete = onComplete;
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
      this.#renderClubs();

    } else if (step === 'clubs') {
      this.#settings.set('followedClubs', [...this.#clubs]);
      this.#showStep(3);
      this.#renderTopN();

    } else if (step === 'topn') {
      this.#saveTopN();
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

  #renderClubs() {
    const body = this.#stepBody(this.#stepsEl.clubs);
    body.innerHTML = '';

    const desc = document.createElement('p');
    desc.textContent = 'Add clubs to highlight. These runners always appear in latest events regardless of ranking.';
    body.appendChild(desc);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.className = 'wizard__club-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Club name…';

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';

    inputRow.append(input, addBtn);
    body.appendChild(inputRow);

    // Tags
    const tagsUl = document.createElement('ul');
    tagsUl.className = 'wizard__tags';
    body.appendChild(tagsUl);

    const renderTags = () => {
      tagsUl.innerHTML = '';
      for (const club of this.#clubs) {
        const li = document.createElement('li');
        li.className = 'wizard__tag';

        const text = document.createTextNode(club);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'wizard__tag-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          this.#clubs = this.#clubs.filter(c => c !== club);
          renderTags();
        });

        li.append(text, removeBtn);
        tagsUl.appendChild(li);
      }
    };

    const addClub = () => {
      const name = input.value.trim();
      if (name && !this.#clubs.includes(name)) {
        this.#clubs.push(name);
        input.value = '';
        renderTags();
      }
    };

    addBtn.addEventListener('click', addClub);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addClub();
    });

    renderTags();
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
}
