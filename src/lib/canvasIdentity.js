import {
  canvasNameIndexKey,
  findCanvasKeyForName,
  generatedCanvasKey,
  loadCanvasRecords,
  readCanvasRecord,
} from './canvasRegistry.js';
import { findRecordByName, normaliseCanvasName } from './canvasNames.js';
import { kvsSet } from './kvs.js';

/**
 * Canvas identity (D42, consolidated).
 *
 * The wire carries two things that used to be confused: a **key** (the stable
 * id — a seed ticket key such as `KAN-90`, or a generated `c-xxxxxxxx`) and a
 * **name** (an editable label). A request id can be either, so every caller
 * asked "which canvas is this" in its own way and the answers disagreed.
 *
 * This module is the only place that answers it. Callers pass whatever they
 * hold; the resolver tries, in order:
 *
 *   1. the value as a record key;
 *   2. the value as a name through the `canvasName:` index;
 *   3. the value as a name through the deterministic generated key;
 *   4. optionally, a scan of all records (a seed-key canvas whose index row was
 *      lost can only be found this way).
 *
 * Step 3 is what makes a pre-seed canvas resolve in one read instead of a scan.
 */

/** Generated keys are `c-` plus eight hex characters; nothing else looks like one. */
export function isGeneratedCanvasKey(value) {
  return /^c-[a-f0-9]{8}$/i.test(String(value || '').trim());
}

/**
 * A value that could be a record key: a generated key or a Jira issue key.
 * Used only to decide whether an attempted key read is worth doing — callers
 * must not reject a value just because it looks like a key.
 */
export function looksLikeRecordKey(value) {
  const trimmed = String(value || '').trim();
  return isGeneratedCanvasKey(trimmed) || /^[A-Z][A-Z0-9_]*-\d+$/i.test(trimmed);
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A resolution that had to bypass the name index repairs it, once. Otherwise a
 * canvas with a lost index row pays for a full record scan on every call — and
 * `getPins` runs every 15 seconds.
 */
async function repairNameIndex(record, extraNames) {
  const names = new Set([...(record.names || []), ...extraNames]);
  for (const name of names) {
    if (!name) continue;
    try {
      await kvsSet(canvasNameIndexKey(name), record.key);
    } catch (e) {
      // A failed repair only costs the next caller a scan.
    }
  }
}

function nameCandidates(key, name) {
  const values = [];
  if (name) values.push(name);
  if (key && key !== name && !isGeneratedCanvasKey(key)) values.push(key);
  return values;
}

function keyCandidates(key, name) {
  const values = [];
  if (key && looksLikeRecordKey(key)) values.push(key);
  if (name && name !== key && looksLikeRecordKey(name)) values.push(name);
  return values;
}

/**
 * The canonical resolver. Returns the record, or null when the canvas is
 * unknown (a deleted canvas, never registered, or a name that resolves to
 * nothing).
 */
export async function resolveCanvas({ canvasKey, canvasName } = {}, options = {}) {
  const key = trim(canvasKey);
  const name = trim(canvasName);

  // A key always wins: it is the stable id.
  for (const candidate of keyCandidates(key, name)) {
    const record = await readCanvasRecord(candidate);
    if (record) return record;
  }

  let indexMissed = false;
  for (const candidate of nameCandidates(key, name)) {
    const indexedKey = await findCanvasKeyForName(candidate);
    if (indexedKey) {
      const record = await readCanvasRecord(indexedKey);
      if (record) return record;
    } else {
      indexMissed = true;
    }
    // Pre-seed canvases are keyed by a hash of their name: one read, no scan.
    const derived = await readCanvasRecord(generatedCanvasKey(candidate));
    if (derived) {
      if (indexMissed) await repairNameIndex(derived, [candidate]);
      return derived;
    }
  }

  if (options.scan) {
    const records = await loadCanvasRecords();
    for (const candidate of nameCandidates(key, name)) {
      const found = findRecordByName(records, candidate);
      if (found) {
        await repairNameIndex(found, [candidate]);
        return found;
      }
    }
  }

  return null;
}

/**
 * The same resolution with the registry already in memory — for callers that
 * load the records and the name index once and resolve many tickets
 * (dashboard aggregate, launcher). Never touches the platform.
 */
export function findCanvasKeyInMaps({ canvasKey, canvasName } = {}, records, nameIndex) {
  const key = trim(canvasKey);
  const name = trim(canvasName);

  if (key && records.has(key)) return key;
  if (name && records.has(name)) return name;

  for (const candidate of nameCandidates(key, name)) {
    const indexed = nameIndex.get(normaliseCanvasName(candidate));
    if (indexed && records.has(indexed)) return indexed;

    const derived = generatedCanvasKey(candidate);
    if (records.has(derived)) return derived;

    const byName = findRecordByName(records, candidate);
    if (byName) return byName.key;
  }

  return null;
}

/**
 * A request payload names the canvas in one of two fields depending on the
 * action (`canvasKey`/`canvasName` in the dashboard, `canvasId` in the public
 * API). Normalise it once.
 */
export function canvasIdsFromPayload(payload) {
  const canvasKey = trim(payload && payload.canvasKey);
  const canvasName = trim(payload && payload.canvasName);
  const canvasId = trim(payload && payload.canvasId);

  const ids = { canvasKey, canvasName };
  if (!canvasKey && canvasId && looksLikeRecordKey(canvasId)) ids.canvasKey = canvasId;
  if (!canvasName && canvasId && !looksLikeRecordKey(canvasId)) ids.canvasName = canvasId;
  return ids;
}
