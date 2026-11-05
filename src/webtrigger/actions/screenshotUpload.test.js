import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { kvsKeys, readKvs, resetKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi } from '../../../scripts/test-support/stubs/forge-api.mjs';
import {
  CHUNK_SIZE,
  MAX_CHUNKS,
  beginScreenshotUpload,
  deleteScreenshotUpload,
  readScreenshotUpload,
  uploadScreenshotChunk,
} from './screenshotUpload.js';

const ME = { sub: 'acc-1', scope: 'create', permittedProjects: '*' };
const OTHER = { sub: 'acc-2', scope: 'create', permittedProjects: '*' };

beforeEach(() => {
  resetKvs();
  resetApi();
});

async function startUpload(overrides = {}) {
  const result = await beginScreenshotUpload({
    mimeType: 'image/png',
    filename: 'shot.png',
    size: 10,
    ...overrides,
  }, ME);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

test('a screenshot upload is chunked, owner-scoped and assembled back', async () => {
  const { uploadId, chunkSize } = await startUpload();
  assert.match(uploadId, /^[a-f0-9]{32}$/);
  assert.equal(chunkSize, CHUNK_SIZE);

  const uploaded = await uploadScreenshotChunk({ uploadId, index: 0, data: 'iVBORw0KGgo=' }, ME);
  assert.equal(uploaded.ok, true);

  const read = await readScreenshotUpload(uploadId, ME);
  assert.equal(read.ok, true);
  assert.equal(read.dataUrl, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(read.filename, 'shot.png');
  assert.equal(read.chunkCount, 1);
});

test('another account cannot see or append to an upload', async () => {
  const { uploadId } = await startUpload();

  const read = await readScreenshotUpload(uploadId, OTHER);
  assert.equal(read.ok, false);
  assert.equal(read.error.error.code, 'VALIDATION_ERROR');

  const append = await uploadScreenshotChunk({ uploadId, index: 0, data: 'AAAA' }, OTHER);
  assert.equal(append.ok, false);
  assert.equal(append.error.code, 'NOT_FOUND');
});

test('a chunk outside the declared range is refused', async () => {
  const { uploadId } = await startUpload();

  const tooFar = await uploadScreenshotChunk({ uploadId, index: 3, data: 'AAAA' }, ME);
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.error.code, 'BAD_REQUEST');

  const tooBig = await uploadScreenshotChunk({ uploadId, index: 0, data: 'A'.repeat(CHUNK_SIZE + 1) }, ME);
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.error.code, 'VALIDATION_ERROR');

  const empty = await uploadScreenshotChunk({ uploadId, index: 0, data: '' }, ME);
  assert.equal(empty.ok, false);
});

test('a missing chunk reads as incomplete, not as a short file', async () => {
  const { uploadId } = await startUpload({ size: CHUNK_SIZE + 10 });
  await uploadScreenshotChunk({ uploadId, index: 0, data: 'A'.repeat(CHUNK_SIZE) }, ME);

  const read = await readScreenshotUpload(uploadId, ME);
  assert.equal(read.ok, false);
  assert.equal(read.error.error.code, 'VALIDATION_ERROR');
  assert.match(read.error.error.message, /incomplete/i);
});

test('upload metadata is validated before anything is stored', async () => {
  const badMime = await beginScreenshotUpload({ mimeType: 'not a mime', filename: 'x', size: 10 }, ME);
  assert.equal(badMime.error.code, 'VALIDATION_ERROR');

  const noSize = await beginScreenshotUpload({ mimeType: 'image/png', filename: 'x', size: 0 }, ME);
  assert.equal(noSize.error.code, 'VALIDATION_ERROR');

  const tooLarge = await beginScreenshotUpload({
    mimeType: 'image/png',
    filename: 'x',
    size: CHUNK_SIZE * MAX_CHUNKS + 1,
  }, ME);
  assert.equal(tooLarge.error.code, 'VALIDATION_ERROR');
});

test('a hostile filename is sanitised, not trusted', async () => {
  const { uploadId } = await startUpload({ filename: '../../etc/passwd?.png' });
  await uploadScreenshotChunk({ uploadId, index: 0, data: 'AAAA' }, ME);
  const read = await readScreenshotUpload(uploadId, ME);

  assert.equal(read.ok, true);
  // Separators, quotes and control characters are the header-injection and
  // traversal risks; `..` without a separator is just dots in a name.
  assert.ok(!/[\\/]/.test(read.filename), `filename kept a separator: ${read.filename}`);
  assert.ok(!/["'\r\n\0]/.test(read.filename), `filename kept a header character: ${read.filename}`);
  assert.match(read.filename, /\.png$/);
});

test('deleting an upload removes the manifest and every chunk', async () => {
  const { uploadId } = await startUpload({ size: CHUNK_SIZE + 10 });
  await uploadScreenshotChunk({ uploadId, index: 0, data: 'A'.repeat(CHUNK_SIZE) }, ME);
  await uploadScreenshotChunk({ uploadId, index: 1, data: 'BBBB' }, ME);

  assert.ok(kvsKeys().some((key) => key.startsWith(`screenshot:${uploadId}`)));
  await deleteScreenshotUpload(uploadId, 2);

  assert.equal(kvsKeys().some((key) => key.startsWith(`screenshot:${uploadId}`)), false);
  assert.equal(readKvs(`screenshot:${uploadId}`), undefined);
});
