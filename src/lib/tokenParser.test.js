import assert from 'node:assert/strict';
import { parseCompositeToken, buildCompositeToken } from './tokenParser.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    passed += 1;
    console.log(`PASS  ${label}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const invite = 'a'.repeat(64);
const installId = 'b'.repeat(32);

check('no dot is legacy', parseCompositeToken(invite), {
  inviteToken: invite,
  installId: '',
  composite: false,
});

check('32-hex suffix is composite', parseCompositeToken(`${invite}.${installId}`), {
  inviteToken: invite,
  installId,
  composite: true,
});

check('malformed suffix falls through', parseCompositeToken(`${invite}.not-a-real-id`), {
  inviteToken: `${invite}.not-a-real-id`,
  installId: '',
  composite: false,
  malformedComposite: true,
});

check('UUID suffix is malformed, not accepted', parseCompositeToken(`${invite}.123e4567-e89b-12d3-a456-426614174000`), {
  inviteToken: `${invite}.123e4567-e89b-12d3-a456-426614174000`,
  installId: '',
  composite: false,
  malformedComposite: true,
});

check('trailing dot is malformed', parseCompositeToken(`${invite}.`), {
  inviteToken: `${invite}.`,
  installId: '',
  composite: false,
  malformedComposite: true,
});

check('empty input', parseCompositeToken(''), { inviteToken: '', installId: '', composite: false });
check('non-string input', parseCompositeToken(null), { inviteToken: '', installId: '', composite: false });

check('build composite', buildCompositeToken(invite, installId), `${invite}.${installId}`);
check('build legacy is bare', buildCompositeToken(invite, ''), invite);
check('build missing invite', buildCompositeToken('', installId), '');
check('legacy round-trip parses as legacy', parseCompositeToken(buildCompositeToken(invite, '')), {
  inviteToken: invite,
  installId: '',
  composite: false,
});

console.log(`\n${passed}/${passed + failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
