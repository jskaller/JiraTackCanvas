import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { readKvs, resetKvs, seedKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { ensureCanvasRecord, readCanvasRecord, setCanvasThumbnail } from '../../lib/canvasRegistry.js';
import { dashboardAggregate } from './dashboard.js';
import {
  ADMIN_CONTEXT,
  THUMBNAIL,
  jiraIssue,
  pinMetadata,
  searchPage,
} from '../../../scripts/test-support/fixtures.mjs';

beforeEach(() => {
  resetKvs();
  resetApi();
  onPath('/rest/api/3/serverInfo', () => jsonResponse(200, { baseUrl: 'https://stub.atlassian.net' }));
});

function stubSearch(issues) {
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage(issues)), { method: 'POST' });
}

/**
 * A ticket written before `pin.canvasId` existed must group with the tickets
 * that have one. When it did not, the launcher listed the same canvas twice —
 * once keyed and once with no key.
 */
test('a legacy ticket joins the keyed canvas instead of forming a second one', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Shopify + Example.com' });
  stubSearch([
    jiraIssue({
      key: 'TEST-1',
      metadata: pinMetadata({
        canvas: 'Shopify + Example.com',
        url: 'https://shopify.example/',
      }),
      updated: '2026-11-01T10:00:00.000+0000',
    }),
    jiraIssue({
      key: 'TEST-2',
      metadata: pinMetadata({
        canvas: 'Shopify + Example.com',
        canvasId: record.key,
        url: 'https://shopify.example/cart',
      }),
      updated: '2026-11-02T10:00:00.000+0000',
    }),
  ]);

  const result = await dashboardAggregate(ADMIN_CONTEXT, {});

  assert.equal(result.ok, true);
  assert.equal(result.data.canvases.length, 1);
  const canvas = result.data.canvases[0];
  assert.equal(canvas.canvasKey, record.key);
  assert.equal(canvas.canvasName, 'Shopify + Example.com');
  assert.equal(canvas.ticketCount, 2);
  assert.equal(canvas.urlCount, 2);
});

test('the label comes from the record after a rename, not from the tickets', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Old name' });
  stubSearch([
    jiraIssue({
      key: 'TEST-3',
      metadata: pinMetadata({ canvas: 'Old name', canvasId: record.key, url: 'https://example.com/' }),
    }),
  ]);

  const result = await dashboardAggregate(ADMIN_CONTEXT, {});

  assert.equal(result.data.canvases[0].canvasName, 'Old name');
  assert.equal(result.data.canvases[0].canvasKey, record.key);
});

test('the card preview comes from the canvas record, so clearing shows at once', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Cancer Pages' });
  stubSearch([
    jiraIssue({
      key: 'TEST-4',
      metadata: pinMetadata({ canvas: 'Cancer Pages', canvasId: record.key, url: 'https://example.com/' }),
    }),
  ]);

  const withoutPreview = await dashboardAggregate(ADMIN_CONTEXT, {});
  assert.equal(withoutPreview.data.canvases[0].thumbnail, null);

  await setCanvasThumbnail(record.key, THUMBNAIL);
  const withPreview = await dashboardAggregate(ADMIN_CONTEXT, {});
  assert.equal(withPreview.data.canvases[0].thumbnail, THUMBNAIL);
});

test('deleted canvases are filtered out of the aggregate', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Gone' });
  seedKvs({ installationConfig: { projects: {}, deletedCanvases: ['Gone'] } });
  stubSearch([
    jiraIssue({
      key: 'TEST-5',
      metadata: pinMetadata({ canvas: 'Gone', canvasId: record.key, url: 'https://example.com/' }),
    }),
  ]);

  const result = await dashboardAggregate(ADMIN_CONTEXT, {});

  assert.deepEqual(result.data.canvases, []);
});

test('open counts ignore Done tickets', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Mixed' });
  stubSearch([
    jiraIssue({
      key: 'TEST-6',
      metadata: pinMetadata({ canvas: 'Mixed', canvasId: record.key, url: 'https://example.com/a' }),
      statusCategory: 'done',
      statusName: 'Done',
    }),
    jiraIssue({
      key: 'TEST-7',
      metadata: pinMetadata({ canvas: 'Mixed', canvasId: record.key, url: 'https://example.com/b' }),
      statusCategory: 'indeterminate',
      statusName: 'In Progress',
    }),
  ]);

  const result = await dashboardAggregate(ADMIN_CONTEXT, {});
  const canvas = result.data.canvases[0];

  assert.equal(canvas.ticketCount, 2);
  assert.equal(canvas.openCount, 1);
});

test('a pre-5.72 preview key is adopted onto the record and then removed', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Legacy preview' });
  seedKvs({ [`canvasThumb:${record.key}`]: { v: 2, dataUrl: THUMBNAIL } });
  stubSearch([
    jiraIssue({
      key: 'TEST-8',
      metadata: pinMetadata({ canvas: 'Legacy preview', canvasId: record.key, url: 'https://example.com/' }),
    }),
  ]);

  const result = await dashboardAggregate(ADMIN_CONTEXT, {});

  assert.equal(result.data.canvases[0].thumbnail, THUMBNAIL);
  assert.equal(readKvs(`canvasThumb:${record.key}`), undefined);
  assert.equal((await readCanvasRecord(record.key)).thumbnail, THUMBNAIL);
});
