import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs, seedKvs, readKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse, unmatchedRequests } from '../../../scripts/test-support/stubs/forge-api.mjs';
import {
  ensureCanvasRecord,
  findCanvasKeyForName,
  readCanvasRecord,
  setCanvasThumbnail,
  setCanvasThumbnailNote,
} from '../../lib/canvasRegistry.js';
import { getInstallationConfig } from '../../lib/config.js';
import {
  archiveCanvas,
  assignCanvasFolder,
  clearCanvasPreview,
  deleteCanvas,
  getCanvasConfig,
  renameCanvas,
} from './admin.js';
import {
  ADMIN_CONTEXT,
  THUMBNAIL,
  USER_CONTEXT,
  jiraIssue,
  pinMetadata,
  searchPage,
} from '../../../scripts/test-support/fixtures.mjs';

beforeEach(() => {
  resetKvs();
  resetApi();
});

async function seedCanvas({ name = 'Shopify + Example.com', seedKey = null } = {}) {
  const { record } = await ensureCanvasRecord({ name, seedKey });
  return record;
}

/**
 * The dashboard actions take a canvas either by key or by name. Resolving only
 * one of them is what silently broke delete/archive/clear for a day.
 */
test('clearCanvasPreview resolves a canvas given by name', async () => {
  const record = await seedCanvas();
  await setCanvasThumbnail(record.key, THUMBNAIL);

  const result = await clearCanvasPreview(ADMIN_CONTEXT, { canvasName: 'Shopify + Example.com' });

  assert.equal(result.ok, true);
  assert.equal(result.data.canvasKey, record.key);
  const stored = await readCanvasRecord(record.key);
  assert.equal(stored.thumbnail, undefined);
  assert.equal(stored.thumbnailVersion, undefined);
});

test('clearCanvasPreview resolves a canvas given by key', async () => {
  const record = await seedCanvas({ name: 'Cancer Pages', seedKey: 'KAN-90' });
  await setCanvasThumbnail(record.key, THUMBNAIL);

  const result = await clearCanvasPreview(ADMIN_CONTEXT, { canvasKey: 'KAN-90' });

  assert.equal(result.ok, true);
  assert.equal(await readCanvasRecord('KAN-90').then((stored) => stored.thumbnail), undefined);
});

test('clearCanvasPreview also removes the pre-5.72 thumbnail key', async () => {
  const record = await seedCanvas();
  seedKvs({ [`canvasThumb:${record.key}`]: { v: 2, dataUrl: THUMBNAIL } });

  await clearCanvasPreview(ADMIN_CONTEXT, { canvasName: record.name });

  assert.equal(readKvs(`canvasThumb:${record.key}`), undefined);
});

test('clearCanvasPreview is refused for a non-admin', async () => {
  const record = await seedCanvas();
  await setCanvasThumbnail(record.key, THUMBNAIL);

  const result = await clearCanvasPreview(USER_CONTEXT, { canvasName: record.name });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SCOPE');
  assert.equal((await readCanvasRecord(record.key)).thumbnail, THUMBNAIL);
});

test('getCanvasConfig reports the stored preview state and the last failure reason', async () => {
  const record = await seedCanvas();

  await setCanvasThumbnailNote(record.key, 'The browser sent no image.');
  const withoutImage = await getCanvasConfig(ADMIN_CONTEXT, { canvasName: record.name });
  assert.equal(withoutImage.data.thumbnailCaptured, false);
  assert.equal(withoutImage.data.thumbnailNote, 'The browser sent no image.');

  await setCanvasThumbnail(record.key, THUMBNAIL);
  const withImage = await getCanvasConfig(ADMIN_CONTEXT, { canvasName: record.name });
  assert.equal(withImage.data.thumbnailCaptured, true);
  assert.equal(withImage.data.thumbnailNote, null);
});

test('renameCanvas keeps every historical name pointing at the same key', async () => {
  const record = await seedCanvas();

  const result = await renameCanvas(ADMIN_CONTEXT, {
    canvasKey: record.key,
    canvasName: 'Renamed canvas',
  });

  assert.equal(result.ok, true);
  assert.equal(await findCanvasKeyForName('Shopify + Example.com'), record.key);
  assert.equal(await findCanvasKeyForName('Renamed canvas'), record.key);
  const stored = await readCanvasRecord(record.key);
  assert.equal(stored.name, 'Renamed canvas');
  assert.deepEqual(stored.names.sort(), ['Renamed canvas', 'Shopify + Example.com'].sort());
});

test('assignCanvasFolder sets and clears the folder label', async () => {
  const record = await seedCanvas();

  const assigned = await assignCanvasFolder(ADMIN_CONTEXT, { canvasKey: record.key, folder: 'QA' });
  assert.equal(assigned.ok, true);
  assert.equal((await readCanvasRecord(record.key)).folder, 'QA');

  await assignCanvasFolder(ADMIN_CONTEXT, { canvasKey: record.key, folder: '' });
  assert.equal((await readCanvasRecord(record.key)).folder, null);
});

test('archiveCanvas archives the record and the config list by name', async () => {
  const record = await seedCanvas();

  const result = await archiveCanvas(ADMIN_CONTEXT, { canvasName: record.name });

  assert.equal(result.ok, true);
  assert.equal((await readCanvasRecord(record.key)).archived, true);
  const config = await getInstallationConfig();
  assert.ok(config.archivedCanvases.includes(record.name));
});

test('deleteCanvas refuses while a ticket is not Done', async () => {
  const record = await seedCanvas();
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([
    jiraIssue({
      key: 'TEST-1',
      metadata: pinMetadata({ canvas: record.name, canvasId: record.key, url: 'https://example.com/' }),
      statusCategory: 'indeterminate',
    }),
  ])));

  const result = await deleteCanvas(ADMIN_CONTEXT, { canvasName: record.name });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CANVAS_NOT_EMPTY');
  assert.ok(await readCanvasRecord(record.key));
  assert.deepEqual(unmatchedRequests(), []);
});

test('deleteCanvas removes a canvas whose tickets are all Done', async () => {
  const record = await seedCanvas();
  seedKvs({ 'installationConfig': { projects: {}, archivedCanvases: [], deletedCanvases: [] } });
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([
    jiraIssue({
      key: 'TEST-2',
      metadata: pinMetadata({ canvas: record.name, canvasId: record.key, url: 'https://example.com/' }),
      statusCategory: 'done',
      statusName: 'Done',
    }),
  ])));

  const result = await deleteCanvas(ADMIN_CONTEXT, { canvasName: record.name });

  assert.equal(result.ok, true);
  assert.equal(result.data.ticketCount, 1);
  assert.equal(await readCanvasRecord(record.key), null);
  const config = await getInstallationConfig();
  assert.ok(config.deletedCanvases.includes(record.name));
  assert.deepEqual(unmatchedRequests(), []);
});

/**
 * The pre-5.72 preview key has no reader any more. Reading the canvas adopts it
 * onto the record and removes the key, so the old generation disappears without
 * losing the image.
 */
test('getCanvasConfig adopts a pre-5.72 preview key onto the record', async () => {
  const record = await seedCanvas();
  seedKvs({ [`canvasThumb:${record.key}`]: { v: 2, dataUrl: THUMBNAIL } });

  const result = await getCanvasConfig(ADMIN_CONTEXT, { canvasKey: record.key });

  assert.equal(result.data.thumbnailCaptured, true);
  assert.equal((await readCanvasRecord(record.key)).thumbnail, THUMBNAIL);
  assert.equal(readKvs(`canvasThumb:${record.key}`), undefined);
});
