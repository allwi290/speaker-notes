/**
 * SettingsPanel — single-page overlay for adjusting classes, clubs, top-N,
 * and speech settings. Changes apply immediately via SettingsManager.
 * @module settings-panel
 */

export default class SettingsPanel {

  /** @type {HTMLElement} */
  #container;

  /** @type {import('./api-client.js').default} */
  #api;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {string[]} */
  #classes = [];

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
   * Show the settings panel overlay.
   * @param {() => void} onChangeCompetition — called when user clicks "Change competition"
   */
  open() {
    this.#buildDOM();
    this.#container.classList.add('wizard--open');
    this.#loadData();
  }

  /** Close the settings panel overlay. */
  close() {
    this.#container.classList.remove('wizard--open');
    this.#container.innerHTML = '';
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.#container.classList.contains('wizard--open');
  }

  /* ------------------------------------------------------------------
   * DOM construction
   * ----------------------------------------------------------------*/

  #buildDOM() {
    this.#container.innerHTML = '';

    const dialog = document.createElement('div');
    dialog.className = 'wizard__dialog settings-dialog';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wizard__close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());

    // Scrollable content
    const content = document.createElement('div');
    content.className = 'settings-dialog__content';

    // Title
    const title = document.createElement('h2');
    title.className = 'settings-dialog__title';
    title.textContent = 'Settings';
    content.appendChild(title);

    // Section: Classes
    const classesSection = this.#createSection('Classes', 'settings-classes');
    const classesBody = classesSection.querySelector('.settings-section__body');
    classesBody.innerHTML = '<p>Loading classes…</p>';
    content.appendChild(classesSection);

    // Section: Followed Clubs
    const clubsSection = this.#createSection('Followed Clubs', 'settings-clubs');
    const clubsBody = clubsSection.querySelector('.settings-section__body');
    clubsBody.innerHTML = '<p>Loading clubs…</p>';
    content.appendChild(clubsSection);

    // Section: Top N Runners
    const topNSection = this.#createSection('Top N Runners', 'settings-topn');
    this.#renderTopN(topNSection.querySelector('.settings-section__body'));
    content.appendChild(topNSection);

    // Section: Speech
    const speechSection = this.#createSection('Speech', 'settings-speech');
    this.#renderSpeech(speechSection.querySelector('.settings-section__body'));
    content.appendChild(speechSection);

    dialog.append(closeBtn, content);
    this.#container.appendChild(dialog);
  }

  /**
   * @param {string} title
   * @param {string} id
   * @returns {HTMLElement}
   */
  #createSection(title, id) {
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.id = id;

    const h3 = document.createElement('h3');
    h3.className = 'settings-section__title';
    h3.textContent = title;
    section.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'settings-section__body';
    section.appendChild(body);

    return section;
  }

  /* ------------------------------------------------------------------
   * Data loading
   * ----------------------------------------------------------------*/

  async #loadData() {
    await Promise.all([
      this.#loadClasses(),
      this.#loadClubs(),
    ]);
  }

  async #loadClasses() {
    const body = this.#container.querySelector('#settings-classes .settings-section__body');
    try {
      const classes = await this.#api.getClasses(this.#settings.compId);
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

  async #loadClubs() {
    const body = this.#container.querySelector('#settings-clubs .settings-section__body');
    try {
      const followed = this.#settings.followedClasses;
      const classNames = followed ?? this.#classes;

      // If classes haven't loaded yet, wait briefly
      if (classNames.length === 0) {
        await this.#loadClasses();
        const updatedFollowed = this.#settings.followedClasses;
        const updatedClassNames = updatedFollowed ?? this.#classes;
        if (updatedClassNames.length === 0) {
          body.innerHTML = '<p class="wizard__empty">No classes available.</p>';
          return;
        }
      }

      const classNames2 = this.#settings.followedClasses ?? this.#classes;
      const results = await Promise.all(
        classNames2.map(cls =>
          this.#api.getClassResults(this.#settings.compId, cls, { skipCache: true }).catch(() => null)
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
        body.innerHTML = '<p class="wizard__empty">No clubs found in competition data.</p>';
        return;
      }

      this.#renderClubCheckboxes(body, allClubs);
    } catch (err) {
      body.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'wizard__empty';
      p.textContent = `Failed to load clubs: ${err.message}`;
      body.appendChild(p);
    }
  }

  /* ------------------------------------------------------------------
   * Rendering
   * ----------------------------------------------------------------*/

  /** @param {HTMLElement} container */
  #renderClassCheckboxes(container) {
    const followed = this.#settings.followedClasses;
    const allSelected = followed === null;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'wizard__toggle-all';
    toggleBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
    toggleBtn.addEventListener('click', () => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      const anyUnchecked = [...checkboxes].some(cb => !cb.checked);
      checkboxes.forEach(cb => { cb.checked = anyUnchecked; });
      toggleBtn.textContent = anyUnchecked ? 'Deselect All' : 'Select All';
      this.#saveClasses(container);
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
      cb.addEventListener('change', () => this.#saveClasses(container));

      label.append(cb, document.createTextNode(` ${cls}`));
      wrapper.appendChild(label);
    }
    container.appendChild(wrapper);
  }

  /** @param {HTMLElement} container */
  #saveClasses(container) {
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const selected = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
    const value = selected.length === this.#classes.length ? null : selected;
    this.#settings.set('followedClasses', value);
  }

  /**
   * @param {HTMLElement} container
   * @param {string[]} allClubs
   */
  #renderClubCheckboxes(container, allClubs) {
    const currentClubs = this.#settings.followedClubs ?? [];

    const desc = document.createElement('p');
    desc.textContent = 'Runners from selected clubs always appear in latest events regardless of ranking.';
    container.appendChild(desc);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'wizard__toggle-all';
    toggleBtn.textContent = currentClubs.length === allClubs.length ? 'Deselect All' : 'Select All';
    toggleBtn.addEventListener('click', () => {
      const checkboxes = wrapper.querySelectorAll('input[type="checkbox"]');
      const anyUnchecked = [...checkboxes].some(cb => !cb.checked);
      checkboxes.forEach(cb => { cb.checked = anyUnchecked; });
      toggleBtn.textContent = anyUnchecked ? 'Deselect All' : 'Select All';
      this.#saveClubs(wrapper);
    });
    container.appendChild(toggleBtn);

    const wrapper = document.createElement('div');
    wrapper.className = 'wizard__classes';

    for (const club of allClubs) {
      const label = document.createElement('label');
      label.className = 'wizard__class-label';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = club;
      cb.checked = currentClubs.includes(club);
      cb.addEventListener('change', () => this.#saveClubs(wrapper));

      label.append(cb, document.createTextNode(` ${club}`));
      wrapper.appendChild(label);
    }
    container.appendChild(wrapper);
  }

  /** @param {HTMLElement} wrapper */
  #saveClubs(wrapper) {
    const checkboxes = wrapper.querySelectorAll('input[type="checkbox"]');
    const selected = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
    this.#settings.set('followedClubs', selected);
  }

  /** @param {HTMLElement} body */
  #renderTopN(body) {
    const desc = document.createElement('p');
    desc.textContent = 'Number of top runners to track per class:';
    body.appendChild(desc);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'wizard__topn-input';
    input.min = 1;
    input.max = 20;
    input.value = this.#settings.topN;
    input.addEventListener('change', () => {
      const val = parseInt(input.value, 10);
      if (val >= 1 && val <= 20) {
        this.#settings.set('topN', val);
      }
    });
    body.appendChild(input);
  }

  /** @param {HTMLElement} body */
  #renderSpeech(body) {
    // Language dropdown
    const langLabel = document.createElement('label');
    langLabel.textContent = 'Speech language: ';
    langLabel.className = 'wizard__label';

    const langSelect = document.createElement('select');
    langSelect.className = 'wizard__select';

    if (typeof speechSynthesis !== 'undefined') {
      const populateVoices = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) return;

        // Read the live setting, not a stale captured value
        const savedLang = this.#settings.get('speechLang') ?? 'sv-SE';

        langSelect.innerHTML = '';
        const langMap = new Map();
        for (const v of voices) {
          if (!langMap.has(v.lang)) {
            langMap.set(v.lang, v.name);
          }
        }
        const langs = [...langMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        for (const [lang, voiceName] of langs) {
          const opt = document.createElement('option');
          opt.value = lang;
          opt.textContent = `${lang} — ${voiceName}`;
          if (lang === savedLang) opt.selected = true;
          langSelect.appendChild(opt);
        }
        if (langSelect.selectedIndex === -1 && langs.length > 0) {
          const prefix = savedLang.split('-')[0];
          for (let i = 0; i < langSelect.options.length; i++) {
            if (langSelect.options[i].value.startsWith(prefix)) {
              langSelect.selectedIndex = i;
              break;
            }
          }
        }
      };
      populateVoices();
      // Only listen once — avoids resetting the dropdown after user changes it
      if (speechSynthesis.getVoices().length === 0) {
        speechSynthesis.addEventListener('voiceschanged', populateVoices, { once: true });
      }
    } else {
      const currentLang = this.#settings.get('speechLang') ?? 'sv-SE';
      const opt = document.createElement('option');
      opt.value = currentLang;
      opt.textContent = currentLang;
      opt.selected = true;
      langSelect.appendChild(opt);
    }

    langSelect.addEventListener('change', () => {
      this.#settings.set('speechLang', langSelect.value);
    });

    langLabel.appendChild(langSelect);
    body.appendChild(langLabel);

    // Rate slider
    const rateLabel = document.createElement('label');
    rateLabel.className = 'wizard__label';
    rateLabel.textContent = 'Speech rate: ';

    const rateInput = document.createElement('input');
    rateInput.type = 'range';
    rateInput.className = 'wizard__range';
    rateInput.min = '0.5';
    rateInput.max = '2.0';
    rateInput.step = '0.1';
    rateInput.value = String(this.#settings.get('speechRate') ?? 1.1);

    const rateValue = document.createElement('span');
    rateValue.className = 'wizard__range-value';
    rateValue.textContent = rateInput.value;

    rateInput.addEventListener('input', () => {
      rateValue.textContent = rateInput.value;
      const rate = parseFloat(rateInput.value);
      if (rate >= 0.5 && rate <= 2.0) {
        this.#settings.set('speechRate', rate);
      }
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
}
