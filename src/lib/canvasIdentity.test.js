import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { kvs, resetKvs } from '../../scripts/test-support/stubs/forge-kvs.mjs';
import {
  generatedCanvasKey,
  canvasNameIndexKey,
  ensureCanvasRecord,
  setCanvasFolder,
} from './canvasRegistry.js';
import {
  canvasIdsFromPayload,
  findCanvasKeyInMaps,
  isGeneratedCanvasKey,
  looksLikeRecordKey,
  resolveCanvas,
} from './canvasIdentity.js';

beforeEach(() => {
  resetKvs();
});

async function seed({ name, seedKey = null }) {
  const { record } = await ensureCanvasRecord({ name, seedKey });
  return record;
}

test('a key resolves to its record', async () => {
  const record = await seed({ name: 'Seed canvas', seedKey: 'KAN-90' });

  assert.equal((await resolveCanvas({ canvasKey: 'KAN-90' })).key, record.key);
});

test('a name resolves through the name index', async () => {
  const record = await seed({ name: 'Shopify + Example.com' });

  assert.equal((await resolveCanvas({ canvasName: 'Shopify + Example.com' })).key, record.key);
});

/**
 * The observed failure: the `canvasName:` row was missing, so a name-based
 * lookup found nothing. A pre-seed canvas is keyed by a hash of its name, so it
 * can be found in one read without scanning every record.
 */
test('a name resolves without the name index, through the generated key', async () => {
  const record = await seed({ name: 'Shopify + Example.com' });
  await kvs.delete(canvasNameIndexKey('Shopify + Example.com'));

  const resolved = await resolveCanvas({ canvasName: 'Shopify + Example.com' });

  assert.equal(resolved.key, record.key);
  assert.equal(record.key, generatedCanvasKey('Shopify + Example.com'));
});

/**
 * A seed-key canvas has no derivable key, so a lost index row can only be
 * repaired by scanning — which is why that scan is opt-in and expensive.
 */
test('a seed-key canvas needs the scan when its index row is lost', async () => {
  const record = await seed({ name: 'Cancer Pages', seedKey: 'KAN-90' });
  await kvs.delete(canvasNameIndexKey('Cancer Pages'));

  assert.equal(await resolveCanvas({ canvasName: 'Cancer Pages' }), null);
  assert.equal((await resolveCanvas({ canvasName: 'Cancer Pages' }, { scan: true })).key, record.key);
});

test('a key-shaped id given as a name resolves as a key', async () => {
  const record = await seed({ name: 'Cancer Pages', seedKey: 'KAN-90' });

  assert.equal((await resolveCanvas({ canvasName: 'KAN-90' })).key, record.key);
  assert.equal((await resolveCanvas({ canvasId: 'KAN-90', canvasName: 'KAN-90' })).key, record.key);
});

test('an unknown canvas resolves to null', async () => {
  await seed({ name: 'Known' });

  assert.equal(await resolveCanvas({ canvasKey: 'KAN-404' }), null);
  assert.equal(await resolveCanvas({ canvasName: 'Not a canvas' }), null);
  assert.equal(await resolveCanvas({ canvasName: 'c-00000000' }), null);
  assert.equal(await resolveCanvas({}), null);
  assert.equal(await resolveCanvas(), null);
});

test('the in-memory resolver agrees with the I/O resolver', async () => {
  const record = await seed({ name: 'Shopify + Example.com' });

  const records = new Map([[record.key, record]]);
  const nameIndex = new Map([['shopify + example.com', record.key]]);

  assert.equal(findCanvasKeyInMaps({ canvasName: 'Shopify + Example.com' }, records, nameIndex), record.key);
  assert.equal(findCanvasKeyInMaps({ canvasKey: record.key }, records, nameIndex), record.key);
  assert.equal(findCanvasKeyInMaps({ canvasName: 'nope' }, records, nameIndex), null);

  // The generated-key fallback works with no index at all.
  const emptyIndex = new Map();
  assert.equal(findCanvasKeyInMaps({ canvasName: 'Shopify + Example.com' }, records, emptyIndex), record.key);
});

test('the in-memory resolver prefers the record key over a stale id', async () => {
  const record = await seed({ name: 'Renamed' });
  await setCanvasFolder(record.key, 'QA');

  const records = new Map([[record.key, { ...record, folder: 'QA' }]]);
  const nameIndex = new Map([['renamed', record.key]]);

  assert.equal(
    findCanvasKeyInMaps({ canvasKey: 'KAN-000', canvasName: 'Renamed' }, records, nameIndex),
    record.key,
  );
});

test('payload ids normalise to a key or a name, never both by accident', () => {
  assert.deepEqual(canvasIdsFromPayload({ canvasId: 'KAN-90' }), { canvasKey: 'KAN-90', canvasName: '' });
  assert.deepEqual(canvasIdsFromPayload({ canvasId: 'Shopify + Example.com' }), {
    canvasKey: '',
    canvasName: 'Shopify + Example.com',
  });
  assert.deepEqual(canvasIdsFromPayload({ canvasKey: 'c-abcdef12', canvasName: 'Label' }), {
    canvasKey: 'c-abcdef12',
    canvasName: 'Label',
  });
  assert.deepEqual(canvasIdsFromPayload({}), { canvasKey: '', canvasName: '' });
});

test('key-shape helpers do not claim ordinary names', () => {
  assert.equal(isGeneratedCanvasKey('c-abcdef12'), true);
  assert.equal(isGeneratedCanvasKey('c-abcdef'), false);
  assert.equal(isGeneratedCanvasKey('Shopify + Example.com'), false);

  assert.equal(looksLikeRecordKey('KAN-90'), true);
  assert.equal(looksLikeRecordKey('c-abcdef12'), true);
  assert.equal(looksLikeRecordKey('Q3 Marketing'), false);
});

/**
 * Resolution must not pay a scan on every call: a lookup that had to bypass the
 * name index writes the row back, which is what stops `getPins` scanning every
 * 15 seconds for a canvas whose index was lost.
 */
test('a resolution that bypasses the index repairs it, once', async () => {
  const generated = await seed({ name: 'Generated' });
  await kvs.delete(canvasNameIndexKey('Generated'));
  await resolveCanvas({ canvasName: 'Generated' });
  assert.equal(await kvs.get(canvasNameIndexKey('Generated')), generated.key);

  const seeded = await seed({ name: 'Seeded', seedKey: 'KAN-12' });
  await kvs.delete(canvasNameIndexKey('Seeded'));
  await resolveCanvas({ canvasName: 'Seeded' }, { scan: true });
  assert.equal(await kvs.get(canvasNameIndexKey('Seeded')), seeded.key);
});
