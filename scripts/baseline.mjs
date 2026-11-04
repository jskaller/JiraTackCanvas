#!/usr/bin/env node
/**
 * docs/BASELINE.md is the deployment ledger, and it has silently drifted twice:
 * a string replacement that matched nothing looked exactly like a successful
 * update. This script replaces that pattern.
 *
 *   node scripts/baseline.mjs check
 *       Fails when the ledger disagrees with src/lib/version.js, when a required
 *       row is missing, or when the change table is malformed.
 *
 *   node scripts/baseline.mjs record --version 5.81.0 --date 2026-11-04T22:10Z [--sdk abc123] [--change "what changed"]
 *       Rewrites the version/date/SDK rows and the "Deployed …" paragraph,
 *       asserting every edit landed, optionally appends a change row, then
 *       re-reads the file and verifies the result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = process.env.BASELINE_FILE
  ? path.resolve(process.env.BASELINE_FILE)
  : path.join(root, 'docs', 'BASELINE.md');
const VERSION_FILE = path.join(root, 'src', 'lib', 'version.js');

function readSdkVersion() {
  const source = fs.readFileSync(VERSION_FILE, 'utf8');
  const match = source.match(/SDK_VERSION\s*=\s*'([^']+)'/);
  if (!match) throw new Error('Could not read SDK_VERSION from src/lib/version.js');
  return match[1];
}

const ROWS = {
  version: {
    label: 'App version (deployed)',
    pattern: /^\| App version \(deployed\) \| .*$/m,
    build: (value) => `| App version (deployed) | **${value}** | \`forge deploy\` output, \`forge install list\` |`,
    read: /^\| App version \(deployed\) \| \*\*([^*]+)\*\* /m,
  },
  date: {
    label: 'Development last deployed',
    pattern: /^\| Development last deployed \| .*$/m,
    build: (value) => `| Development last deployed | ${value} (scopes unchanged unless stated) | \`forge deploy list\` |`,
    read: /^\| Development last deployed \| (\S+) /m,
  },
  sdk: {
    label: 'SDK hash (deployed)',
    pattern: /^\| SDK hash \(deployed\) \| `[^`]+` \|.*$/m,
    build: (value) => `| SDK hash (deployed) | \`${value}\` | served \`ETag\`, \`src/lib/version.js\` |`,
    read: /^\| SDK hash \(deployed\) \| `([^`]+)`/m,
  },
};

const PARAGRAPH = /\*\*Deployed (\d{4}-\d{2}-\d{2})\.\*\* Development runs the current tree as app \*\*([^*]+)\*\*, SDK `([^`]+)`/;

function parse(text) {
  const parsed = {};
  const missing = [];
  for (const [name, row] of Object.entries(ROWS)) {
    const match = text.match(row.read);
    if (!match) missing.push(row.label);
    else parsed[name] = match[1];
  }
  const paragraph = text.match(PARAGRAPH);
  if (!paragraph) missing.push('**Deployed …** paragraph');
  else parsed.paragraphDate = paragraph[1];
  parsed.paragraphVersion = paragraph ? paragraph[2] : null;
  parsed.paragraphSdk = paragraph ? paragraph[3] : null;
  return { parsed, missing };
}

function checkChangeTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === '| Change | Commits | Status |');
  if (start === -1) return ['The change table header is missing.'];
  const problems = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) break;
    const cells = line.split('|').length - 2;
    if (cells !== 3) {
      problems.push(`Change table line ${index + 1} has ${cells} cells, expected 3.`);
    }
  }
  return problems;
}

function check(text, sdk) {
  const problems = [];
  const { parsed, missing } = parse(text);

  for (const label of missing) problems.push(`Missing ledger row: ${label}`);

  if (parsed.sdk && parsed.sdk !== sdk) {
    problems.push(`SDK hash row is ${parsed.sdk} but src/lib/version.js says ${sdk}.`);
  }
  if (parsed.paragraphSdk && parsed.paragraphSdk !== sdk) {
    problems.push(`The "Deployed …" paragraph says SDK ${parsed.paragraphSdk} but the tree says ${sdk}.`);
  }
  if (parsed.version && parsed.paragraphVersion && parsed.version !== parsed.paragraphVersion) {
    problems.push(`Version row (${parsed.version}) disagrees with the paragraph (${parsed.paragraphVersion}).`);
  }
  if (parsed.date && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(parsed.date)) {
    problems.push(`Deployment date "${parsed.date}" is not YYYY-MM-DDTHH:MMZ.`);
  }
  if (parsed.date && parsed.paragraphDate && !parsed.date.startsWith(parsed.paragraphDate)) {
    problems.push(`Date row (${parsed.date}) disagrees with the paragraph (${parsed.paragraphDate}).`);
  }

  problems.push(...checkChangeTable(text));
  return problems;
}

function record(text, { version, date, sdk }) {
  let next = text;
  const values = { version, date, sdk };

  for (const [name, row] of Object.entries(ROWS)) {
    const value = values[name];
    if (!value) continue;
    if (!row.pattern.test(next)) {
      throw new Error(`Could not find the "${row.label}" row. Nothing was written.`);
    }
    // Only a missing row is an error; recording the same SDK twice is normal.
    next = next.replace(row.pattern, row.build(value));
  }

  const paragraph = next.match(PARAGRAPH);
  if (!paragraph) throw new Error('Could not find the "**Deployed …**" paragraph. Nothing was written.');
  const day = (date || paragraph[1]).slice(0, 10);
  const nextParagraph = `**Deployed ${day}.** Development runs the current tree as app **${version || paragraph[2]}**, SDK \`${sdk || paragraph[3]}\``;
  next = next.replace(PARAGRAPH, nextParagraph);

  return next;
}

function appendChange(text, change, version) {
  if (!change) return text;
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === '| Change | Commits | Status |');
  if (start === -1) throw new Error('The change table header is missing.');
  let last = start + 1;
  for (let index = start + 2; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) break;
    last = index;
  }
  const row = `| ${change} | working tree (uncommitted) | **Deployed** ${new Date().toISOString().slice(0, 10)} as ${version} |`;
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const text = fs.readFileSync(BASELINE, 'utf8');
  const sdk = readSdkVersion();

  if (command === 'check') {
    const problems = check(text, sdk);
    if (problems.length > 0) {
      console.error('BASELINE.md is inconsistent:');
      problems.forEach((problem) => console.error(`  - ${problem}`));
      process.exit(1);
    }
    console.log(`BASELINE.md is consistent (SDK ${sdk}).`);
    return;
  }

  if (command === 'record') {
    const args = {};
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index];
      if (!flag.startsWith('--')) continue;
      args[flag.slice(2)] = rest[index + 1];
      index += 1;
    }
    if (!args.version || !args.date) {
      console.error('Usage: node scripts/baseline.mjs record --version <v> --date <YYYY-MM-DDTHH:MMZ> [--sdk <hash>] [--change "<text>"]');
      process.exit(2);
    }

    let next = record(text, { version: args.version, date: args.date, sdk: args.sdk || sdk });
    next = appendChange(next, args.change, args.version);

    const problems = check(next, sdk);
    if (problems.length > 0) {
      console.error('Refusing to write an inconsistent ledger:');
      problems.forEach((problem) => console.error(`  - ${problem}`));
      process.exit(1);
    }

    fs.writeFileSync(BASELINE, next);

    // Verify the bytes that actually landed, not the string we meant to write.
    const written = fs.readFileSync(BASELINE, 'utf8');
    const expected = [args.version, args.sdk || sdk, args.date];
    const lost = expected.filter((value) => !written.includes(value));
    if (lost.length > 0) {
      console.error(`Wrote BASELINE.md but these values are absent: ${lost.join(', ')}`);
      process.exit(1);
    }
    console.log(`Recorded ${args.version} at ${args.date} (SDK ${args.sdk || sdk}) in docs/BASELINE.md.`);
    return;
  }

  console.error('Usage: node scripts/baseline.mjs <check|record>');
  process.exit(2);
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}
