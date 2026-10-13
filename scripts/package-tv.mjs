// Assemble the Samsung TV (Tizen) widget from dist/tv and sign it when the Tizen CLI is available.
// Usage: npm run package:tv -- --api https://gimy-tv.<account>.workers.dev [--profile <security-profile>]
// GIMY_API and TIZEN_PROFILE work as environment variables too.
import { cp, mkdir, readFile, rm, writeFile, readdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const api = (arg('api') || process.env.GIMY_API || '').replace(/\/+$/, '');
const profile = arg('profile') || process.env.TIZEN_PROFILE;
if (api && !/^https?:\/\/[^\s/]+$/.test(api)) throw new Error('--api must be an origin such as https://gimy-tv.example.workers.dev');

execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'build');
const stage = path.join(out, 'widget');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'dist', 'tv'), stage, { recursive: true });

// Without --api the app asks for the server address under 裝置同步 on first launch.
await writeFile(path.join(stage, 'config.js'), api ? 'window.GIMY_API = ' + JSON.stringify(api) + ';\n' : '// Set the Worker address under 裝置同步 on the TV.\n');
// Samsung's webapis (screensaver control) is only available inside the TV runtime.
const html = (await readFile(path.join(stage, 'index.html'), 'utf8'))
  .replace('<link rel="icon" href="../favicon.svg">', '')
  .replace('<script src="config.js"></script>', '<script src="$WEBAPIS/webapis/webapis.js"></script>\n  <script src="config.js"></script>');
await writeFile(path.join(stage, 'index.html'), html);
const config = (await readFile(path.join(root, 'tizen', 'config.xml'), 'utf8')).replace(/(<widget[^>]*\sversion=")[^"]*"/, `$1${pkg.version}"`);
await writeFile(path.join(stage, 'config.xml'), config);
await cp(path.join(root, 'tizen', 'icon.png'), path.join(stage, 'icon.png'));

const tizenHome = process.env.TIZEN_HOME || path.join(os.homedir(), 'tizen-studio');
const tizen = [path.join(tizenHome, 'tools', 'ide', 'bin', 'tizen'), 'tizen'].find(bin => { try { execFileSync(bin, ['version'], { stdio: 'ignore' }); return true; } catch { return false; } });
const target = path.join(out, 'GimyTV.wgt');
if (tizen && profile) {
  execFileSync(tizen, ['package', '-t', 'wgt', '-s', profile, '-o', out, '--', stage], { stdio: 'inherit' });
  // The CLI names the file after <name>; sdb cannot transfer names with spaces or non-ASCII characters.
  const built = (await readdir(out)).find(file => file.endsWith('.wgt'));
  if (built !== 'GimyTV.wgt') await rename(path.join(out, built), target);
  console.log('Signed widget: ' + path.relative(root, target));
} else {
  const unsigned = path.join(out, 'GimyTV-unsigned.wgt');
  execFileSync('zip', ['-qr', unsigned, '.'], { cwd: stage });
  console.log('Unsigned widget: ' + path.relative(root, unsigned));
  console.log(tizen ? 'Pass --profile <certificate profile> to sign it; a TV only installs signed widgets.' : 'Tizen CLI not found; install Tizen Studio to sign (see README).');
}
if (!api) console.log('No --api given: the TV will ask for the Worker address under 裝置同步.');
if (!existsSync(path.join(stage, 'tv.js'))) throw new Error('widget is missing tv.js');
