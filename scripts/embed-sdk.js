import fs from 'node:fs';
import path from 'node:path';

const bundlePath = path.resolve('dist/bookmarklet/jiratack.js');
const outPath = path.resolve('src/lib/sdk-bundle.js');

if (!fs.existsSync(bundlePath)) {
  console.error(`[JiraTack] SDK bundle not found at ${bundlePath}. Run build:bookmarklet first.`);
  process.exit(1);
}

const source = fs.readFileSync(bundlePath, 'utf8');
const escaped = source
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const output = `export const sdkSource = \`${escaped}\`;\n`;

fs.writeFileSync(outPath, output, 'utf8');
console.log(`[JiraTack] Embedded SDK bundle (${source.length} bytes) into ${outPath}`);
