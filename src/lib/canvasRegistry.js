import crypto from 'node:crypto';
import { kvsGet, kvsSet, kvsQueryAll, kvsDelete } from './kvs.js';
import { normaliseCanvasName, findRecordByName } from './canvasNames.js';

/**
 * Canvas registry (D42).
 *
 * A canvas used to be identified by its display name alone, which made renames
 * impossible and name collisions inevitable. Every canvas now has a stable
 * **key** — the seed ticket's key (`KAN-123`) when there is one, otherwise a
 * generated `c-xxxxxxxx`. The name is a label; every name a canvas has ever had
 * stays indexed so tickets written before a rename still resolve to it.
 *
 *   canvas:<key>            → { key, name, names, folder, createdAt, createdBy, archived }
 *   canvasName:<normalised> → <key>
 *
 * Ticket metadata keeps `pin.canvas` (the name at capture time) and gains
 * `pin.canvasId` (the key) for everything written from now on.
 */

const RECORD_PREFIX = 'canvas:';
const NAME_PREFIX = 'canvasName:';
const RECORD_VERSION = 1;

// Card previews are data URLs (~40–90 KB each), so they cannot ride in the
// dashboard summary cache without risking the KVS document limit. They live in
// their own installation-level document, keyed by a stamp that changes whenever
// a preview is written or cleared.
const PREVIEW_STAMP_KEY = 'canvasPreviewStamp';
const PREVIEW_CACHE_KEY = 'canvasPreviewCache';
const PREVIEW_CACHE_MAX_CHARS = 120000;

// The launcher rebuilds the registry on every open (up to 140 KVS queries at the
// caps). Records are small once the preview payload is stripped, so the launch
// list can be served from one stamped document instead.
const REGISTRY_STAMP_KEY = 'canvasRegistryStamp';
const REGISTRY_CACHE_KEY = 'canvasRegistryCache';
const REGISTRY_CACHE_MAX_CHARS = 120000;

/** Changes whenever a canvas record is written or deleted. */
export async function readRegistryStamp() {
  try {
    const value = await kvsGet(REGISTRY_STAMP_KEY);
    return typeof value === 'number' ? value : 0;
  } catch (e) {
    return 0;
  }
}

async function bumpRegistryStamp() {
  try {
    await kvsSet(REGISTRY_STAMP_KEY, Date.now());
  } catch (e) {
    // A stale launcher cache only delays a new canvas by one open.
  }
}

/**
 * The launcher's registry, stripped of preview data and filed under a stamp.
 * Returns `{ records: Map, nameIndex: Map }`, or null when absent, stale, or too
 * large to have been cached.
 */
export async function loadRegistrySnapshot() {
  try {
    const cached = await kvsGet(REGISTRY_CACHE_KEY);
    if (!cached || !Array.isArray(cached.records)) return null;
    const stamp = await readRegistryStamp();
    if (cached.stamp !== stamp) return null;
    return {
      records: new Map(cached.records.map((record) => [record.key, record])),
      nameIndex: new Map(Array.isArray(cached.index) ? cached.index : []),
    };
  } catch (e) {
    return null;
  }
}

export async function saveRegistrySnapshot(records, nameIndex) {
  const stamp = await readRegistryStamp();
  const payload = {
    stamp,
    records: [...records.values()].map((record) => ({
      key: record.key,
      name: record.name,
      names: Array.isArray(record.names) ? record.names : [record.name],
      folder: record.folder || null,
      archived: record.archived === true,
    })),
    index: [...nameIndex.entries()],
  };
  try {
    if (JSON.stringify(payload).length > REGISTRY_CACHE_MAX_CHARS) {
      await kvsDelete(REGISTRY_CACHE_KEY);
      return false;
    }
    await kvsSet(REGISTRY_CACHE_KEY, payload);
    return true;
  } catch (e) {
    return false;
  }
}

/** Changes whenever any canvas preview is written or cleared. */
export async function readPreviewStamp() {
  try {
    const value = await kvsGet(PREVIEW_STAMP_KEY);
    return typeof value === 'number' ? value : 0;
  } catch (e) {
    return 0;
  }
}

async function bumpPreviewStamp() {
  const next = Date.now();
  try {
    await kvsSet(PREVIEW_STAMP_KEY, next);
  } catch (e) {
    // The stamp is an optimisation: a stale cache only delays a new preview.
  }
  return next;
}

/** The cached `{ key: dataUrl }` map, or null when absent. */
export async function loadPreviewCache() {
  try {
    const value = await kvsGet(PREVIEW_CACHE_KEY);
    if (!value || typeof value !== 'object' || !value.previews) return null;
    return value;
  } catch (e) {
    return null;
  }
}

/**
 * Cache the preview map, but only while it comfortably fits a KVS document.
 * A larger install falls back to reading the records, which is slower but never
 * wrong — the alternative is a cache write that fails on every request.
 */
export async function savePreviewCache(previews, stamp) {
  const payload = { stamp, previews };
  try {
    if (JSON.stringify(payload).length > PREVIEW_CACHE_MAX_CHARS) {
      await kvsDelete(PREVIEW_CACHE_KEY);
      return false;
    }
    await kvsSet(PREVIEW_CACHE_KEY, payload);
    return true;
  } catch (e) {
    return false;
  }
}

export { normaliseCanvasName, findRecordByName };

export function generatedCanvasKey(name) {
  const digest = crypto.createHash('sha1').update(String(name)).digest('hex');
  return `c-${digest.slice(0, 8)}`;
}

export function canvasRecordKey(key) {
  return `${RECORD_PREFIX}${key}`;
}

export function canvasNameIndexKey(name) {
  return `${NAME_PREFIX}${normaliseCanvasName(name)}`;
}

export async function readCanvasRecord(key) {
  if (!key) return null;
  try {
    const record = await kvsGet(canvasRecordKey(key));
    if (!record || typeof record !== 'object' || !record.key) return null;
    return {
      ...record,
      names: Array.isArray(record.names) ? record.names : [record.name],
    };
  } catch (e) {
    return null;
  }
}

async function writeCanvasRecord(record) {
  const names = Array.from(new Set(
    [record.name, ...(Array.isArray(record.names) ? record.names : [])]
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  ));
  const next = {
    ...record,
    version: RECORD_VERSION,
    name: String(record.name || '').trim(),
    names,
  };
  await kvsSet(canvasRecordKey(next.key), next);
  await bumpRegistryStamp();
  // Every historical name points at the same key, so renaming never orphans
  // the tickets written before it.
  for (const name of names) {
    try {
      await kvsSet(canvasNameIndexKey(name), next.key);
    } catch (e) {
      // A failed index write is repaired on the next ensure/aggregate pass.
    }
  }
  return next;
}

/** The record for a name, creating one if this name has never been seen. */
export async function ensureCanvasRecord({ name, seedKey, createdBy, folder } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  // The canvas id a client sends is sometimes the stable key (the launcher
  // lists canvases by key) and sometimes the label. Resolving only the label
  // used to create a second record named "c-…", orphaning the real one — which
  // is how a stored preview could never reach the card.
  if (/^c-[a-f0-9]{6,}$/i.test(trimmed)) {
    const byKey = await readCanvasRecord(trimmed);
    if (byKey) return { record: byKey, created: false };
  }

  try {
    const existingKey = await kvsGet(canvasNameIndexKey(trimmed));
    if (existingKey) {
      const existing = await readCanvasRecord(existingKey);
      if (existing) return { record: existing, created: false };
    }
  } catch (e) {
    // Fall through and create a record; the caller's operation is more
    // important than the index read.
  }

  const key = String(seedKey || '').trim() || generatedCanvasKey(trimmed);

  // Legacy canvases are keyed by a hash of the name, so the key may already be
  // taken by the record this name belongs to. Reuse it rather than overwriting
  // the record (which would drop its folder and card preview).
  const existingAtKey = await readCanvasRecord(key);
  if (existingAtKey) {
    try {
      await kvsSet(canvasNameIndexKey(trimmed), existingAtKey.key);
    } catch (e) {
      // The index is repaired by the next aggregate pass.
    }
    return { record: existingAtKey, created: false };
  }

  const record = {
    version: RECORD_VERSION,
    key,
    name: trimmed,
    names: [trimmed],
    folder: folder || null,
    createdAt: Date.now(),
    createdBy: createdBy || null,
    archived: false,
  };
  try {
    const written = await writeCanvasRecord(record);
    return { record: written, created: true };
  } catch (e) {
    return { record, created: true };
  }
}

export async function findCanvasKeyForName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  try {
    const key = await kvsGet(canvasNameIndexKey(trimmed));
    if (typeof key === 'string' && key) return key;
  } catch (e) {
    // Fall through to the key check.
  }
  // Callers pass whichever id they hold: a label or a stable key.
  if (/^c-[a-f0-9]{6,}$/i.test(trimmed)) {
    const record = await readCanvasRecord(trimmed);
    if (record) return record.key;
  }
  return null;
}

/** Rename the label. Historical names stay indexed. */
export async function renameCanvasRecord(key, newName) {
  const record = await readCanvasRecord(key);
  if (!record) return { ok: false, reason: 'NOT_FOUND' };

  const trimmed = String(newName || '').trim();
  if (!trimmed) return { ok: false, reason: 'BAD_NAME' };

  try {
    const owner = await kvsGet(canvasNameIndexKey(trimmed));
    if (owner && owner !== key) return { ok: false, reason: 'NAME_TAKEN', owner };
  } catch (e) {
    // Proceed; a duplicate label is recoverable, a failed rename is not.
  }

  const next = await writeCanvasRecord({ ...record, name: trimmed });
  return { ok: true, record: next };
}

export async function setCanvasFolder(key, folder) {
  const record = await readCanvasRecord(key);
  if (!record) return null;
  return writeCanvasRecord({ ...record, folder: folder || null });
}

/** The canvas card preview lives on the record, so clearing cannot miss a key. */
export async function setCanvasThumbnail(key, dataUrl) {
  const record = await readCanvasRecord(key);
  if (!record) return null;
  const next = {
    ...record,
    thumbnail: dataUrl,
    thumbnailAt: Date.now(),
    thumbnailVersion: 2,
  };
  delete next.thumbnailNote;
  const written = await writeCanvasRecord(next);
  await bumpPreviewStamp();
  return written;
}

/**
 * Pre-5.72 builds kept the card preview in its own KVS key. The record is the
 * only home now, so adopt whatever is still there and delete the old key: one
 * generation, nothing lost, and no read of the old key ever again.
 */
export async function adoptLegacyThumbnail(key) {
  if (!key) return null;
  const record = await readCanvasRecord(key);
  if (!record) return record;
  if (record.thumbnailVersion === 2 && record.thumbnail) {
    await kvsDelete(`canvasThumb:${key}`).catch(() => {});
    return record;
  }

  let legacy = null;
  try {
    legacy = await kvsGet(`canvasThumb:${key}`);
  } catch (e) {
    return record;
  }
  if (!legacy) return record;

  // The old record shape is not worth depending on: take whichever string
  // value is the image.
  const dataUrl = typeof legacy === 'string'
    ? legacy
    : Object.values(legacy).find((value) => typeof value === 'string' && value.indexOf('data:image/') === 0);

  if (typeof dataUrl === 'string' && dataUrl.indexOf('data:image/') === 0) {
    try {
      const adopted = await setCanvasThumbnail(key, dataUrl);
      if (adopted) {
        await kvsDelete(`canvasThumb:${key}`).catch(() => {});
        return adopted;
      }
    } catch (e) {
      // Keep the old key: the next pass tries again rather than losing the image.
      return record;
    }
  }

  // Nothing usable: the key is dead weight either way.
  await kvsDelete(`canvasThumb:${key}`).catch(() => {});
  return record;
}

/** Why a canvas has no preview, so the dashboard can say rather than guess. */
export async function setCanvasThumbnailNote(key, note) {
  const record = await readCanvasRecord(key);
  if (!record) return null;
  const next = { ...record };
  if (note) next.thumbnailNote = String(note).slice(0, 200);
  else delete next.thumbnailNote;
  return writeCanvasRecord(next);
}

export async function clearCanvasThumbnail(key) {
  const record = await readCanvasRecord(key);
  if (!record) return null;
  const next = { ...record };
  delete next.thumbnail;
  delete next.thumbnailAt;
  delete next.thumbnailVersion;
  delete next.thumbnailNote;
  const written = await writeCanvasRecord(next);
  await bumpPreviewStamp();
  return written;
}

export async function setCanvasArchived(key, archived) {
  const record = await readCanvasRecord(key);
  if (!record) return null;
  return writeCanvasRecord({ ...record, archived: archived === true });
}

export async function deleteCanvasRecord(key) {
  if (!key) return;
  try {
    await kvsDelete(canvasRecordKey(key));
    // Name index entries are left in place: deleting them could make a
    // recreated canvas adopt old tickets silently.
    await bumpRegistryStamp();
    await bumpPreviewStamp();
  } catch (e) {
    // ignore
  }
}

/** All records, one paged query. */
export async function loadCanvasRecords({ max = 2000 } = {}) {
  const map = new Map();
  try {
    const entries = await kvsQueryAll(RECORD_PREFIX, { max, pageSize: 50 });
    entries.forEach((row) => {
      const record = row && row.value;
      if (!record || !record.key) return;
      map.set(record.key, {
        ...record,
        names: Array.isArray(record.names) ? record.names : [record.name],
      });
    });
  } catch (e) {
    // An unavailable registry degrades to the ticket scan below.
  }
  return map;
}

/** Normalised name → key, one paged query. */
export async function loadCanvasNameIndex({ max = 5000 } = {}) {
  const map = new Map();
  try {
    const entries = await kvsQueryAll(NAME_PREFIX, { max, pageSize: 50 });
    entries.forEach((row) => {
      if (!row || !row.key || typeof row.value !== 'string') return;
      map.set(String(row.key).slice(NAME_PREFIX.length), row.value);
    });
  } catch (e) {
    // ignore
  }
  return map;
}
