import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVE_COMMENT_THRESHOLD_PX,
  buildPinMoveComment,
  formatMoveTime,
  movedBeyondThreshold,
  nextScreenshotVersion,
  screenshotFilename,
  screenshotTimestamp,
} from './pinMove.js';

const AT = new Date('2026-11-02T17:42:00Z');

test('formatMoveTime uses the reviewer zone with an abbreviation', () => {
  assert.equal(formatMoveTime(AT, 'Europe/London').text, '2 Nov 2026, 17:42 GMT');
  assert.equal(formatMoveTime(AT, 'America/New_York').text, '2 Nov 2026, 12:42 EST');
  assert.equal(formatMoveTime(AT, 'Europe/Berlin').text, '2 Nov 2026, 18:42 CET');
  assert.equal(formatMoveTime(AT, 'Europe/London').fallback, false);
});

test('formatMoveTime falls back to UTC and says so', () => {
  const missing = formatMoveTime(AT, null);
  assert.equal(missing.text, '2 Nov 2026, 17:42 UTC');
  assert.equal(missing.timeZone, 'UTC');
  assert.equal(missing.fallback, true);

  // A Jira profile can carry a zone this runtime does not know.
  const invalid = formatMoveTime(AT, 'Mars/Olympus');
  assert.equal(invalid.text, '2 Nov 2026, 17:42 UTC');
  assert.equal(invalid.fallback, true);
});

test('buildPinMoveComment names the mover because the app is the author', () => {
  assert.equal(
    buildPinMoveComment({ displayName: 'Ada Lovelace', at: AT, timeZone: 'Europe/London' }),
    'Pin moved and screenshot updated by Ada Lovelace on 2 Nov 2026, 17:42 GMT',
  );
  assert.equal(
    buildPinMoveComment({ displayName: '  ', at: AT, timeZone: null }),
    'Pin moved and screenshot updated by a reviewer on 2 Nov 2026, 17:42 UTC',
  );
});

test('only a real move is worth a comment', () => {
  assert.equal(MOVE_COMMENT_THRESHOLD_PX, 4);
  assert.equal(movedBeyondThreshold(0), false);
  assert.equal(movedBeyondThreshold(4), false);
  assert.equal(movedBeyondThreshold(4.1), true);
  assert.equal(movedBeyondThreshold(undefined), false);
  assert.equal(movedBeyondThreshold('80'), true);
});

test('superseding screenshots are named with a timestamp', () => {
  const name = screenshotFilename('TEST-1', 1762095720000);
  assert.equal(name, 'jiratack-TEST-1-1762095720000.png');
  assert.equal(screenshotTimestamp(name, 'TEST-1'), 1762095720000);
  // Key characters that would break a filename become underscores.
  assert.match(screenshotFilename('weird/key', 1762095720000), /^jiratack-weird_key-\d{13}\.png$/);
});

test('the original screenshot has no timestamp and sorts by its own rule', () => {
  assert.equal(screenshotTimestamp('jiratack-TEST-1.webp', 'TEST-1'), null);
  assert.equal(screenshotTimestamp('jiratack-TEST-1-1762095720000.webp', 'TEST-1'), 1762095720000);
  assert.equal(screenshotTimestamp('jiratack-TEST-1-1762095720000.png', 'TEST-2'), null);
  assert.equal(screenshotTimestamp(null, 'TEST-1'), null);
});

test('screenshotVersion increments and tolerates older metadata', () => {
  assert.equal(nextScreenshotVersion(undefined), 1);
  assert.equal(nextScreenshotVersion(0), 1);
  assert.equal(nextScreenshotVersion(3), 4);
  assert.equal(nextScreenshotVersion('3'), 1);
});
