import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const bundlePath = path.resolve('dist/bookmarklet/jiratack.js');
const outPath = path.resolve('src/lib/sdk-bundle.js');
const versionPath = path.resolve('src/lib/version.js');

if (!fs.existsSync(bundlePath)) {
  console.error(`[JiraTack] SDK bundle not found at ${bundlePath}. Run build:bookmarklet first.`);
  process.exit(1);
}

const PLACEHOLDER = '__JIRATACK_SDK_VERSION__';
const raw = fs.readFileSync(bundlePath, 'utf8');
const version = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
const source = raw.split(PLACEHOLDER).join(version);
if (!raw.includes(PLACEHOLDER)) {
  console.warn('[JiraTack] SDK version placeholder not found; the running bundle cannot self-identify.');
}
const escaped = source
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const output = `export const sdkSource = \`${escaped}\`;\n`;

fs.writeFileSync(outPath, output, 'utf8');
fs.writeFileSync(versionPath, `export const SDK_VERSION = '${version}';\n`, 'utf8');
console.log(`[JiraTack] Embedded SDK bundle (${source.length} bytes) into ${outPath}`);
console.log(`[JiraTack] SDK_VERSION = ${version}`);
