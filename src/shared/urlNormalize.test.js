import assert from 'node:assert/strict';
import { normalizeUrl } from './urlNormalize.js';

const vectors = [
  ['https://example.com/page', 'https://example.com/page'],
  ['https://example.com/page/', 'https://example.com/page'],
  ['https://example.com/page#section', 'https://example.com/page'],
  ['https://Example.COM/Page', 'https://example.com/Page'],
  ['https://example.com/page?cat=x', 'https://example.com/page'],
  ['https://example.com/page?cat=y', 'https://example.com/page'],
  ['https://example.com/page?id=42', 'https://example.com/page'],
  ['https://example.com/page?utm_source=x&id=42#section', 'https://example.com/page'],
  ['https://example.com/page/?cat=x', 'https://example.com/page'],
  ['https://example.com/A', 'https://example.com/A'],
  ['https://example.com/a', 'https://example.com/a'],
  ['https://example.com/a/', 'https://example.com/a'],
  ['http://example.com/page', 'http://example.com/page'],
  ['https://example.com/', 'https://example.com/'],
  ['https://example.com/?cat=x', 'https://example.com/'],
  ['https://example.com:8443/a?x=1', 'https://example.com:8443/a'],
];

let passed = 0;
let failed = 0;

for (const [input, expected] of vectors) {
  const actual = normalizeUrl(input);
  try {
    assert.equal(actual, expected);
    passed += 1;
    console.log(`PASS  ${input} -> ${actual}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${input}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

console.log(`\n${passed}/${vectors.length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
