import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { kvs, resetKvs, seedKvs, readKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse, unmatchedRequests } from '../../../scripts/test-support/stubs/forge-api.mjs';
import {
  canvasNameIndexKey,
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
  deleteStrayCanvasRecord,
  getCanvasConfig,
  registryHealth,
  renameCanvas,
  repairCanvasIndex,
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

/**
 * The index row can be missing (interrupted write, pre-D42 canvas). The
 * dashboard used to answer NOT_FOUND while the overlay resolved the same canvas
 * happily; every action now goes through the same resolver.
 */
test('the canvas page resolves a name with no name-index row', async () => {
  const record = await seedCanvas();
  await kvs.delete(canvasNameIndexKey('Shopify + Example.com'));

  const config = await getCanvasConfig(ADMIN_CONTEXT, { canvasName: 'Shopify + Example.com' });
  assert.equal(config.ok, true);
  assert.equal(config.data.canvasKey, record.key);

  await setCanvasThumbnail(record.key, THUMBNAIL);
  const cleared = await clearCanvasPreview(ADMIN_CONTEXT, { canvasName: 'Shopify + Example.com' });
  assert.equal(cleared.ok, true);
  assert.equal((await readCanvasRecord(record.key)).thumbnail, undefined);
});

test('registryHealth reports the legacy data that keeps the fallbacks alive', async () => {
  const healthy = await seedCanvas({ name: 'Health' });
  await setCanvasThumbnail(healthy.key, THUMBNAIL);
  const unindexed = await seedCanvas({ name: 'Unindexed', seedKey: 'KAN-77' });
  await kvs.delete(canvasNameIndexKey('Unindexed'));
  seedKvs({
    'canvasName:ghost': 'c-deadbeef',
    'canvasThumb:ghost': { v: 2, dataUrl: THUMBNAIL },
  });
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([
    jiraIssue({
      key: 'TEST-20',
      metadata: pinMetadata({
        canvas: 'Health',
        canvasId: healthy.key,
        url: 'https://example.com/',
      }),
    }),
    jiraIssue({
      key: 'TEST-21',
      metadata: pinMetadata({ canvas: 'Health', url: 'https://example.com/old' }),
    }),
    jiraIssue({
      key: 'TEST-22',
      metadata: pinMetadata({
        canvas: 'Deleted canvas',
        canvasId: 'c-00000000',
        url: 'https://example.com/dead',
      }),
    }),
  ])));

  const result = await registryHealth(ADMIN_CONTEXT, {});

  assert.equal(result.ok, true);
  const data = result.data;
  assert.equal(data.canvases, 2);
  assert.equal(data.orphanIndexRows, 1);
  assert.equal(data.samples.orphanIndexRows[0].canvasKey, 'c-deadbeef');
  assert.equal(data.unindexedCanvases, 1);
  assert.equal(data.legacyPreviewKeys, 1);
  assert.deepEqual(data.previews, { captured: 1, missing: 1 });
  assert.equal(data.tickets.scanned, 3);
  assert.equal(data.tickets.withoutCanvasId, 1);
  assert.equal(data.tickets.unresolved, 1);
  assert.equal(data.samples.withoutCanvasId[0].key, 'TEST-21');
  assert.equal(data.samples.unresolved[0].key, 'TEST-22');
  assert.equal(unindexed.key, 'KAN-77');
  assert.deepEqual(unmatchedRequests(), []);
});

test('registryHealth is admin-only', async () => {
  const result = await registryHealth(USER_CONTEXT, {});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SCOPE');
});

test('registryHealth names both sides of a duplicate label, with ticket counts', async () => {
  const healthy = await seedCanvas({ name: 'Shopify + Example.com' });
  // A second record with the same label but a different key: what the pre-D42
  // key handling could leave behind.
  seedKvs({
    'canvas:orphan-record': {
      version: 1,
      key: 'orphan-record',
      name: 'Shopify + Example.com',
      names: ['Shopify + Example.com'],
      folder: null,
      archived: false,
    },
  });
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([
    jiraIssue({
      key: 'TEST-50',
      metadata: pinMetadata({
        // An older label — the count must follow the key, not the label.
        canvas: 'Old name',
        canvasId: healthy.key,
        url: 'https://example.com/',
      }),
    }),
  ])));

  const result = await registryHealth(ADMIN_CONTEXT, {});

  assert.equal(result.data.duplicateLabels, 1);
  const entry = result.data.samples.duplicateLabels[0];
  assert.equal(entry.name, 'Shopify + Example.com');
  const counts = Object.fromEntries(entry.records.map((record) => [record.canvasKey, record.ticketCount]));
  assert.equal(counts[healthy.key], 1);
  assert.equal(counts['orphan-record'], 0);
});

test('repairCanvasIndex restores missing rows, is idempotent, and never steals a name', async () => {
  const first = await seedCanvas({ name: 'First canvas' });
  const second = await seedCanvas({ name: 'Second canvas', seedKey: 'KAN-55' });
  await kvs.delete(canvasNameIndexKey('Second canvas'));

  const repaired = await repairCanvasIndex(ADMIN_CONTEXT, {});

  assert.equal(repaired.ok, true);
  assert.equal(repaired.data.repaired, 1);
  assert.equal(await findCanvasKeyForName('Second canvas'), 'KAN-55');

  const again = await repairCanvasIndex(ADMIN_CONTEXT, {});
  assert.equal(again.data.repaired, 0);

  // A name already owned by a different live record is left alone: the legacy
  // row is the only one pointing at "First canvas", and it names the other key.
  seedKvs({ 'canvasName:first canvas': second.key });
  await kvs.delete(canvasNameIndexKey('First canvas'));
  const third = await repairCanvasIndex(ADMIN_CONTEXT, {});
  assert.equal(third.data.repaired, 0);
  assert.equal(third.data.skipped >= 1, true);
  assert.equal(await findCanvasKeyForName('First canvas'), second.key);
  assert.ok(first.key);
});

test('repairCanvasIndex is admin-only', async () => {
  const result = await repairCanvasIndex(USER_CONTEXT, {});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SCOPE');
});

async function seedStray({ label = 'Duplicate label' } = {}) {
  const sibling = await seedCanvas({ name: label });
  seedKvs({
    'canvas:stray-record': {
      version: 1,
      key: 'stray-record',
      name: label,
      names: [label],
      folder: null,
      archived: false,
    },
  });
  return sibling;
}

test('a stray duplicate record with no tickets can be removed by key', async () => {
  const sibling = await seedStray();
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([])));

  const result = await deleteStrayCanvasRecord(ADMIN_CONTEXT, { canvasKey: 'stray-record' });

  assert.equal(result.ok, true);
  assert.equal(await readCanvasRecord('stray-record'), null);
  assert.ok(await readCanvasRecord(sibling.key));
  assert.equal(await findCanvasKeyForName('Duplicate label'), sibling.key);
});

test('a record that any ticket resolves to is refused', async () => {
  await seedStray();
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([
    jiraIssue({
      key: 'TEST-60',
      metadata: pinMetadata({
        canvas: 'Duplicate label',
        canvasId: 'stray-record',
        url: 'https://example.com/',
      }),
    }),
  ])));

  const result = await deleteStrayCanvasRecord(ADMIN_CONTEXT, { canvasKey: 'stray-record' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CANVAS_NOT_EMPTY');
  assert.ok(await readCanvasRecord('stray-record'));
});

test('a record without a duplicate label is refused, so the action cannot be used to delete a canvas', async () => {
  const only = await seedCanvas({ name: 'Only canvas' });
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([])));

  const result = await deleteStrayCanvasRecord(ADMIN_CONTEXT, { canvasKey: only.key });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  assert.ok(await readCanvasRecord(only.key));
});

test('removing a stray record is admin-only', async () => {
  const result = await deleteStrayCanvasRecord(USER_CONTEXT, { canvasKey: 'stray-record' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SCOPE');
});
