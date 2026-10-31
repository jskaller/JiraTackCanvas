export const METADATA_PROPERTY_KEY = 'com.jiratack.metadata';
export const METADATA_VERSION = 1;

/**
 * JiraTackMetadata:
 * {
 *   bindingId?: string,            // HMAC(email) — reviewer binding, guest tickets only (D27)
 *   guest?: { name: string, email: string },
 *   pin: { canvas: string, url: string, position: string, selector: string | null },
 *   version: number
 * }
 *
 * This module is pure so the round-trip can be unit-tested. It is applied on
 * BOTH read and write: a field missing here is dropped on write and invisible
 * on read, which is why bindingId had to be added in one place.
 */

const BINDING_ID_RE = /^[a-f0-9]{64}$/;

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

  if (typeof input.bindingId === 'string' && BINDING_ID_RE.test(input.bindingId)) {
    metadata.bindingId = input.bindingId;
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

  return metadata;
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
