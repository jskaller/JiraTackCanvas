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

const SOURCE = 'src/extension';
const shared = ['background.js', 'bridge.js', 'options.html', 'options.js'];
const targets = [
  { dir: 'dist/extension-chrome', manifest: 'manifest.chrome.json' },
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
    copy(path.join(SOURCE, file), path.join(target.dir, file));
  }

  if (target.manifest === 'manifest.chrome.json') {
    // Chrome's MV3 recorder needs an offscreen document; Firefox falls back to
    // getDisplayMedia in the page.
    copy(path.join(SOURCE, 'offscreen.html'), path.join(target.dir, 'offscreen.html'));
    copy(path.join(SOURCE, 'offscreen.js'), path.join(target.dir, 'offscreen.js'));
  }

  // shared config parser lives with the other shared modules so it is tested
  copy('src/shared/extensionConfig.js', path.join(target.dir, 'extensionConfig.js'));

  // icons are shared by every package
  const iconSource = path.resolve(SOURCE, 'icons');
  const iconTarget = path.resolve(target.dir, 'icons');
  fs.mkdirSync(iconTarget, { recursive: true });
  for (const file of fs.readdirSync(iconSource)) {
    fs.copyFileSync(path.join(iconSource, file), path.join(iconTarget, file));
  }
  copy(path.join(SOURCE, target.manifest), path.join(target.dir, 'manifest.json'));

  console.log(`[JiraTack] extension assembled at ${target.dir}`);
}

const manifest = JSON.parse(fs.readFileSync(path.resolve('dist/extension-chrome/manifest.json'), 'utf8'));
console.log(`[JiraTack] ${manifest.name} ${manifest.version} \u2014 load unpacked from ./dist/extension-chrome`);
