import assert from 'node:assert/strict';
import { buildBookmarklet } from './bookmarklet.js';
import { parseBookmarkletConfig, describeConfig } from './extensionConfig.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    passed += 1;
    console.log(`PASS  ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const bookmarklet = buildBookmarklet({
  token: 'invite.install',
  apiUrl: 'https://api.example/x1/actions',
  sdkUrl: 'https://sdk.example/x1/sdk',
  sdkVersion: 'abc123',
  canvasId: 'universal',
  canvasName: 'Demo canvas',
});

const parsed = parseBookmarkletConfig(bookmarklet);
check('round-trips the bookmarklet config', parsed, {
  token: 'invite.install',
  apiUrl: 'https://api.example/x1/actions',
  sdkUrl: 'https://sdk.example/x1/sdk',
  canvasId: 'universal',
  canvasName: 'Demo canvas',
  sdkVersion: 'abc123',
});

check('accepts bare JSON', parseBookmarkletConfig(JSON.stringify({ token: 't', apiUrl: 'https://a.example/x' })), {
  token: 't',
  apiUrl: 'https://a.example/x',
  sdkUrl: '',
  canvasId: 'universal',
  canvasName: 'Canvas',
  sdkVersion: '',
});

check('rejects empty input', parseBookmarkletConfig(''), null);
check('rejects a non-JiraTack link', parseBookmarkletConfig('javascript:alert(1)'), null);
check('rejects a token without an api', parseBookmarkletConfig(JSON.stringify({ token: 't' })), null);
check('rejects a plain-http api', parseBookmarkletConfig(JSON.stringify({ token: 't', apiUrl: 'http://a.example/x' })), null);
check('drops unknown keys', parseBookmarkletConfig(JSON.stringify({ token: 't', apiUrl: 'https://a.example/x', isAdmin: 'true' })), {
  token: 't',
  apiUrl: 'https://a.example/x',
  sdkUrl: '',
  canvasId: 'universal',
  canvasName: 'Canvas',
  sdkVersion: '',
});

check('describeConfig names the canvas', describeConfig(parsed).startsWith('Configured for Demo canvas'), true);
check('describeConfig shows no token body', describeConfig(parsed).includes('invite.install'), false);
check('describeConfig handles empty', describeConfig(null), 'Not configured.');

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
