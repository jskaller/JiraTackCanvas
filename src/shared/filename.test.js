import assert from 'node:assert/strict';
import { sanitiseFilename } from './filename.js';

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

check('keeps a normal name', sanitiseFilename('report.pdf', 'application/pdf'), 'report.pdf');
check('strips path separators', sanitiseFilename('../../etc/passwd', 'text/plain'), '..-..-etc-passwd');
check('strips quotes', sanitiseFilename('a"b\'c.pdf', 'application/pdf'), 'abc.pdf');
check('strips CRLF', sanitiseFilename('a\r\nInjected: x.pdf', 'application/pdf'), 'aInjected: x.pdf');
check('falls back to a generated name', sanitiseFilename('', 'image/png'), 'jiratack-upload.png');
check('falls back for a missing mime', sanitiseFilename(null, null), 'jiratack-upload.bin');
check('caps the length', sanitiseFilename('x'.repeat(300), 'text/plain').length, 120);
check('keeps unicode names', sanitiseFilename('résumé.pdf', 'application/pdf'), 'résumé.pdf');

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
