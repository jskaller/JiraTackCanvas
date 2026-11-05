import assert from 'node:assert/strict';
import { isJiraTackChrome } from './screenshot.js';

/**
 * Chrome is excluded from every raster by id, because hiding it made the
 * reviewer's panel blink for as long as a capture took (5.90 regression).
 */
assert.equal(isJiraTackChrome({ id: 'jiratack-overlay' }), true);
assert.equal(isJiraTackChrome({ id: 'jiratack-viewport-bar' }), true);

// Pins and the sidebar live *inside* the ignored overlay: ignoring the overlay
// covers them, and matching them directly would be redundant but harmless.
assert.equal(isJiraTackChrome({ id: 'jiratack-sidebar' }), false);
assert.equal(isJiraTackChrome({ id: 'jiratack-pins' }), false);
assert.equal(isJiraTackChrome({ id: 'app-root' }), false);
assert.equal(isJiraTackChrome(null), false);
assert.equal(isJiraTackChrome({}), false);
assert.equal(isJiraTackChrome({ id: 42 }), false);

console.log('PASS  chrome exclusion');
