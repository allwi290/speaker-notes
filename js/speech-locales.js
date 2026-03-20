/**
 * Speech locale definitions for multi-language spoken announcements.
 * Each locale provides duration formatting, status labels, and sentence templates.
 * @module speech-locales
 */

/* ------------------------------------------------------------------ */
/*  Helper: parse time value to total seconds                         */
/* ------------------------------------------------------------------ */

/**
 * Parse a time value (centiseconds or formatted string) into total seconds.
 * @param {number|string} val
 * @returns {number} total seconds, or 0 if unparseable
 */
export function parseToSeconds(val) {
  if (val == null || val === '') return 0;
  const str = String(val).replace(/^\+/, '');

  if (str.includes(':')) {
    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }
  const n = Number(str);
  if (Number.isNaN(n) || n === 0) return 0;
  return Math.floor(Math.abs(n) / 100);
}

/* ------------------------------------------------------------------ */
/*  Shared helper: decompose seconds into h/m/s                       */
/* ------------------------------------------------------------------ */

/** @param {number} totalSeconds @returns {{h:number, m:number, s:number}} */
function hms(totalSeconds) {
  return {
    h: Math.floor(totalSeconds / 3600),
    m: Math.floor((totalSeconds % 3600) / 60),
    s: totalSeconds % 60,
  };
}

/* ------------------------------------------------------------------ */
/*  English                                                           */
/* ------------------------------------------------------------------ */

/** @type {import('./speech-locales.js').SpeechLocale} */
const en = {
  statusLabels: {
    1: 'Did Not Start',
    2: 'Did Not Finish',
    3: 'Mispunch',
    4: 'Disqualified',
    5: 'Overtime',
    11: 'Walkover',
  },

  spokenDuration(totalSeconds) {
    if (totalSeconds <= 0) return '';
    const { h, m, s } = hms(totalSeconds);
    const parts = [];
    if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
    if (s > 0) parts.push(`${s} second${s !== 1 ? 's' : ''}`);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  },

  finishLeader(evt, duration) {
    return `We have a new leader in class ${evt.className}, ${evt.runner} from ${evt.club}, with a time of ${duration}`;
  },
  finishOther(evt, duration, place) {
    return `We have a new runner in ${place} place, in class ${evt.className}: ${evt.runner} from ${evt.club}, ${duration} behind the leader.`;
  },
  splitLeader(evt, control, duration) {
    return `We have a new fastest time at the split control ${control} in the ${evt.className} class: ${evt.runner} from ${evt.club}, passing in ${duration}.`;
  },
  splitOther(evt, control, splitDuration, behind) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, has passed the split control ${control} in ${splitDuration}${behind}.`;
  },
  splitBehind(duration) {
    return `, ${duration} behind the leader`;
  },
  statusChange(evt, label) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, ${label}`;
  },
  fallback(evt) {
    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);
    return parts.join(', ');
  },
  aControl: 'a split control',
};

/* ------------------------------------------------------------------ */
/*  Swedish                                                           */
/* ------------------------------------------------------------------ */

/** @type {import('./speech-locales.js').SpeechLocale} */
const sv = {
  statusLabels: {
    1: 'Ej startat',
    2: 'Utgått',
    3: 'Felstämplat',
    4: 'Diskvalificerad',
    5: 'Övertid',
    11: 'Walkover',
  },

  spokenDuration(totalSeconds) {
    if (totalSeconds <= 0) return '';
    const { h, m, s } = hms(totalSeconds);
    const parts = [];
    if (h > 0) parts.push(`${h} timm${h !== 1 ? 'ar' : 'e'}`);
    if (m > 0) parts.push(`${m} minut${m !== 1 ? 'er' : ''}`);
    if (s > 0) parts.push(`${s} sekund${s !== 1 ? 'er' : ''}`);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' och ' + parts[parts.length - 1];
  },

  finishLeader(evt, duration) {
    return `Ny ledare i ${evt.className}, ${evt.runner} från ${evt.club}, med tiden ${duration}`;
  },
  finishOther(evt, duration, place) {
    return `Ny löpare på plats: ${place}, i ${evt.className}: ${evt.runner} från ${evt.club}, ${duration} efter ledaren.`;
  },
  splitLeader(evt, control, duration) {
    return `Ny bästa tid vid kontrollen ${control} i ${evt.className}: ${evt.runner} från ${evt.club}, passerade på ${duration}.`;
  },
  splitOther(evt, control, splitDuration, behind) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, har passerat kontrollen ${control} på ${splitDuration}${behind}.`;
  },
  splitBehind(duration) {
    return `, ${duration} efter ledaren`;
  },
  statusChange(evt, label) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, ${label}`;
  },
  fallback(evt) {
    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);
    return parts.join(', ');
  },
  aControl: 'en kontroll',
};

/* ------------------------------------------------------------------ */
/*  Norwegian (Bokmål)                                                */
/* ------------------------------------------------------------------ */

/** @type {import('./speech-locales.js').SpeechLocale} */
const nb = {
  statusLabels: {
    1: 'Ikke startet',
    2: 'Utgått',
    3: 'Feilstemplet',
    4: 'Diskvalifisert',
    5: 'Overtid',
    11: 'Walkover',
  },

  spokenDuration(totalSeconds) {
    if (totalSeconds <= 0) return '';
    const { h, m, s } = hms(totalSeconds);
    const parts = [];
    if (h > 0) parts.push(`${h} time${h !== 1 ? 'r' : ''}`);
    if (m > 0) parts.push(`${m} minutt${m !== 1 ? 'er' : ''}`);
    if (s > 0) parts.push(`${s} sekund${s !== 1 ? 'er' : ''}`);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' og ' + parts[parts.length - 1];
  },

  finishLeader(evt, duration) {
    return `Ny leder i ${evt.className}, ${evt.runner} fra ${evt.club}, med tiden ${duration}`;
  },
  finishOther(evt, duration, place) {
    return `Ny løper på plass: ${place}, i ${evt.className}: ${evt.runner} fra ${evt.club}, ${duration} bak lederen.`;
  },
  splitLeader(evt, control, duration) {
    return `Ny beste tid ved posten ${control} i ${evt.className}: ${evt.runner} fra ${evt.club}, passerte på ${duration}.`;
  },
  splitOther(evt, control, splitDuration, behind) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, har passert posten ${control} på ${splitDuration}${behind}.`;
  },
  splitBehind(duration) {
    return `, ${duration} bak lederen`;
  },
  statusChange(evt, label) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, ${label}`;
  },
  fallback(evt) {
    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);
    return parts.join(', ');
  },
  aControl: 'en post',
};

/* ------------------------------------------------------------------ */
/*  Danish                                                            */
/* ------------------------------------------------------------------ */

/** @type {import('./speech-locales.js').SpeechLocale} */
const da = {
  statusLabels: {
    1: 'Ikke startet',
    2: 'Udgået',
    3: 'Fejlstemplet',
    4: 'Diskvalificeret',
    5: 'Overtid',
    11: 'Walkover',
  },

  spokenDuration(totalSeconds) {
    if (totalSeconds <= 0) return '';
    const { h, m, s } = hms(totalSeconds);
    const parts = [];
    if (h > 0) parts.push(`${h} time${h !== 1 ? 'r' : ''}`);
    if (m > 0) parts.push(`${m} minut${m !== 1 ? 'ter' : ''}`);
    if (s > 0) parts.push(`${s} sekund${s !== 1 ? 'er' : ''}`);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' og ' + parts[parts.length - 1];
  },

  finishLeader(evt, duration) {
    return `Ny leder i ${evt.className}, ${evt.runner} fra ${evt.club}, med tiden ${duration}`;
  },
  finishOther(evt, duration, place) {
    return `Ny løber på plads: ${place}, i ${evt.className}: ${evt.runner} fra ${evt.club}, ${duration} efter lederen.`;
  },
  splitLeader(evt, control, duration) {
    return `Ny bedste tid ved posten ${control} i ${evt.className}: ${evt.runner} fra ${evt.club}, passerede på ${duration}.`;
  },
  splitOther(evt, control, splitDuration, behind) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, har passeret posten ${control} på ${splitDuration}${behind}.`;
  },
  splitBehind(duration) {
    return `, ${duration} efter lederen`;
  },
  statusChange(evt, label) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, ${label}`;
  },
  fallback(evt) {
    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);
    return parts.join(', ');
  },
  aControl: 'en post',
};

/* ------------------------------------------------------------------ */
/*  German                                                            */
/* ------------------------------------------------------------------ */

/** @type {import('./speech-locales.js').SpeechLocale} */
const de = {
  statusLabels: {
    1: 'Nicht gestartet',
    2: 'Aufgegeben',
    3: 'Fehlstempelung',
    4: 'Disqualifiziert',
    5: 'Überzeit',
    11: 'Walkover',
  },

  spokenDuration(totalSeconds) {
    if (totalSeconds <= 0) return '';
    const { h, m, s } = hms(totalSeconds);
    const parts = [];
    if (h > 0) parts.push(`${h} Stunde${h !== 1 ? 'n' : ''}`);
    if (m > 0) parts.push(`${m} Minute${m !== 1 ? 'n' : ''}`);
    if (s > 0) parts.push(`${s} Sekunde${s !== 1 ? 'n' : ''}`);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' und ' + parts[parts.length - 1];
  },

  finishLeader(evt, duration) {
    return `Neue Führung in ${evt.className}, ${evt.runner} von ${evt.club}, mit einer Zeit von ${duration}`;
  },
  finishOther(evt, duration, place) {
    return `Neuer Läufer auf Platz ${place}, in ${evt.className}: ${evt.runner} von ${evt.club}, ${duration} hinter dem Führenden.`;
  },
  splitLeader(evt, control, duration) {
    return `Neue Bestzeit am Posten ${control} in ${evt.className}: ${evt.runner} von ${evt.club}, durchgelaufen in ${duration}.`;
  },
  splitOther(evt, control, splitDuration, behind) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, hat den Posten ${control} passiert in ${splitDuration}${behind}.`;
  },
  splitBehind(duration) {
    return `, ${duration} hinter dem Führenden`;
  },
  statusChange(evt, label) {
    return `${evt.runner}, ${evt.club}, ${evt.className}, ${label}`;
  },
  fallback(evt) {
    const parts = [evt.runner];
    if (evt.club) parts.push(evt.club);
    parts.push(evt.className);
    return parts.join(', ');
  },
  aControl: 'ein Posten',
};

/* ------------------------------------------------------------------ */
/*  Registry & lookup                                                 */
/* ------------------------------------------------------------------ */

const LOCALES = { en, sv, nb, da, de };

/**
 * Get the locale matching a BCP-47 language code. Falls back to English.
 * @param {string} langCode — e.g. "sv-SE", "en-GB", "de-DE"
 * @returns {SpeechLocale}
 */
export function getLocale(langCode) {
  if (!langCode) return en;
  const prefix = langCode.split('-')[0].toLowerCase();
  return LOCALES[prefix] ?? en;
}

/**
 * @typedef {Object} SpeechLocale
 * @property {Record<number, string>} statusLabels
 * @property {(totalSeconds: number) => string} spokenDuration
 * @property {(evt: object, duration: string) => string} finishLeader
 * @property {(evt: object, duration: string, place: string|number) => string} finishOther
 * @property {(evt: object, control: string, duration: string) => string} splitLeader
 * @property {(evt: object, control: string, splitDuration: string, behind: string) => string} splitOther
 * @property {(duration: string) => string} splitBehind
 * @property {(evt: object, label: string) => string} statusChange
 * @property {(evt: object) => string} fallback
 * @property {string} aControl
 */
