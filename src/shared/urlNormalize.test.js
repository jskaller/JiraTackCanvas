import assert from 'node:assert/strict';
import {
  normalizeUrl,
  canonicalUrl,
  pathOnlyUrl,
  stripDeepLinkParams,
  urlMatches,
  filterPinsByUrl,
  countPinsByUrl,
} from './urlNormalize.js';

const vectors = [
  // Structural normalisation
  ['https://example.com/page', 'https://example.com/page'],
  ['https://example.com/page/', 'https://example.com/page'],
  ['https://example.com/page#section', 'https://example.com/page'],
  ['https://Example.COM/Page', 'https://example.com/Page'],
  ['https://example.com/A', 'https://example.com/A'],
  ['https://example.com/a/', 'https://example.com/a'],
  ['http://example.com/page', 'http://example.com/page'],
  ['https://example.com/', 'https://example.com/'],
  ['https://example.com:8443/a', 'https://example.com:8443/a'],

  // Meaningful parameters survive
  ['https://example.com/page?page=2', 'https://example.com/page?page=2'],
  ['https://example.com/page?id=42', 'https://example.com/page?id=42'],
  ['https://example.com/page?q=shoes', 'https://example.com/page?q=shoes'],
  ['https://example.com/page?cat=x', 'https://example.com/page?cat=x'],
  ['https://example.com/page?b=2&a=1', 'https://example.com/page?a=1&b=2'],
  ['https://example.com/?cat=x', 'https://example.com/?cat=x'],

  // Keep-list beats value shape: a hash-shaped sku is still a sku
  ['https://example.com/p?sku=ABC123456789012345', 'https://example.com/p?sku=ABC123456789012345'],
  ['https://example.com/p?id=8f14e45fceea167a5a36dedd4bea2543', 'https://example.com/p?id=8f14e45fceea167a5a36dedd4bea2543'],

  // Tracking, cache-busters and version stamps are noise
  ['https://example.com/page?utm_source=x&page=2', 'https://example.com/page?page=2'],
  ['https://example.com/page?fbclid=abc&page=3', 'https://example.com/page?page=3'],
  ['https://example.com/page?ref=twitter', 'https://example.com/page'],
  ['https://example.com/page?ts=1793315205', 'https://example.com/page'],
  ['https://example.com/page?v=1.2.3', 'https://example.com/page'],
  ['https://example.com/page?nocache=1', 'https://example.com/page'],

  // Random per-visit values are noise unless keep-listed
  ['https://example.com/p?session=8f14e45fceea167a5a36dedd4bea2543', 'https://example.com/p'],
  ['https://example.com/p?sid=abc123def456ghi789', 'https://example.com/p'],
  ['https://example.com/p?token=1793315205123', 'https://example.com/p'],

  // Deep links never participate in identity
  ['https://example.com/page?jiratack_ticket=KAN-15', 'https://example.com/page'],
  ['https://example.com/page?jiratack_ticket=KAN-15&page=2', 'https://example.com/page?page=2'],
];

const canonicalVectors = [
  ['https://example.com/page?b=2&a=1', 'https://example.com/page?a=1&b=2'],
  ['https://example.com/page/?b=2&a=1', 'https://example.com/page?a=1&b=2'],
  ['https://example.com/page?session=8f14e45fceea167a5a36dedd4bea2543',
    'https://example.com/page?session=8f14e45fceea167a5a36dedd4bea2543'],
  ['https://example.com/page?jiratack_canvas=Q3&page=2', 'https://example.com/page?page=2'],
  ['https://Example.COM/page#x', 'https://example.com/page'],
];

const pathVectors = [
  ['https://example.com/page?x=1&y=2', 'https://example.com/page'],
  ['https://example.com/page/', 'https://example.com/page'],
  ['https://example.com/?x=1', 'https://example.com/'],
  ['https://example.com/page#x', 'https://example.com/page'],
];

const stripVectors = [
  ['https://example.com/', 'https://example.com/'],
  ['https://example.com/?jiratack_ticket=KAN-15', 'https://example.com/'],
  ['https://example.com/page?jiratack_ticket=KAN-15&foo=bar', 'https://example.com/page?foo=bar'],
  ['https://example.com/page?jiratack_canvas=Q3&foo=bar', 'https://example.com/page?foo=bar'],
  ['https://example.com/page?foo=bar', 'https://example.com/page?foo=bar'],
];

const matchCases = [
  // [pinUrl, currentUrl, mode, expected]
  ['https://example.com/p?page=2', 'https://example.com/p?page=2', 'smart', true],
  ['https://example.com/p?page=2', 'https://example.com/p?page=3', 'smart', false],
  ['https://example.com/p?page=3', 'https://example.com/p?page=2', 'path', true],
  ['https://example.com/p?page=3', 'https://example.com/p?page=2', 'exact', false],
  ['https://example.com/p?b=2&a=1', 'https://example.com/p?a=1&b=2', 'exact', true],
  ['https://example.com/p?utm_source=x&page=2', 'https://example.com/p?page=2', 'smart', true],
  ['https://example.com/p', 'https://example.com/p?page=2', 'exact', false],
  ['https://example.com/p', 'https://example.com/p?page=2', 'path', true],
];

let passed = 0;
let failed = 0;
const total = vectors.length + canonicalVectors.length + pathVectors.length
  + stripVectors.length + matchCases.length;

function check(label, actual, expected) {
  try {
    assert.equal(actual, expected);
    passed += 1;
    console.log(`PASS  ${label} -> ${actual}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

for (const [input, expected] of vectors) {
  check(`normalize ${input}`, normalizeUrl(input), expected);
}
for (const [input, expected] of canonicalVectors) {
  check(`canonical ${input}`, canonicalUrl(input), expected);
}
for (const [input, expected] of pathVectors) {
  check(`path ${input}`, pathOnlyUrl(input), expected);
}
for (const [input, expected] of stripVectors) {
  check(`strip ${input}`, stripDeepLinkParams(input), expected);
}
for (const [pinUrl, currentUrl, mode, expected] of matchCases) {
  check(`match ${mode} ${pinUrl} vs ${currentUrl}`, urlMatches(pinUrl, currentUrl, mode), expected);
}

const pins = [
  { key: 'A', url: 'https://example.com/p?page=1' },
  { key: 'B', url: 'https://example.com/p?page=2' },
  { key: 'C', url: 'https://example.com/p' },
];
const counts = countPinsByUrl(pins, 'https://example.com/p?page=2');
check('counts smart', counts.smart, 1);
check('counts exact', counts.exact, 1);
check('counts path', counts.path, 3);
check('filter path', filterPinsByUrl(pins, 'https://example.com/p?page=9', 'path').length, 3);
check('filter all', filterPinsByUrl(pins, 'https://example.com/other', 'all').length, 3);

console.log(`\n${passed}/${total + 5} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
