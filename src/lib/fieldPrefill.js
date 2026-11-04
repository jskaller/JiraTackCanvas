import crypto from 'node:crypto';

/**
 * Canvas field pre-fills (D41, revised).
 *
 * A canvas can pre-fill Jira text fields on every ticket it creates — for
 * example "every URL on this canvas references a Figma link". The allowed
 * fields come from the project's configuration (`projects[key].textFields`),
 * so admins decide what is available and canvas creators only choose values.
 *
 * A pre-fill is written directly only when the field is on the Create screen
 * for the ticket's project + issue type. Otherwise it is appended to the
 * description as `Field: value`, so a value is never dropped silently.
 *
 * Shape stored per canvas (KVS, keyed by the canvas key):
 *   { version: 2, prefillFields: [{ fieldId, fieldName, value }] }
 * Earlier records also carried a projectKey; it is no longer written or read.
 *
 * Rows from the first D41 iteration (`{ label, value, mode }`) are still read:
 * a mapped row becomes a pre-fill for its target field and a description row
 * becomes a label-only row that always lands in the description.
 */

export const MAX_PREFILL_FIELDS = 10;
export const MAX_PREFILL_VALUE = 2000;
export const MAX_FIELD_NAME = 120;

const KVS_PREFIX = 'canvasAux:';

// Fields the app writes itself; a pre-fill must never clobber them.
export const MANAGED_FIELD_IDS = new Set([
  'summary', 'description', 'labels', 'issuetype', 'project', 'reporter',
  'assignee', 'priority', 'parent', 'status', 'attachment', 'comment',
  'created', 'updated', 'resolution', 'resolutiondate', 'timetracking',
  'worklog', 'workratio', 'environment', 'security', 'issuelinks',
]);

export function prefillConfigKey(canvasKey) {
  const digest = crypto.createHash('sha256').update(String(canvasKey)).digest('hex').slice(0, 32);
  return `${KVS_PREFIX}${digest}`;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanName(value) {
  return cleanString(value).slice(0, MAX_FIELD_NAME);
}

/**
 * Validate the creator's rows. Returns `{ ok, fields }` or
 * `{ ok: false, message }`; callers turn the message into a 400.
 *
 * A row with a `fieldId` writes to that field (falling back to the description
 * when it is not on the ticket's Create screen). A row without one is a
 * label-only note and always goes to the description.
 */
export function normalizePrefillFields(input) {
  if (input === undefined || input === null) return { ok: true, fields: [] };
  if (!Array.isArray(input)) {
    return { ok: false, message: 'prefillFields must be an array.' };
  }
  if (input.length > MAX_PREFILL_FIELDS) {
    return { ok: false, message: `At most ${MAX_PREFILL_FIELDS} pre-filled fields are supported.` };
  }

  const fields = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: 'Each pre-filled field must be an object.' };
    }

    // Legacy D41 shape.
    const legacyMapped = raw.mode === 'mapped' && cleanString(raw.targetFieldId);
    const fieldId = cleanString(raw.fieldId) || (legacyMapped ? cleanString(raw.targetFieldId) : '');
    const fieldName = cleanName(raw.fieldName)
      || (legacyMapped ? cleanName(raw.targetFieldName) : '')
      || cleanString(raw.label);
    const value = cleanString(raw.value);

    if (!fieldId && !fieldName) {
      return { ok: false, message: 'A pre-filled field needs a Jira field or a label.' };
    }
    if (!value) {
      return { ok: false, message: `${fieldName || fieldId} needs a value.` };
    }
    if (value.length > MAX_PREFILL_VALUE) {
      return { ok: false, message: `${fieldName || fieldId} is longer than ${MAX_PREFILL_VALUE} characters.` };
    }
    if (fieldId && MANAGED_FIELD_IDS.has(fieldId)) {
      return { ok: false, message: `${fieldName || fieldId} is written by JiraTack and cannot be pre-filled.` };
    }

    fields.push({
      fieldId: fieldId || null,
      fieldName: fieldName || fieldId,
      value,
    });
  }
  return { ok: true, fields };
}

/** `Label: value` pairs for the description, in the creator's order. */
export function prefillDescriptionEntries(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field && field.fieldName && field.value)
    .map((field) => ({ label: field.fieldName, value: field.value }));
}

/**
 * Split the canvas rows for one ticket.
 *
 * `availableFieldIds` is the set of field IDs on the Create screen for this
 * ticket's project + issue type, or `null` when that cannot be determined.
 * Only a known-available field is written; everything else falls back to the
 * description, including label-only rows.
 */
export function splitPrefillForCreate(fields, availableFieldIds) {
  const list = Array.isArray(fields) ? fields : [];
  const available = availableFieldIds instanceof Set ? availableFieldIds : null;
  const writable = {};
  const fallback = [];

  list.forEach((field) => {
    if (!field || !field.value) return;
    if (
      field.fieldId
      && !MANAGED_FIELD_IDS.has(field.fieldId)
      && available
      && available.has(field.fieldId)
    ) {
      writable[field.fieldId] = field.value;
      return;
    }
    fallback.push(field);
  });

  return { writable, fallback };
}

/**
 * Read the stored canvas record. Accepts the D41 array shape and the version-2
 * object shape, so a canvas created before this change keeps working.
 */
export function readCanvasPrefill(stored) {
  if (!stored) return [];
  if (Array.isArray(stored)) {
    const normalised = normalizePrefillFields(stored);
    return normalised.ok ? normalised.fields : [];
  }
  if (typeof stored === 'object') {
    const normalised = normalizePrefillFields(stored.prefillFields);
    return normalised.ok ? normalised.fields : [];
  }
  return [];
}
