import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import {
  apiCalls,
  resetApi,
  onPath,
  jsonResponse,
  unmatchedRequests,
} from '../../../scripts/test-support/stubs/forge-api.mjs';
import {
  ensureCanvasRecord,
  findCanvasKeyForName,
  readCanvasRecord,
  setCanvasThumbnail,
} from '../../lib/canvasRegistry.js';
import { createIssue } from './createIssue.js';
import { CREATE_CLAIMS, THUMBNAIL } from '../../../scripts/test-support/fixtures.mjs';

beforeEach(() => {
  resetKvs();
  resetApi();
  onPath('/rest/api/3/issue?', () => jsonResponse(201, {
    id: '10001',
    key: 'TEST-9',
    self: 'https://stub.atlassian.net/rest/api/3/issue/10001',
  }), { method: 'POST' });
  onPath('/properties/', () => jsonResponse(200, {}), { method: 'PUT' });
});

function payload(extra = {}) {
  return {
    canvasId: 'Shopify + Example.com',
    url: 'https://shopify.example/page',
    pinPosition: '{"x":10,"y":20}',
    summary: 'Broken button',
    issueTypeId: '10001',
    projectKey: 'TEST',
    ...extra,
  };
}

function metadataWrite() {
  const call = apiCalls().find((entry) => entry.method === 'PUT' && entry.path.includes('/properties/'));
  return call ? call.body : null;
}

test('stores the canvas preview on the record at the first ticket', async () => {
  const result = await createIssue(payload({ canvasThumbnail: THUMBNAIL }), CREATE_CLAIMS);

  assert.equal(result.ok, true);
  assert.equal(result.data.key, 'TEST-9');

  const key = await findCanvasKeyForName('Shopify + Example.com');
  assert.ok(key);
  const record = await readCanvasRecord(key);
  assert.equal(record.thumbnail, THUMBNAIL);
  assert.equal(record.thumbnailVersion, 2);
  assert.deepEqual(unmatchedRequests(), []);
});

test('never overwrites a preview the canvas already has', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Shopify + Example.com' });
  await setCanvasThumbnail(record.key, THUMBNAIL);

  const result = await createIssue(
    payload({ canvasThumbnail: 'data:image/jpeg;base64,REPLACEMENT' }),
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, true);
  assert.equal((await readCanvasRecord(record.key)).thumbnail, THUMBNAIL);
});

test('records why no preview was stored instead of failing silently', async () => {
  const result = await createIssue(
    payload({ canvasThumbnail: null, canvasThumbnailNote: 'This page produced no screenshot.' }),
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, true);
  const record = await readCanvasRecord(await findCanvasKeyForName('Shopify + Example.com'));
  assert.equal(record.thumbnail, undefined);
  assert.equal(record.thumbnailNote, 'This page produced no screenshot.');
});

test('rejects an oversized image and keeps the reason', async () => {
  const oversized = `data:image/jpeg;base64,${'A'.repeat(160000)}`;

  const result = await createIssue(payload({ canvasThumbnail: oversized }), CREATE_CLAIMS);

  assert.equal(result.ok, true);
  const record = await readCanvasRecord(await findCanvasKeyForName('Shopify + Example.com'));
  assert.equal(record.thumbnail, undefined);
  assert.equal(record.thumbnailNote, 'The captured image was too large to store.');
});

test('the ticket metadata carries the canvas key and the label', async () => {
  const result = await createIssue(payload(), CREATE_CLAIMS);
  assert.equal(result.ok, true);

  const metadata = metadataWrite();
  assert.equal(metadata.pin.canvas, 'Shopify + Example.com');
  assert.equal(metadata.pin.canvasId, await findCanvasKeyForName('Shopify + Example.com'));
  assert.equal(metadata.pin.position, '{"x":10,"y":20}');
});

test('a canvas id that is already a record key resolves to that record', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Shopify + Example.com' });

  const result = await createIssue(payload({ canvasId: record.key, canvasThumbnail: THUMBNAIL }), CREATE_CLAIMS);

  assert.equal(result.ok, true);
  const stored = await readCanvasRecord(record.key);
  assert.equal(stored.key, record.key);
  assert.equal(stored.name, 'Shopify + Example.com');
  assert.equal(stored.thumbnail, THUMBNAIL);
});

test('an unknown generated key is refused instead of creating a phantom canvas', async () => {
  const result = await createIssue(payload({ canvasId: 'c-00000000' }), CREATE_CLAIMS);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_FOUND');
  assert.equal(await findCanvasKeyForName('c-00000000'), null);
});

test('a key-shaped canvas id records the label, not the key, in pin.canvas', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Shopify + Example.com' });

  const result = await createIssue(payload({ canvasId: record.key }), CREATE_CLAIMS);

  assert.equal(result.ok, true);
  const metadata = metadataWrite();
  assert.equal(metadata.pin.canvas, 'Shopify + Example.com');
  assert.equal(metadata.pin.canvasId, record.key);
});
