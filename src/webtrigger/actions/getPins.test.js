import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { kvs, resetKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse, unmatchedRequests } from '../../../scripts/test-support/stubs/forge-api.mjs';
import {
  canvasNameIndexKey,
  ensureCanvasRecord,
  setCanvasThumbnail,
} from '../../lib/canvasRegistry.js';
import { getPinsForCanvasAndUrl } from './getPins.js';
import {
  CREATE_CLAIMS,
  THUMBNAIL,
  jiraIssue,
  pinMetadata,
  searchPage,
} from '../../../scripts/test-support/fixtures.mjs';

beforeEach(() => {
  resetKvs();
  resetApi();
});

function stubSearch(issues) {
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage(issues)), { method: 'POST' });
}

test('returns the pins for the canvas and page', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Cancer Pages' });
  stubSearch([
    jiraIssue({
      key: 'TEST-1',
      metadata: pinMetadata({
        canvas: 'Cancer Pages',
        canvasId: record.key,
        url: 'https://montefioreeinstein.org/cancer',
        selector: '#hero',
      }),
    }),
  ]);

  const result = await getPinsForCanvasAndUrl(
    { canvasId: 'Cancer Pages', url: 'https://montefioreeinstein.org/cancer', all: true },
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.pins.length, 1);
  assert.equal(result.data.pins[0].key, 'TEST-1');
  assert.equal(result.data.canvasKey, record.key);
  assert.equal(result.data.truncated, false);
  assert.deepEqual(unmatchedRequests(), []);
});

test('reports whether the canvas has a preview, from the record', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Cancer Pages' });
  stubSearch([]);

  const before = await getPinsForCanvasAndUrl(
    { canvasId: 'Cancer Pages', url: 'https://example.com/', all: true },
    CREATE_CLAIMS,
  );
  assert.equal(before.data.canvasHasThumbnail, false);

  await setCanvasThumbnail(record.key, THUMBNAIL);
  const after = await getPinsForCanvasAndUrl(
    { canvasId: 'Cancer Pages', url: 'https://example.com/', all: true },
    CREATE_CLAIMS,
  );
  assert.equal(after.data.canvasHasThumbnail, true);
});

/**
 * The `canvasName:` row can be missing for an old canvas. Resolving only
 * through that row returned no canvas key at all, which is how the launcher
 * ended up with a keyless duplicate.
 */
test('resolves the canvas key by record name when the name index row is missing', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Shopify + Example.com' });
  await kvs.delete(canvasNameIndexKey('Shopify + Example.com'));
  stubSearch([]);

  const result = await getPinsForCanvasAndUrl(
    { canvasId: 'Shopify + Example.com', url: 'https://example.com/', all: true },
    CREATE_CLAIMS,
  );

  assert.equal(result.data.canvasKey, record.key);
});

test('filters pins to the requested page unless all is set', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Pages' });
  stubSearch([
    jiraIssue({
      key: 'TEST-2',
      metadata: pinMetadata({ canvas: 'Pages', canvasId: record.key, url: 'https://example.com/a' }),
    }),
    jiraIssue({
      key: 'TEST-3',
      metadata: pinMetadata({ canvas: 'Pages', canvasId: record.key, url: 'https://example.com/b' }),
    }),
  ]);

  const onePage = await getPinsForCanvasAndUrl(
    { canvasId: 'Pages', url: 'https://example.com/a' },
    CREATE_CLAIMS,
  );
  assert.deepEqual(onePage.data.pins.map((pin) => pin.key), ['TEST-2']);

  const allPages = await getPinsForCanvasAndUrl(
    { canvasId: 'Pages', url: 'https://example.com/a', all: true },
    CREATE_CLAIMS,
  );
  assert.deepEqual(allPages.data.pins.map((pin) => pin.key).sort(), ['TEST-2', 'TEST-3']);
});

test('removed tickets never reach the client', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Removed' });
  stubSearch([
    jiraIssue({
      key: 'TEST-4',
      metadata: pinMetadata({ canvas: 'Removed', canvasId: record.key, url: 'https://example.com/' }),
      statusName: 'Removed',
      statusCategory: 'done',
    }),
  ]);

  const result = await getPinsForCanvasAndUrl(
    { canvasId: 'Removed', url: 'https://example.com/', all: true },
    CREATE_CLAIMS,
  );

  assert.deepEqual(result.data.pins, []);
});
