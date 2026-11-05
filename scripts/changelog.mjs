#!/usr/bin/env node
/**
 * Generate a release-note draft from conventional commits, so CHANGELOG.md is
 * assembled rather than remembered.
 *
 *   node scripts/changelog.mjs                     # last 20 commits
 *   node scripts/changelog.mjs --since v5.80.0     # everything after a ref
 *   node scripts/changelog.mjs --limit 6
 *
 * Prints markdown to stdout and never edits a file: the draft is edited by a
 * human, because a release note is a summary, not a transcript.
 */
import { execFileSync } from 'node:child_process';

const GROUPS = {
  feat: 'Features',
  fix: 'Fixes',
  perf: 'Performance',
  refactor: 'Internal',
  test: 'Tests and tooling',
  chore: 'Tests and tooling',
  docs: 'Documentation',
};

const ORDER = ['Features', 'Fixes', 'Performance', 'Internal', 'Tests and tooling', 'Documentation'];

function parseArgs(argv) {
  const options = { since: null, limit: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--since') options.since = argv[index + 1];
    else if (flag === '--limit') options.limit = Number(argv[index + 1]) || 20;
    else if (flag === '--help' || flag === '-h') options.help = true;
    if (flag.startsWith('--')) index += 1;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log('Usage: node scripts/changelog.mjs [--since <ref>] [--limit <n>]');
  process.exit(0);
}

let raw;
try {
  const range = options.since ? [`${options.since}..HEAD`] : [`-${options.limit}`];
  raw = execFileSync('git', ['log', ...range, '--no-merges', '--format=%h%x09%s'], { encoding: 'utf8' });
} catch (e) {
  console.error(`Could not read git history: ${e && e.message ? e.message : e}`);
  process.exit(1);
}

const grouped = new Map();
let skipped = 0;

for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const [hash, subject] = line.split('\t');
  const match = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(subject);
  if (!match) {
    skipped += 1;
    continue;
  }
  const [, type, scope, text] = match;
  const group = GROUPS[type];
  if (!group) {
    skipped += 1;
    continue;
  }
  if (!grouped.has(group)) grouped.set(group, []);
  grouped.get(group).push({ hash, scope, text });
}

if (grouped.size === 0) {
  console.error('No conventional commits in range; write the entry by hand.');
  process.exit(1);
}

console.log('## Unreleased');
console.log('');
for (const group of ORDER) {
  const entries = grouped.get(group);
  if (!entries || entries.length === 0) continue;
  console.log(`### ${group}`);
  console.log('');
  for (const entry of entries) {
    const prefix = entry.scope ? `**${entry.scope}:** ` : '';
    console.log(`- ${prefix}${entry.text} (\`${entry.hash}\`)`);
  }
  console.log('');
}

if (skipped > 0) {
  console.error(`${skipped} commit(s) skipped (not conventional); mention them by hand if they matter.`);
}
