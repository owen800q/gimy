import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
await mkdir(path.join(out, 'vendor'), { recursive: true });
for (const file of ['index.html', 'style.css', 'home.css', 'state.js', 'app.js', 'home.js', 'favicon.svg', 'vendor/hls.light.min.js', 'vendor/hls-LICENSE', '_headers', '_routes.json', '.assetsignore']) await copyFile(path.join(root, 'src', file), path.join(out, file));
// Concatenate the server modules into one Worker script; only the default export and the Durable Object class stay exported.
const modules = [];
for (const file of ['adapter.js', 'gimy.js', 'sync-server.js', 'worker.js']) {
  let code = (await readFile(path.join(root, 'src', file), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export \{[^}]*\} from .*;\n/gm, '');
  if (file !== 'worker.js') code = code.replace(/^export (?!class WatchHistory)/gm, '');
  modules.push(code);
}
await writeFile(path.join(out, '_worker.js'), modules.join('\n'));
console.log('Built static assets and Worker in dist/.');
