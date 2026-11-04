export const METADATA_PROPERTY_KEY = 'com.jiratack.metadata';
export const METADATA_VERSION = 1;

/**
 * JiraTackMetadata:
 * {
 *   bindingId?: string,            // HMAC(email) — reviewer binding, guest tickets only (D27)
 *   guest?: { name: string, email: string },
 *   pin: { canvas: string, url: string, position: string, selector: string | null },
 *   capture?: object,              // element/viewport/environment at capture time
 *   textChange?: { original: string, suggested: string }, // D35, machine-readable copy
 *   screenshotVersion?: number,    // increments per superseding screenshot (D33)
 *   version: number
 * }
 *
 * This module is pure so the round-trip can be unit-tested. It is applied on
 * BOTH read and write: a field missing here is dropped on write and invisible
 * on read, which is why bindingId had to be added in one place.
 */

const BINDING_ID_RE = /^[a-f0-9]{64}$/;
const PAIRING_ID_RE = /^[a-f0-9]{64}$/;

export function normalizeMetadata(input) {
  if (!input || typeof input !== 'object') return null;
  const pin = input.pin;
  if (!pin || typeof pin !== 'object') return null;
  if (typeof pin.canvas !== 'string' || pin.canvas.length === 0) return null;
  if (typeof pin.url !== 'string' || pin.url.length === 0) return null;
  if (typeof pin.position !== 'string' || pin.position.length === 0) return null;

  const metadata = {
    pin: {
      canvas: pin.canvas,
      url: pin.url,
      position: pin.position,
      selector: typeof pin.selector === 'string' && pin.selector.length > 0 ? pin.selector : null,
    },
    version: typeof input.version === 'number' ? input.version : METADATA_VERSION,
  };

  // Stable canvas identity (D42). Absent on tickets written before keys existed;
  // those resolve by name through the registry.
  if (typeof pin.canvasId === 'string' && pin.canvasId.length > 0) {
    metadata.pin.canvasId = pin.canvasId;
  }

  if (typeof input.bindingId === 'string' && BINDING_ID_RE.test(input.bindingId)) {
    metadata.bindingId = input.bindingId;
  }

  if (typeof input.pairingId === 'string' && PAIRING_ID_RE.test(input.pairingId)) {
    metadata.pairingId = input.pairingId;
  }

  if (
    input.guest
    && typeof input.guest === 'object'
    && typeof input.guest.name === 'string'
    && input.guest.name.length > 0
    && typeof input.guest.email === 'string'
  ) {
    metadata.guest = { name: input.guest.name, email: input.guest.email };
  }

  const capture = normaliseCapture(input.capture);
  if (capture) metadata.capture = capture;

  const textChange = normaliseTextChange(input.textChange);
  if (textChange) metadata.textChange = textChange;

  // Superseded screenshots (D33). Absent on tickets created before the field
  // existed, so a missing value is valid and simply means zero.
  if (Number.isInteger(input.screenshotVersion) && input.screenshotVersion > 0) {
    metadata.screenshotVersion = input.screenshotVersion;
  }

  return metadata;
}

const MAX_TEXT_CHANGE = 2000;

/**
 * The text-change suggestion is stored twice: as human-readable description
 * copy and here for the post-creation preview (D35). Both fields are required;
 * an empty pair is not a suggestion.
 */
function normaliseAnchorPath(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return null;
  const clean = value.filter((entry) => Number.isInteger(entry) && entry >= 0);
  return clean.length === value.length ? clean : null;
}

/**
 * The precise node path is what makes the on-page preview work after creation.
 * Without it the preview can only search for the phrase, which fails whenever
 * the text appears more than once (D35 follow-up).
 */
function normaliseTextAnchor(input) {
  if (!input || typeof input !== 'object') return null;
  const startPath = normaliseAnchorPath(input.start && input.start.path);
  const endPath = normaliseAnchorPath(input.end && input.end.path);
  const startOffset = input.start && input.start.offset;
  const endOffset = input.end && input.end.offset;
  if (!startPath || !endPath) return null;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return null;
  return {
    start: { path: startPath, offset: startOffset },
    end: { path: endPath, offset: endOffset },
    ancestorSelector: typeof input.ancestorSelector === 'string' && input.ancestorSelector.length <= 200
      ? input.ancestorSelector
      : null,
  };
}

export function normaliseTextChange(input) {
  if (!input || typeof input !== 'object') return null;
  const original = typeof input.original === 'string' ? input.original.trim() : '';
  const suggested = typeof input.suggested === 'string' ? input.suggested.trim() : '';
  if (!original || !suggested) return null;
  const anchor = normaliseTextAnchor(input.anchor);
  return {
    original: original.slice(0, MAX_TEXT_CHANGE),
    suggested: suggested.slice(0, MAX_TEXT_CHANGE),
    ...(anchor ? { anchor } : {}),
  };
}

const CAP_HTML = 2000;
const CAP_STYLES = 1000;
const CAP_UA = 512;
const CAP_TAG = 32;
const CAP_ENV = 64;

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Caps are load-bearing: this object is written to a Jira entity property, and
 * an unbounded outerHTML would blow the property ceiling and lose the write.
 */
export function normaliseCapture(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};

  if (input.element && typeof input.element === 'object') {
    out.element = {
      tag: clip(input.element.tag, CAP_TAG),
      htmlSnippet: clip(input.element.htmlSnippet, CAP_HTML),
      styles: clip(input.element.styles, CAP_STYLES),
    };
  }

  if (input.viewport && typeof input.viewport === 'object') {
    out.viewport = {
      width: finite(input.viewport.width, 0),
      height: finite(input.viewport.height, 0),
      devicePixelRatio: finite(input.viewport.devicePixelRatio, 1),
    };
  }

  if (input.environment && typeof input.environment === 'object') {
    out.environment = {
      browser: clip(input.environment.browser, CAP_ENV),
      os: clip(input.environment.os, CAP_ENV),
      userAgent: clip(input.environment.userAgent, CAP_UA),
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Reads metadata from a search/issue payload that already requested the property. */
export function metadataFromIssue(issue, key = METADATA_PROPERTY_KEY) {
  if (!issue) return null;
  const fromIssue = issue.properties && issue.properties[key];
  if (fromIssue) return normalizeMetadata(fromIssue);
  const fromFields = issue.fields && issue.fields.properties && issue.fields.properties[key];
  if (fromFields) return normalizeMetadata(fromFields);
  return null;
}
