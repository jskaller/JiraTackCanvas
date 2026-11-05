import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { resetKvs } from '../../../scripts/test-support/stubs/forge-kvs.mjs';
import { apiCalls, resetApi, onPath, jsonResponse, unmatchedRequests } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { beginScreenshotUpload, uploadScreenshotChunk } from './screenshotUpload.js';
import { updatePinPosition } from './updatePinPosition.js';
import { CREATE_CLAIMS, jiraIssue, pinMetadata, searchPage } from '../../../scripts/test-support/fixtures.mjs';

const METADATA = pinMetadata({
  canvas: 'Shopify + Example.com',
  canvasId: 'c-abcdef12',
  url: 'https://shopify.example/page',
  position: '10,20',
  selector: '#old',
});

function issue(pin = METADATA) {
  return jiraIssue({
    key: 'TEST-1',
    metadata: pin,
    statusCategory: 'new',
  });
}

function stubIssue({ labels = ['jiratack'], metadata = METADATA } = {}) {
  onPath('/rest/api/3/issue/TEST-1?fields=', () => jsonResponse(200, {
    key: 'TEST-1',
    fields: { project: { key: 'TEST' }, labels },
  }), { method: 'GET' });
  onPath('/rest/api/3/search/jql', () => jsonResponse(200, searchPage([
    jiraIssue({ key: 'TEST-1', metadata, statusCategory: 'new' }),
  ])), { method: 'POST' });
  onPath('/properties/', () => jsonResponse(200, {}), { method: 'PUT' });
}

function metadataWrite() {
  const call = apiCalls().find((entry) => entry.method === 'PUT' && entry.path.includes('/properties/'));
  return call ? call.body : null;
}

async function startUpload(claims = CREATE_CLAIMS) {
  const begun = await beginScreenshotUpload({ mimeType: 'image/png', filename: 'move.png', size: 4 }, claims);
  await uploadScreenshotChunk({ uploadId: begun.data.uploadId, index: 0, data: 'AAAA' }, claims);
  return begun.data.uploadId;
}

beforeEach(() => {
  resetKvs();
  resetApi();
});

test('moves the pin and rewrites position and selector without losing the canvas', async () => {
  stubIssue();

  const result = await updatePinPosition(
    { issueKey: 'TEST-1', pinPosition: '30,40', selector: '#new' },
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.screenshotAttached, false);
  assert.deepEqual(result.data.warnings, ['screenshot-not-attached']);

  const written = metadataWrite();
  assert.equal(written.pin.position, '30,40');
  assert.equal(written.pin.selector, '#new');
  assert.equal(written.pin.canvas, 'Shopify + Example.com');
  assert.equal(written.pin.canvasId, 'c-abcdef12');
  assert.deepEqual(unmatchedRequests(), []);
});

test('a move with a screenshot attaches it, counts the version and comments', async () => {
  stubIssue();
  onPath('/attachments', () => jsonResponse(200, { id: 1 }), { method: 'POST' });
  onPath('/rest/api/3/user?accountId=', () => jsonResponse(200, {
    displayName: 'Reviewer',
    timeZone: 'Europe/London',
  }), { method: 'GET' });
  onPath('/comment', () => jsonResponse(201, { id: 9 }), { method: 'POST' });

  const uploadId = await startUpload();
  const result = await updatePinPosition(
    { issueKey: 'TEST-1', pinPosition: '30,40', selector: '#new', screenshotUploadId: uploadId, movedPixels: 500 },
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.screenshotAttached, true);
  assert.equal(result.data.screenshotVersion, 1);
  assert.equal(result.data.commented, true);

  const comment = apiCalls().find((entry) => entry.method === 'POST' && entry.path.endsWith('/comment'));
  assert.ok(comment, 'the move comment should have been posted');
  const text = JSON.stringify(comment.body);
  assert.match(text, /Pin moved and screenshot updated by Reviewer/);

  assert.equal(metadataWrite().screenshotVersion, 1);
});

test('a guest move names the invited reviewer and does not look up the sponsor', async () => {
  onPath('/attachments', () => jsonResponse(200, { id: 1 }), { method: 'POST' });
  onPath('/comment', () => jsonResponse(201, { id: 9 }), { method: 'POST' });

  const guestClaims = {
    sub: 'acc-sponsor',
    scope: 'guest_create',
    permittedProjects: '*',
    permittedCanvases: ['Shopify + Example.com'],
    isAdmin: false,
  };
  const guestMetadata = {
    ...METADATA,
    guest: { name: 'Jane Guest', email: 'jane@example.com' },
  };
  stubIssue({ metadata: guestMetadata });

  const uploadId = await startUpload(guestClaims);
  const result = await updatePinPosition(
    { issueKey: 'TEST-1', pinPosition: '30,40', selector: '#new', screenshotUploadId: uploadId, movedPixels: 500 },
    guestClaims,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.commented, true);
  const comment = apiCalls().find((entry) => entry.method === 'POST' && entry.path.endsWith('/comment'));
  assert.match(JSON.stringify(comment.body), /Jane Guest/);
  assert.equal(
    apiCalls().some((entry) => entry.path.includes('/rest/api/3/user?accountId=')),
    false,
    'a guest session must not look up the sponsor profile',
  );
});

test('an issue without the jiratack label is refused', async () => {
  stubIssue({ labels: [] });

  const result = await updatePinPosition(
    { issueKey: 'TEST-1', pinPosition: '30,40' },
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SCOPE');
  assert.equal(metadataWrite(), null);
});

test('a project outside the claim is refused', async () => {
  stubIssue();

  const result = await updatePinPosition(
    { issueKey: 'TEST-1', pinPosition: '30,40' },
    { ...CREATE_CLAIMS, permittedProjects: ['OTHER'] },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SCOPE');
});

test('a malformed position never reaches Jira', async () => {
  const result = await updatePinPosition({ issueKey: 'TEST-1', pinPosition: 'left top' }, CREATE_CLAIMS);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(apiCalls(), []);
});

test('a failed attachment does not fail the move', async () => {
  stubIssue();
  onPath('/attachments', () => jsonResponse(500, 'boom'), { method: 'POST' });

  const uploadId = await startUpload();
  const result = await updatePinPosition(
    { issueKey: 'TEST-1', pinPosition: '30,40', selector: '#new', screenshotUploadId: uploadId, movedPixels: 500 },
    CREATE_CLAIMS,
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.screenshotAttached, false);
  assert.equal(result.data.warnings.includes('screenshot-not-attached'), true);
  // No screenshot reached Jira, so the stored version is unchanged (0 when absent).
  assert.equal(result.data.screenshotVersion, 0);
  assert.equal(metadataWrite().screenshotVersion, undefined);
  assert.equal(metadataWrite().pin.position, '30,40');
});
