import assert from 'node:assert/strict';
import { resolveTargetUrl, resolveCanvasTarget } from './targetUrl.js';

assert.deepEqual(resolveTargetUrl(''), { ok: true, url: 'https://example.com', provided: false });
assert.deepEqual(resolveTargetUrl(undefined), { ok: true, url: 'https://example.com', provided: false });
assert.deepEqual(resolveTargetUrl('   '), { ok: true, url: 'https://example.com', provided: false });

// A bare host is the reviewer's page, not a reason to use the placeholder.
assert.deepEqual(resolveTargetUrl('montefioreeinstein.org'), { ok: true, url: 'https://montefioreeinstein.org/', provided: true });
assert.deepEqual(resolveTargetUrl(' https://montefioreeinstein.org/news '), { ok: true, url: 'https://montefioreeinstein.org/news', provided: true });
assert.deepEqual(resolveTargetUrl('http://example.com/a'), { ok: true, url: 'http://example.com/a', provided: true });

// Non-http schemes are rejected rather than silently replaced.
assert.equal(resolveTargetUrl('javascript:alert(1)').ok, false);
assert.equal(resolveTargetUrl('ftp://example.com/file').ok, false);

// A URL-shaped canvas name supplies the target when the field was left blank.
assert.deepEqual(
  resolveCanvasTarget({ canvasName: 'https://montefioreeinstein.org/cancer', targetUrl: '' }),
  { ok: true, url: 'https://montefioreeinstein.org/cancer', provided: true },
);
assert.deepEqual(
  resolveCanvasTarget({ canvasName: 'montefioreeinstein.org/cancer', targetUrl: '' }),
  { ok: true, url: 'https://montefioreeinstein.org/cancer', provided: true },
);
// A normal name never becomes a URL.
assert.deepEqual(resolveCanvasTarget({ canvasName: 'Q3 Marketing', targetUrl: '' }),
  { ok: true, url: 'https://example.com', provided: false });
// An explicit target always wins.
assert.deepEqual(
  resolveCanvasTarget({ canvasName: 'https://other.example', targetUrl: 'https://montefioreeinstein.org/cancer' }),
  { ok: true, url: 'https://montefioreeinstein.org/cancer', provided: true },
);

console.log('PASS  canvas target URL');
