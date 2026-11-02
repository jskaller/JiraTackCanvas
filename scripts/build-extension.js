import fs from 'node:fs';
import path from 'node:path';

/**
 * Assembles loadable extension folders from the built SDK.
 *
 * Chrome reads `extension/` directly (load unpacked). Firefox gets its own
 * directory because MV3 background differs: `background.service_worker` in
 * Chrome, `background.scripts` in Firefox.
 */
const bundle = path.resolve('dist/bookmarklet/jiratack.js');
if (!fs.existsSync(bundle)) {
  console.error('[JiraTack] SDK bundle missing. Run `npm run build:bookmarklet` first.');
  process.exit(1);
}

const shared = ['background.js', 'bridge.js', 'options.html', 'options.js', 'extensionConfig.js'];
const targets = [
  { dir: 'extension', manifest: 'manifest.chrome.json' },
  { dir: 'dist/extension-firefox', manifest: 'manifest.firefox.json' },
];

// config parser lives with the shared modules so it can be unit tested
if (!fs.existsSync('src/shared/extensionConfig.js')) {
  console.error('[JiraTack] src/shared/extensionConfig.js missing.');
  process.exit(1);
}

for (const target of targets) {
  fs.mkdirSync(target.dir, { recursive: true });

  const copy = (from, to) => {
    const src = path.resolve(from);
    const dest = path.resolve(to);
    if (src === dest) return;
    fs.copyFileSync(src, dest);
  };

  copy(bundle, path.join(target.dir, 'sdk.js'));

  // dist keeps the placeholder; the extension must self-identify (D13/5.19).
  const versionFile = path.resolve('src/lib/version.js');
  if (fs.existsSync(versionFile)) {
    const version = (fs.readFileSync(versionFile, 'utf8').match(/SDK_VERSION\s*=\s*'([^']+)'/) || [])[1];
    if (version) {
      const sdkPath = path.join(target.dir, 'sdk.js');
      const source = fs.readFileSync(sdkPath, 'utf8');
      fs.writeFileSync(sdkPath, source.split('__JIRATACK_SDK_VERSION__').join(version));
    }
  }

  for (const file of shared) {
    const from = file === 'extensionConfig.js'
      ? 'src/shared/extensionConfig.js'
      : path.join('extension', file);
    copy(from, path.join(target.dir, file));
  }

  // icons are shared by every package
  const iconSource = path.resolve('extension/icons');
  const iconTarget = path.resolve(target.dir, 'icons');
  if (path.resolve(target.dir) !== path.resolve('extension')) {
    fs.mkdirSync(iconTarget, { recursive: true });
    for (const file of fs.readdirSync(iconSource)) {
      fs.copyFileSync(path.join(iconSource, file), path.join(iconTarget, file));
    }
  }
  copy(path.join('extension', target.manifest), path.join(target.dir, 'manifest.json'));

  console.log(`[JiraTack] extension assembled at ${target.dir}`);
}

const manifest = JSON.parse(fs.readFileSync(path.resolve('extension/manifest.json'), 'utf8'));
console.log(`[JiraTack] ${manifest.name} ${manifest.version} \u2014 load unpacked from ./extension`);
