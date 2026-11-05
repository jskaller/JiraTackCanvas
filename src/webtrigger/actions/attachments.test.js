import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { apiCalls, resetApi, onPath, jsonResponse } from '../../../scripts/test-support/stubs/forge-api.mjs';
import { attachScreenshot } from './attachments.js';

beforeEach(() => {
  resetApi();
});

test('attaches a file as multipart with the header Jira requires', async () => {
  onPath('/attachments', () => jsonResponse(200, { id: 1 }), { method: 'POST' });
  const base64 = Buffer.from('hello world').toString('base64');

  await attachScreenshot('TEST-1', `data:image/png;base64,${base64}`);

  const call = apiCalls().find((entry) => entry.method === 'POST');
  assert.ok(call, 'an attachment request should have been made');
  assert.match(call.path, /\/rest\/api\/3\/issue\/TEST-1\/attachments$/);
  assert.equal(call.options.headers['X-Atlassian-Token'], 'no-check');
  assert.match(call.options.headers['Content-Type'], /^multipart\/form-data; boundary=/);

  const body = call.options.body;
  assert.ok(Buffer.isBuffer(body), 'the multipart body is a Buffer, not a string');
  const text = body.toString('latin1');
  assert.match(text, /name="file"; filename="jiratack-TEST-1\.png"/);
  assert.match(text, /Content-Type: image\/png/);
  assert.equal(text.includes('hello world'), true);
});

test('honours a filename override and keeps the real content type', async () => {
  onPath('/attachments', () => jsonResponse(201, { id: 2 }), { method: 'POST' });

  await attachScreenshot('TEST-2', 'data:application/pdf;base64,JVBERi0=', 'report.pdf');

  const text = apiCalls()[0].options.body.toString('latin1');
  assert.match(text, /filename="report\.pdf"/);
  assert.match(text, /Content-Type: application\/pdf/);
});

test('a non-data URL is rejected before any request', async () => {
  await assert.rejects(
    () => attachScreenshot('TEST-1', 'https://example.com/shot.png'),
    /Unsupported attachment data URL/,
  );
  assert.deepEqual(apiCalls(), []);
});

test('a refusal from Jira reports the status and detail', async () => {
  onPath('/attachments', () => jsonResponse(413, 'payload too large'), { method: 'POST' });

  await assert.rejects(
    () => attachScreenshot('TEST-1', 'data:image/png;base64,AAAA'),
    /HTTP 413.*payload too large/s,
  );
});
