import assert from 'node:assert/strict';
import {
  prefillConfigKey,
  normalizePrefillFields,
  prefillDescriptionEntries,
  splitPrefillForCreate,
  readCanvasPrefill,
} from './fieldPrefill.js';

// --- normalisation ---------------------------------------------------------
assert.deepEqual(normalizePrefillFields(undefined), { ok: true, fields: [] });
assert.deepEqual(normalizePrefillFields([]), { ok: true, fields: [] });
assert.equal(normalizePrefillFields('nope').ok, false);
assert.equal(normalizePrefillFields([{ value: 'x' }]).ok, false);
assert.equal(normalizePrefillFields([{ fieldId: 'customfield_1' }]).ok, false);
assert.equal(normalizePrefillFields([{ fieldId: 'summary', value: 'x' }]).ok, false);

const mapped = normalizePrefillFields([{
  fieldId: 'customfield_11234',
  fieldName: ' Figma Link ',
  value: ' https://figma.com/file/abc ',
}]);
assert.equal(mapped.ok, true);
assert.deepEqual(mapped.fields[0], {
  fieldId: 'customfield_11234',
  fieldName: 'Figma Link',
  value: 'https://figma.com/file/abc',
});

const labelOnly = normalizePrefillFields([{ fieldName: 'UAT URL', value: 'https://uat.example.com' }]);
assert.equal(labelOnly.ok, true);
assert.equal(labelOnly.fields[0].fieldId, null);

// Legacy D41 rows still read: mapped rows keep their target, description rows
// become label-only notes.
const legacy = normalizePrefillFields([
  { label: 'UAT URL', value: 'https://uat.example.com', mode: 'description' },
  { label: 'Figma', value: 'https://figma.com/x', mode: 'mapped', targetFieldId: 'customfield_9', targetFieldName: 'Figma Link' },
]);
assert.equal(legacy.ok, true);
assert.equal(legacy.fields[0].fieldId, null);
assert.equal(legacy.fields[0].fieldName, 'UAT URL');
assert.deepEqual(legacy.fields[1], { fieldId: 'customfield_9', fieldName: 'Figma Link', value: 'https://figma.com/x' });

assert.equal(normalizePrefillFields([{ fieldName: 'L', value: 'v'.repeat(2001) }]).ok, false);
assert.equal(normalizePrefillFields(new Array(11).fill({ fieldName: 'L', value: 'v' })).ok, false);

// --- description entries ---------------------------------------------------
assert.deepEqual(
  prefillDescriptionEntries([{ fieldId: 'customfield_1', fieldName: 'Figma', value: 'https://figma.com' }]),
  [{ label: 'Figma', value: 'https://figma.com' }],
);

// --- create-time split -----------------------------------------------------
const fields = [
  { fieldId: 'customfield_1', fieldName: 'Figma Link', value: 'https://figma.com' },
  { fieldId: 'customfield_2', fieldName: 'UAT URL', value: 'https://uat.example.com' },
  { fieldId: null, fieldName: 'Note', value: 'hello' },
  { fieldId: 'summary', fieldName: 'Summary', value: 'nope' },
];

const verified = splitPrefillForCreate(fields, new Set(['customfield_1', 'summary']));
assert.deepEqual(verified.writable, { customfield_1: 'https://figma.com' });
assert.deepEqual(
  verified.fallback.map((field) => field.fieldName),
  ['UAT URL', 'Note', 'Summary'],
);

const unverified = splitPrefillForCreate(fields, null);
assert.deepEqual(unverified.writable, {});
assert.equal(unverified.fallback.length, 4);

// --- stored shape ----------------------------------------------------------
assert.deepEqual(readCanvasPrefill(null), []);

const v2 = readCanvasPrefill({
  version: 2,
  prefillFields: [{ fieldId: 'customfield_1', fieldName: 'Figma Link', value: 'https://figma.com' }],
});
assert.equal(v2.length, 1);
assert.equal(v2[0].fieldId, 'customfield_1');

// A record written by the first cut (projectKey included) still reads.
const oldStored = readCanvasPrefill({
  version: 2,
  projectKey: 'TEST',
  prefillFields: [{ fieldId: 'customfield_1', fieldName: 'Figma Link', value: 'https://figma.com' }],
});
assert.equal(oldStored.length, 1);

const legacyStored = readCanvasPrefill([{ label: 'UAT URL', value: 'https://uat.example.com', mode: 'description' }]);
assert.equal(legacyStored[0].fieldName, 'UAT URL');

// --- storage key -----------------------------------------------------------
const key = prefillConfigKey('Q3 Marketing');
assert.match(key, /^canvasAux:[a-f0-9]{32}$/);
assert.equal(key, prefillConfigKey('Q3 Marketing'));
assert.notEqual(key, prefillConfigKey('Q3 Marketing '));

console.log('PASS  canvas field pre-fills (D41)');
