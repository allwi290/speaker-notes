# LatestEventsPanel

## Purpose

Renders the **upper section** of the display — a list of the most recent runner events (splits, finishes, status changes) with entry animations and auto-scroll.

## Responsibilities

- Render a list of `LatestEvent` objects as rows in a styled container
- Each row displays: **Time**, **Class**, **Runner**, **Club**, **Control**, **Place at control**, **Time behind leader**
- **Animate** new events sliding in from the top (CSS transition / animation)
- **Auto-scroll** the list so the newest event is always visible
- Highlight **club-followed** runners with a coloured left border
- Display **status change** events (DNF, DSQ, MP) with a distinct style (e.g., muted/strikethrough)
- Scale typography for readability at 1 m+ on a Full HD display
- Update the DOM efficiently — only add/remove changed rows, don't re-render the entire list

## Interface

```js
// js/latest-events-panel.js
export default class LatestEventsPanel {

  /**
   * @param {HTMLElement} containerEl — the DOM element to render into
   */
  constructor(containerEl)

  /**
   * Full re-render with the current events list.
   * Called on initial load or competition change.
   * @param {LatestEvent[]} events
   */
  render(events)

  /**
   * Incrementally add new events (prepend with animation).
   * Removes overflow events from the bottom.
   * @param {LatestEvent[]} newEvents — newest first
   * @param {LatestEvent[]} allEvents — full current list
   */
  update(newEvents, allEvents)

  /**
   * Clear the panel.
   */
  clear()
}
```

## DOM Structure

```html
<section id="latest-events" class="panel panel--latest">
  <h2 class="panel__title">Latest Events</h2>
  <div class="panel__list" role="log" aria-live="polite">
    <!-- one per event -->
    <div class="event-row event-row--new" data-id="...">
      <span class="event-row__time">14:32:57</span>
      <span class="event-row__class">Herrar</span>
      <span class="event-row__runner">Bruno Godefroy</span>
      <span class="event-row__club">OK Ravinen</span>
      <span class="event-row__control">Radio K65</span>
      <span class="event-row__place">2</span>
      <span class="event-row__timeplus">+0:11</span>
    </div>
  </div>
</section>
```

## CSS Classes

| Class | Purpose |
|---|---|
| `event-row--new` | Applied on insert, triggers slide-in animation; removed after animation ends |
| `event-row--club` | Coloured left border for club-followed runners |
| `event-row--status` | Muted / strikethrough style for DNF, DSQ, MP |

## Dependencies

| Module | Relationship |
|---|---|
| EventDetector | data source (receives `LatestEvent[]`) |

## Notes

- The panel receives **pre-formatted display strings** (time, timeplus). Formatting is done by `EventDetector` or a shared `formatTime` utility.
- Auto-scroll uses `scrollIntoView({ behavior: 'smooth' })` on the topmost event row.
- Animations use CSS `@keyframes` — no JavaScript animation library.
