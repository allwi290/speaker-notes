# SettingsManager

## Purpose

Single source of truth for all user-configurable settings. Persists to `localStorage` so the app survives page reloads and network drops.

## Responsibilities

- Store and retrieve:
  - `compId` — selected competition ID
  - `compName` — selected competition name (for display)
  - `followedClasses` — `string[]` of class names (`null` = all)
  - `followedClubs` — `string[]` of club names to highlight
  - `topN` — number of top runners to track per class (default `4`)
  - `maxLatestEvents` — max visible latest events (default `10`)
  - `maxPredictions` — max visible predictions (default `5`)
- Notify listeners when a setting changes (simple pub/sub)
- Provide sensible defaults for every setting
- Serialise to / deserialise from `localStorage` as JSON

## Interface

```js
// js/settings-manager.js

/** @typedef {"compId"|"compName"|"followedClasses"|"followedClubs"|"topN"|"maxLatestEvents"|"maxPredictions"} SettingKey */

export default class SettingsManager {

  constructor()

  /**
   * Get a setting value.
   * @param   {SettingKey} key
   * @returns {*}
   */
  get(key)

  /**
   * Set a setting value (persists immediately).
   * @param {SettingKey} key
   * @param {*}          value
   */
  set(key, value)

  /**
   * Subscribe to changes.
   * @param {SettingKey}            key
   * @param {(value: *) => void}   callback
   * @returns {() => void}         unsubscribe function
   */
  onChange(key, callback)

  /**
   * Clear all settings (reset to defaults).
   */
  reset()

  /** Convenience getters */
  get compId()
  get followedClasses()
  get followedClubs()
  get topN()
}
```

## Dependencies

| Module | Relationship |
|---|---|
| _none_ | standalone; uses `localStorage` |

## localStorage Schema

Key: `"speaker-notes-settings"`

```json
{
  "compId": 10278,
  "compName": "Demo #1",
  "followedClasses": null,
  "followedClubs": ["OK Ravinen"],
  "topN": 4,
  "maxLatestEvents": 10,
  "maxPredictions": 5
}
```
