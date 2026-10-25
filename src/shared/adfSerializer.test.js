import assert from 'node:assert/strict';
import { serializeToAdf } from './adfSerializer.js';

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'next line' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
      ],
    },
    {
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
      ],
    },
  ],
};

const expected = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'next line' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
        },
      ],
    },
  ],
};

const checks = [
  ['paragraph', expected.content[0].type, 'paragraph'],
  ['text', expected.content[0].content[0].type, 'text'],
  ['text bold', expected.content[0].content[1].marks[0].type, 'strong'],
  ['text italic', expected.content[0].content[3].marks[0].type, 'em'],
  ['bulletList', expected.content[1].type, 'bulletList'],
  ['orderedList', expected.content[2].type, 'orderedList'],
  ['listItem', expected.content[1].content[0].type, 'listItem'],
  ['hardBreak', expected.content[0].content[4].type, 'hardBreak'],
];

const actual = serializeToAdf(doc);

let passed = 0;
let failed = 0;

for (const [name, actualValue, expectedValue] of checks) {
  try {
    assert.equal(actualValue, expectedValue);
    passed += 1;
    console.log(`PASS  ${name} -> ${actualValue}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${name}: expected ${expectedValue}, got ${actualValue}`);
  }
}

try {
  assert.deepEqual(actual, expected);
  console.log('PASS  full document deep-equal');
} catch (e) {
  failed += 1;
  console.error('FAIL  full document deep-equal');
  console.error(JSON.stringify(actual, null, 2));
}

console.log(`\n${passed}/8 node checks passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
