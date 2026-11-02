import crypto from 'crypto';
import { kvs, kvsGet, kvsSet } from '../../lib/kvs.js';
import { errorResult } from '../../lib/errors.js';
import { sanitiseFilename } from '../../shared/filename.js';

/**
 * Screenshots never travel through a single request. The client uploads
 * base64 chunks (each comfortably under the 240 KiB KVS value limit and the
 * web-trigger body limit), then createIssue receives only `screenshotUploadId`.
 */
export const CHUNK_SIZE = 200 * 1024; // base64 chars per chunk (~150 KiB raw)
export const MAX_CHUNKS = 72;         // ≈14 MiB base64 ≈ 10 MiB binary; Jira's own limit decides
const TTL_SECONDS = 15 * 60;

function manifestKey(id) {
  return `screenshot:${id}`;
}

function chunkKey(id, index) {
  return `screenshot:${id}:${String(index).padStart(3, '0')}`;
}

function ownerOf(claims) {
  return (claims && claims.sub) || '';
}

function isUploadId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

export async function beginScreenshotUpload(payload, claims) {
  const mimeType = payload && payload.mimeType;
  const size = payload && payload.size;

  // Screenshots and attachments share this pipeline. Jira decides what it will
  // accept; we only guard against nonsense and the transport ceiling.
  if (typeof mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) {
    return errorResult('VALIDATION_ERROR', 'mimeType is invalid.');
  }
  if (!Number.isInteger(size) || size <= 0 || size > CHUNK_SIZE * MAX_CHUNKS) {
    return errorResult('VALIDATION_ERROR', 'File is too large for this upload path.');
  }

  const uploadId = crypto.randomBytes(16).toString('hex');
  const manifest = {
    owner: ownerOf(claims),
    mimeType,
    filename: sanitiseFilename(payload && payload.filename, mimeType),
    size,
    chunks: Math.ceil(size / CHUNK_SIZE),
    createdAt: Date.now(),
  };

  try {
    await kvsSet(manifestKey(uploadId), manifest, { ttl: { value: TTL_SECONDS, unit: 'SECONDS' } });
  } catch (e) {
    return errorResult('INTERNAL', 'Could not start the screenshot upload.');
  }

  return { ok: true, data: { uploadId, chunkSize: CHUNK_SIZE } };
}

export async function uploadScreenshotChunk(payload, claims) {
  const uploadId = payload && payload.uploadId;
  const index = payload && payload.index;
  const data = payload && payload.data;

  if (!isUploadId(uploadId)) return errorResult('BAD_REQUEST', 'uploadId is invalid.');
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
    return errorResult('BAD_REQUEST', 'chunk index is invalid.');
  }
  if (typeof data !== 'string' || data.length === 0 || data.length > CHUNK_SIZE) {
    return errorResult('VALIDATION_ERROR', 'Chunk is empty or too large.');
  }

  const manifest = await kvsGet(manifestKey(uploadId));
  if (!manifest) return errorResult('NOT_FOUND', 'Screenshot upload not found or expired.');
  if (manifest.owner !== ownerOf(claims)) {
    // Do not reveal whether the upload exists for another owner.
    return errorResult('NOT_FOUND', 'Screenshot upload not found or expired.');
  }
  if (index >= manifest.chunks) return errorResult('BAD_REQUEST', 'chunk index is out of range.');

  try {
    await kvsSet(chunkKey(uploadId, index), data, { ttl: { value: TTL_SECONDS, unit: 'SECONDS' } });
  } catch (e) {
    return errorResult('INTERNAL', 'Could not store the screenshot chunk.');
  }

  return { ok: true, data: { received: index } };
}

/** Assembles the chunks into a data URL. Owner-scoped; the caller must delete after use. */
export async function readScreenshotUpload(uploadId, claims) {
  if (!isUploadId(uploadId)) {
    return { ok: false, error: errorResult('BAD_REQUEST', 'screenshotUploadId is invalid.') };
  }

  const manifest = await kvsGet(manifestKey(uploadId));
  if (!manifest || manifest.owner !== ownerOf(claims)) {
    return { ok: false, error: errorResult('VALIDATION_ERROR', 'Screenshot upload is missing or expired.') };
  }

  const parts = [];
  for (let i = 0; i < manifest.chunks; i += 1) {
    const part = await kvsGet(chunkKey(uploadId, i));
    if (typeof part !== 'string' || part.length === 0) {
      return { ok: false, error: errorResult('VALIDATION_ERROR', 'Screenshot upload is incomplete.') };
    }
    parts.push(part);
  }

  return {
    ok: true,
    dataUrl: `data:${manifest.mimeType};base64,${parts.join('')}`,
    mimeType: manifest.mimeType,
    filename: manifest.filename,
    chunkCount: manifest.chunks,
  };
}

export async function deleteScreenshotUpload(uploadId, chunkCount) {
  if (!isUploadId(uploadId)) return;
  const keys = [manifestKey(uploadId)];
  for (let i = 0; i < chunkCount; i += 1) keys.push(chunkKey(uploadId, i));
  await Promise.all(keys.map(async (key) => {
    try {
      await kvs.delete(key);
    } catch (e) {
      // TTL will clean up; never fail the request for this.
    }
  }));
}
