import assert from 'node:assert/strict';
import { adfToText, textToAdf } from './adfText.js';
import { splitDescription, mergeDescription } from '../lib/descriptionBlocks.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  try {
    assert.equal(actual, expected);
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// adfToText: paragraphs joined with newlines
check(
  'paragraphs',
  adfToText({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: 'World' }] },
  ] }),
  'Hello\n\nWorld',
);

// adfToText: hardBreak inside paragraph
check(
  'hardBreak',
  adfToText({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
  ] }),
  'a\nb',
);

// adfToText: codeBlock preserved as lines
check(
  'codeBlock',
  adfToText({ type: 'doc', content: [
    { type: 'codeBlock', content: [{ type: 'text', text: 'line1\nline2' }] },
  ] }),
  'line1\nline2',
);

// textToAdf round-trips
const roundTrip = adfToText(textToAdf('one\n\ntwo'));
check('text round-trip', roundTrip, 'one\n\ntwo');

// textToAdf empty
check('empty adf blocks', textToAdf('').content.length, 0);

// splitDescription: guest prefix + body + console + marker
const marker = { canvas: 'C', url: 'https://x.test/', position: '1,2' };
const desc = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '[Guest: Ann <a@b.c>]' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'user body' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Console output:' }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'log!' }] },
    { type: 'paragraph', content: [{ type: 'text', text: `📌 JiraTack pin: ${JSON.stringify(marker)}` }] },
  ],
};
const split = splitDescription(desc);
check('prefix kept', split.prefix.length, 1);
check('body isolated', adfToText({ type: 'doc', content: split.body }), 'user body');
check('console kept', split.console.length, 2);
check('marker kept', Boolean(split.marker), true);

// mergeDescription replaces only the body
const merged = mergeDescription('edited\nbody', split);
const mergedTexts = merged.content
  .filter((n) => n.type === 'paragraph')
  .map((n) => (n.content && n.content[0] && n.content[0].text) || '');
check('merged prefix', mergedTexts[0], '[Guest: Ann <a@b.c>]');
check('merged body line 1', mergedTexts[1], 'edited');
check('merged body line 2', mergedTexts[2], 'body');
check('merged marker last', mergedTexts[mergedTexts.length - 1].startsWith('📌 JiraTack pin:'), true);

// splitDescription without marker: body is everything, merge keeps behavior safe
const noMarker = splitDescription({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] });
check('no marker', noMarker.marker, null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
