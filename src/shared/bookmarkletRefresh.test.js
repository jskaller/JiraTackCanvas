import assert from 'node:assert/strict';
import { buildRefreshUrl, isSdkOutdated } from './bookmarklet.js';

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

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
