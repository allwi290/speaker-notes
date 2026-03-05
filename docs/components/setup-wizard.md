# SetupWizard

## Purpose

Modal/overlay UI that guides the user through selecting a competition, classes to follow, and clubs to highlight. Shown on first launch or when the user chooses to change settings.

## Responsibilities

- **Step 1 — Competition**: Fetch today's competitions via `ApiClient.getCompetitions()` and display a selectable list. Only show competitions with `date === today`.
- **Step 2 — Classes**: Fetch classes for the selected competition via `ApiClient.getClasses()`. Show a checklist; default = all selected. Allow toggling individual classes.
- **Step 3 — Clubs** _(optional)_: Show a text input to add club names to follow. These clubs get visual highlighting and bypass the top-N filter for latest events.
- **Step 4 — Top N**: Allow adjusting the "top N per class" setting (default 4).
- Persist all selections via `SettingsManager`
- Emit a `"setup-complete"` callback when the user confirms, so `App` can start polling

## Interface

```js
// js/setup-wizard.js
export default class SetupWizard {

  /**
   * @param {Object}          deps
   * @param {HTMLElement}      deps.containerEl
   * @param {ApiClient}        deps.apiClient
   * @param {SettingsManager}  deps.settings
   */
  constructor(deps)

  /**
   * Show the wizard overlay.
   * @param {() => void} onComplete — called when setup is finished
   */
  open(onComplete)

  /**
   * Close the wizard overlay.
   */
  close()
}
```

## DOM Structure

```html
<div id="setup-wizard" class="wizard" role="dialog" aria-modal="true">
  <div class="wizard__step wizard__step--active" data-step="competition">
    <h2>Select Competition</h2>
    <ul class="wizard__list">
      <li class="wizard__item" data-id="10278">
        Demo #1 — TestOrganizer
      </li>
    </ul>
  </div>

  <div class="wizard__step" data-step="classes">
    <h2>Select Classes</h2>
    <label><input type="checkbox" checked> Herrar</label>
    <label><input type="checkbox" checked> Damer</label>
    <!-- ... -->
  </div>

  <div class="wizard__step" data-step="clubs">
    <h2>Follow Clubs (optional)</h2>
    <input type="text" placeholder="Club name…">
    <ul class="wizard__tags"><!-- added clubs --></ul>
  </div>

  <div class="wizard__step" data-step="topn">
    <h2>Top N Runners</h2>
    <input type="number" min="1" max="20" value="4">
  </div>

  <div class="wizard__nav">
    <button class="wizard__btn" data-action="back">Back</button>
    <button class="wizard__btn wizard__btn--primary" data-action="next">Next</button>
  </div>
</div>
```

## Dependencies

| Module | Relationship |
|---|---|
| ApiClient | fetches competitions and classes |
| SettingsManager | persists selections |
