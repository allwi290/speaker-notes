/**
 * SettingsPanel — single-page overlay for adjusting top-N and speech settings.
 * Changes apply immediately via SettingsManager.
 * @module settings-panel
 */

import { VOICE_MAP } from './google-tts-notifier.js';

export default class SettingsPanel {

  /** @type {HTMLElement} */
  #container;

  /** @type {import('./settings-manager.js').default} */
  #settings;

  /** @type {import('./google-tts-notifier.js').default|null} */
  #googleTts = null;

  /**
   * @param {Object} deps
   * @param {HTMLElement} deps.containerEl
   * @param {import('./settings-manager.js').default} deps.settings
   * @param {import('./google-tts-notifier.js').default} [deps.googleTts]
   */
  constructor({ containerEl, settings, googleTts }) {
    this.#container = containerEl;
    this.#settings = settings;
    this.#googleTts = googleTts ?? null;
  }

  /** Show the settings panel overlay. */
  open() {
    this.#buildDOM();
    this.#container.classList.add('wizard--open');
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

    // Section: Predictions
    const predSection = this.#createSection('Predictions', 'settings-predictions');
    this.#renderPredictions(predSection.querySelector('.settings-section__body'));
    content.appendChild(predSection);

    // Section: Top N Runners
    const topNSection = this.#createSection('Top N Runners', 'settings-topn');
    this.#renderTopN(topNSection.querySelector('.settings-section__body'));
    content.appendChild(topNSection);

    // Section: TTS Provider
    const ttsSection = this.#createSection('TTS Provider', 'settings-tts');
    this.#renderTtsProvider(ttsSection.querySelector('.settings-section__body'));
    content.appendChild(ttsSection);

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
   * Rendering
   * ----------------------------------------------------------------*/

  /** @param {HTMLElement} body */
  #renderPredictions(body) {
    const label = document.createElement('label');
    label.className = 'wizard__label';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!this.#settings.get('showPredictions');
    checkbox.addEventListener('change', () => {
      this.#settings.set('showPredictions', checkbox.checked);
    });

    label.append(checkbox, 'Show predictions panel');
    body.appendChild(label);
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
  #renderTtsProvider(body) {
    const desc = document.createElement('p');
    desc.textContent = 'Choose between the built-in browser speech engine or Google Cloud TTS (requires API key).';
    body.appendChild(desc);

    // Provider dropdown
    const providerLabel = document.createElement('label');
    providerLabel.className = 'wizard__label';
    providerLabel.textContent = 'Provider: ';

    const providerSelect = document.createElement('select');
    providerSelect.className = 'wizard__select';

    for (const [value, label] of [['browser', 'Browser (built-in)'], ['google', 'Google Cloud TTS']]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === (this.#settings.get('ttsProvider') ?? 'browser')) opt.selected = true;
      providerSelect.appendChild(opt);
    }

    providerLabel.appendChild(providerSelect);
    body.appendChild(providerLabel);

    // API key input (shown only when google is selected)
    const keyWrapper = document.createElement('div');

    const keyLabel = document.createElement('label');
    keyLabel.className = 'wizard__label';
    keyLabel.textContent = 'Google API Key: ';

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'wizard__select';
    keyInput.placeholder = 'Paste your API key here';
    keyInput.value = this.#settings.get('googleTtsApiKey') ?? '';
    keyInput.autocomplete = 'off';

    const showBtn = document.createElement('button');
    showBtn.className = 'wizard__btn';
    showBtn.textContent = 'Show';
    showBtn.style.marginLeft = '8px';
    showBtn.addEventListener('click', () => {
      const isPassword = keyInput.type === 'password';
      keyInput.type = isPassword ? 'text' : 'password';
      showBtn.textContent = isPassword ? 'Hide' : 'Show';
    });

    const keyRow = document.createElement('div');
    keyRow.style.display = 'flex';
    keyRow.style.alignItems = 'center';
    keyRow.style.gap = '8px';
    keyRow.append(keyInput, showBtn);

    keyLabel.appendChild(keyRow);
    keyWrapper.appendChild(keyLabel);

    const hint = document.createElement('p');
    hint.style.fontSize = 'var(--font-size-sm)';
    hint.style.color = 'var(--color-text-muted)';
    hint.style.marginTop = '4px';
    hint.innerHTML = 'Get a key from <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style="color: var(--color-accent)">Google Cloud Console</a>. Enable the "Cloud Text-to-Speech API".';
    keyWrapper.appendChild(hint);

    body.appendChild(keyWrapper);

    // Toggle API key visibility based on provider
    const updateKeyVisibility = () => {
      keyWrapper.style.display = providerSelect.value === 'google' ? 'block' : 'none';
    };
    updateKeyVisibility();

    // Event handlers
    providerSelect.addEventListener('change', () => {
      this.#settings.set('ttsProvider', providerSelect.value);
      updateKeyVisibility();
      // Refresh the speech language dropdown for the new provider
      if (this._populateLangOptions) this._populateLangOptions();
    });

    keyInput.addEventListener('change', () => {
      this.#settings.set('googleTtsApiKey', keyInput.value.trim());
    });
  }

  /** @param {HTMLElement} body */
  #renderSpeech(body) {
    // Language dropdown
    const langLabel = document.createElement('label');
    langLabel.textContent = 'Speech language: ';
    langLabel.className = 'wizard__label';

    const langSelect = document.createElement('select');
    langSelect.className = 'wizard__select';

    const populateLangOptions = () => {
      const provider = this.#settings.get('ttsProvider') ?? 'browser';
      const savedLang = this.#settings.get('speechLang') ?? 'sv-SE';
      langSelect.innerHTML = '';

      if (provider === 'google') {
        const langs = Object.keys(VOICE_MAP).sort((a, b) => a.localeCompare(b));
        for (const lang of langs) {
          const opt = document.createElement('option');
          opt.value = lang;
          opt.textContent = `${lang} — ${VOICE_MAP[lang].name}`;
          if (lang === savedLang) opt.selected = true;
          langSelect.appendChild(opt);
        }
      } else if (typeof speechSynthesis !== 'undefined') {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) return;
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
      } else {
        const opt = document.createElement('option');
        opt.value = savedLang;
        opt.textContent = savedLang;
        opt.selected = true;
        langSelect.appendChild(opt);
      }

      if (langSelect.selectedIndex === -1 && langSelect.options.length > 0) {
        const prefix = savedLang.split('-')[0];
        for (let i = 0; i < langSelect.options.length; i++) {
          if (langSelect.options[i].value.startsWith(prefix)) {
            langSelect.selectedIndex = i;
            break;
          }
        }
      }
    };

    populateLangOptions();
    if (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length === 0) {
      speechSynthesis.addEventListener('voiceschanged', populateLangOptions, { once: true });
    }

    // Re-populate when TTS provider changes
    this._populateLangOptions = populateLangOptions;

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
    testBtn.addEventListener('click', async () => {
      const provider = this.#settings.get('ttsProvider') ?? 'browser';
      if (provider === 'google') {
        if (!this.#googleTts) { alert('Google TTS not available.'); return; }
        const apiKey = this.#settings.get('googleTtsApiKey');
        if (!apiKey) { alert('Please enter a Google API key first.'); return; }
        try {
          await this.#googleTts.speakText('Vi har en ny bästa tid vid radiokontroll K65 i klassen H 18, Gustav Wikström från Visborgs O K, passerade på tiden 4 minuter och 36 sekunder.');
        } catch (err) {
          alert(`Google TTS failed: ${err.message}`);
        }
      } else {
        if (typeof speechSynthesis === 'undefined') return;
        speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance('Vi har en ny bästa tid vid radiokontroll K65 i klassen H 18, Gustav Wikström från Visborgs O K, passerade på tiden 4 minuter och 36 sekunder.');
        utt.lang = langSelect.value;
        utt.rate = parseFloat(rateInput.value);
        utt.pitch = 1.0;
        const voices = speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang === langSelect.value)
          ?? voices.find(v => v.lang.startsWith(langSelect.value.split('-')[0]));
        if (voice) utt.voice = voice;
        speechSynthesis.speak(utt);
      }
    });
    body.appendChild(testBtn);
  }
}
