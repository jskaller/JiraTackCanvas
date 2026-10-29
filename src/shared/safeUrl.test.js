import assert from 'node:assert/strict';
import { toSafeHttpUrl } from './safeUrl.js';

const cases = [
  ['https://example.com/page', 'https://example.com/page'],
  ['http://example.com/a?b=1', 'http://example.com/a?b=1'],
  ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
  ['https://example.com/a b', 'https://example.com/a%20b'],
  ['javascript:alert(1)', null],
  ['JavaScript:alert(1)', null],
  ['data:text/html,<script>1</script>', null],
  ['vbscript:msgbox(1)', null],
  ['file:///etc/passwd', null],
  ['ftp://example.com/x', null],
  ['   ', null],
  ['', null],
  [null, null],
  [undefined, null],
  [12345, null],
  ['not a url', null],
];

let passed = 0;
let failed = 0;

for (const [input, expected] of cases) {
  const actual = toSafeHttpUrl(input);
  try {
    assert.equal(actual, expected);
    passed += 1;
    console.log(`PASS  ${JSON.stringify(input)} -> ${actual}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${JSON.stringify(input)}: expected ${expected}, got ${actual}`);
  }
}

// Relative paths resolve against a base when provided.
try {
  assert.equal(
    toSafeHttpUrl('/browse/KAN-1', 'https://jiratack.atlassian.net/page'),
    'https://jiratack.atlassian.net/browse/KAN-1',
  );
  passed += 1;
  console.log('PASS  relative path with base');
} catch (e) {
  failed += 1;
  console.error('FAIL  relative path with base');
}

console.log(`\n${passed}/${cases.length + 1} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
