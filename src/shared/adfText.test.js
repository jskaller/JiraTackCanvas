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

// splitDescription: header + body + console + page footer
const desc = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '[JiraTack Guest: Ann]', marks: [{ type: 'strong' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'user body' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Console output:' }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'log!' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Page: ' },
        { type: 'text', text: 'https://x.test/', marks: [{ type: 'link', attrs: { href: 'https://x.test/' } }] },
      ],
    },
  ],
};
const split = splitDescription(desc);
check('header kept', Boolean(split.header), true);
check('body isolated', adfToText({ type: 'doc', content: split.body }), 'user body');
check('console kept', split.console.length, 2);
check('footer kept', Boolean(split.footer), true);

// mergeDescription replaces only the body
const merged = mergeDescription('edited\nbody', split);
const mergedTexts = merged.content
  .filter((n) => n.type === 'paragraph')
  .map((n) => (n.content && n.content[0] && n.content[0].text) || '');
check('merged header', mergedTexts[0], '[JiraTack Guest: Ann]');
check('merged body line 1', mergedTexts[1], 'edited');
check('merged body line 2', mergedTexts[2], 'body');
check('merged footer last', mergedTexts[mergedTexts.length - 1].startsWith('Page:'), true);

// splitDescription without header: body is everything
const noHeader = splitDescription({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] });
check('no header', noHeader.header, null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
