import assert from 'node:assert/strict';
import { buildBookmarklet, buildRefreshUrl, isSdkOutdated } from './bookmarklet.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  try {
    assert.equal(actual, expected);
    passed += 1;
    console.log(`PASS  ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

const invite = 'a'.repeat(64);
const installId = 'b'.repeat(32);
const base = 'https://app.example/x1/install';

check(
  'composite keeps the pairing',
  buildRefreshUrl(base, `${invite}.${installId}`),
  `${base}?token=${invite}&installId=${installId}`,
);

check(
  'bare token has no installId',
  buildRefreshUrl(base, invite),
  `${base}?token=${invite}`,
);

check(
  'existing query string is respected',
  buildRefreshUrl(`${base}?env=dev`, `${invite}.${installId}`),
  `${base}?env=dev&token=${invite}&installId=${installId}`,
);

check('missing install URL', buildRefreshUrl('', invite), null);
check('missing token', buildRefreshUrl(base, ''), null);

check('same version is current', isSdkOutdated('abc', 'abc'), false);
check('different version is outdated', isSdkOutdated('abc', 'def'), true);
check('missing server version is not a verdict', isSdkOutdated('abc', null), false);
check('placeholder is ignored', isSdkOutdated('__JIRATACK_SDK_VERSION__', 'def'), false);

// The loader is a string; a stray quote or backtick breaks every bookmark at
// once, and nothing else in the suite would notice.
const bookmarklet = buildBookmarklet({
  token: 'invite.install',
  apiUrl: 'https://api.example/actions',
  sdkUrl: 'https://sdk.example/x1/sdk',
  sdkVersion: 'abc123',
  canvasId: 'canvas-1',
  canvasName: 'Demo',
});

check('bookmarklet is a javascript: URL', bookmarklet.startsWith('javascript:'), true);

let parses = true;
let parseError = '';
try {
  // Compiles the loader without executing it.
  new Function(bookmarklet.slice('javascript:'.length));
} catch (e) {
  parses = false;
  parseError = String(e);
}
check('bookmarklet source parses', parses, true);
if (!parses) console.error(`  ${parseError}`);

check('carries the sdk url', bookmarklet.includes('https://sdk.example/x1/sdk'), true);
check('has an inline-script fallback', bookmarklet.includes('textContent=source'), true);
check('fetches the bundle on error', bookmarklet.includes("fetch(url,{cache:'no-store'"), true);
check('does not use eval', /[^a-zA-Z_.]eval\s*\(/.test(bookmarklet), false);
check('reports a refused download', bookmarklet.includes('could not be downloaded'), true);
check('reports blocked inline scripts', bookmarklet.includes('blocks inline scripts'), true);
check('treats a loaded-but-unstarted script as failure', bookmarklet.includes('loaded but did not start'), true);
check('keeps one line', bookmarklet.includes('\n'), false);

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
