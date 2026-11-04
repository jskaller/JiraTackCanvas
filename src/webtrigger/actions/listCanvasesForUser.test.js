import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { kvsStats, resetKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { resetApi, onPath, jsonResponse, unmatchedRequests } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { ensureCanvasRecord } from '../../lib/canvasRegistry.js';
import { listCanvasesForUser } from './listCanvasesForUser.js';
import { CREATE_CLAIMS, jiraIssue, pinMetadata, searchPage } from '../../../scripts/test-support/fixtures.mjs';

// One handler reading a mutable list, so a test can change what Jira reports
// between calls (registering a second handler would never be reached).
let issues = [];

beforeEach(() => {
  resetKvs();
  resetApi();
  issues = [];
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage(issues)), { method: 'POST' });
});

function setIssues(next) {
  issues = next;
}

test('the launcher lists a canvas from its tickets with the current label', async () => {
  const { record } = await ensureCanvasRecord({ name: 'Shopify + Example.com' });
  setIssues([
    jiraIssue({
      key: 'TEST-1',
      metadata: pinMetadata({
        canvas: 'Shopify + Example.com',
        canvasId: record.key,
        url: 'https://shopify.example/',
      }),
    }),
  ]);

  const result = await listCanvasesForUser({}, CREATE_CLAIMS);

  assert.equal(result.ok, true);
  assert.equal(result.data.canvases.length, 1);
  assert.equal(result.data.canvases[0].canvasKey, record.key);
  assert.equal(result.data.canvases[0].canvasName, 'Shopify + Example.com');
  assert.deepEqual(unmatchedRequests(), []);
});

/**
 * Opening the overlay used to rebuild the registry every time: up to 40 record
 * queries plus 100 index queries at the caps. One stamped snapshot replaces
 * both, and a registry write invalidates it.
 */
test('a second open is served from the registry snapshot, and a new canvas invalidates it', async () => {
  const { record } = await ensureCanvasRecord({ name: 'First canvas' });
  setIssues([
    jiraIssue({
      key: 'TEST-2',
      metadata: pinMetadata({
        canvas: 'First canvas',
        canvasId: record.key,
        url: 'https://example.com/',
      }),
    }),
  ]);

  await listCanvasesForUser({}, CREATE_CLAIMS);

  const before = kvsStats();
  const warm = await listCanvasesForUser({}, CREATE_CLAIMS);
  const after = kvsStats();

  assert.equal(warm.data.canvases.length, 1);
  assert.equal((after.queries['canvas:'] || 0), (before.queries['canvas:'] || 0));
  assert.equal((after.queries['canvasName:'] || 0), (before.queries['canvasName:'] || 0));

  // A registry write bumps the stamp, so the next open sees the new canvas.
  await ensureCanvasRecord({ name: 'Second canvas' });
  const rebuilt = await listCanvasesForUser({}, CREATE_CLAIMS);
  assert.equal(rebuilt.data.canvases.length, 1, 'the second canvas has no tickets yet');

  setIssues([
    jiraIssue({
      key: 'TEST-2',
      metadata: pinMetadata({
        canvas: 'First canvas',
        canvasId: record.key,
        url: 'https://example.com/',
      }),
    }),
    jiraIssue({
      key: 'TEST-3',
      metadata: pinMetadata({
        canvas: 'Second canvas',
        url: 'https://example.com/two',
      }),
    }),
  ]);
  const withTicket = await listCanvasesForUser({}, CREATE_CLAIMS);
  assert.deepEqual(
    withTicket.data.canvases.map((canvas) => canvas.canvasName).sort(),
    ['First canvas', 'Second canvas'],
  );
});
