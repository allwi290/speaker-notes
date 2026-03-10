# ApiClient

## Purpose

Low-level HTTP layer that communicates with the `liveresultat.orientering.se` API. Handles hash-based caching, circuit-breaker logic, and retry with exponential backoff.

## Responsibilities

- Build URLs for all API endpoints (`getcompetitions`, `getclasses`, `getclassresults`)
- Store the last hash per (comp, class) pair; send `last_hash` on subsequent requests
- Return `null` when the API responds with `{ "status": "NOT MODIFIED" }`
- Implement a **circuit breaker** (open after 3 consecutive failures; half-open after 30 s)
- Retry failed requests with exponential backoff (1 s, 2 s, 4 s; max 3 attempts)
- Emit / record the timestamp of the last successful data receipt (used by `ConnectionMonitor`)
- Accept an `AbortSignal` so requests can be cancelled on teardown
- Sanitize the data from backend, some characters are not escaped properly, see notes below

## Interface

```js
// js/api-client.js
export default class ApiClient {

  /**
   * @param {string} baseUrl — default "https://liveresultat.orientering.se/api.php"
   */
  constructor(baseUrl)

  /**
   * Fetch today's competitions.
   * @returns {Promise<Competition[]>}
   *
   * @typedef  {Object} Competition
   * @property {number} id
   * @property {string} name
   * @property {string} organizer
   * @property {string} date          — "YYYY-MM-DD"
   * @property {number} timediff
   */
  async getCompetitions()

  /**
   * Fetch classes for a competition (hash-cached).
   * @param   {number} compId
   * @returns {Promise<ClassInfo[] | null>}  null = not modified
   *
   * @typedef  {Object} ClassInfo
   * @property {string} className
   */
  async getClasses(compId)

  /**
   * Fetch results for one class (hash-cached, unformatted times).
   * @param   {number}  compId
   * @param   {string}  className
   * @param   {Object}  [options]
   * @param   {AbortSignal} [options.signal]
   * @returns {Promise<ClassResults | null>}  null = not modified
   *
   * @typedef  {Object} ClassResults
   * @property {string}           className
   * @property {SplitControl[]}   splitcontrols
   * @property {RunnerResult[]}   results
   * @property {string}           hash
   *
   * @typedef  {Object} SplitControl
   * @property {number} code
   * @property {string} name
   *
   * @typedef  {Object} RunnerResult
   * @property {string}        name
   * @property {string}        club
   * @property {number}        status
   * @property {number}        progress
   * @property {string}        place
   * @property {string|number} result
   * @property {string|number} timeplus
   * @property {number}        start        — centiseconds
   * @property {Object}        splits       — keyed by control code
   */
  async getClassResults(compId, className, options)

  /**
   * Epoch ms of the last successful data-bearing response.
   * @type {number}
   */
  get lastDataTimestamp()

/**
   * Epoch ms of the last successful API response (data-bearing or not).
   * @type {number}
   */
  get lastApiTimestamp()

  /**
   * Current circuit-breaker state.
   * @returns {"closed"|"open"|"half-open"}
   */
  get circuitState()
}
```

## Dependencies

| Module    | Relationship                    |
|-----------|-------------------------------- |
| _none_    | standalone; uses `fetch` API    |

## Notes

- All times in `getclassresults` are in **centiseconds** (when `unformattedTimes=true`).
- The hash store is an internal `Map<string, string>` keyed by `"compId:className"`.
- Example implementation of sanitize of api response

```javascript
/**
 * Sanitize byte array by replacing control characters.
 * Mirrors the backend sanitization in liveResultsClient.ts.
 */
function sanitizeControlCharacters(uint8Array: Uint8Array): void {
  for (let i = 0; i < uint8Array.length; i++) {
    const byte = uint8Array[i]
    // Replace control chars 0x00-0x1F except HT(0x09), LF(0x0A), CR(0x0D)
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      uint8Array[i] = 0x20
    }
  }
}

/** Fetch directly from the LiveResults API (used for navigation endpoints) */
async function fetchLiveResultsApi<T>(params: URLSearchParams): Promise<T> {
  const url = `${LIVE_RESULTS_API}?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`LiveResults request failed: ${res.status}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)
  sanitizeControlCharacters(uint8Array)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8Array)
  return JSON5.parse(text)
```
