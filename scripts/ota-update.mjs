// Publish the TV app for over-the-air updates: copies dist/tv into the Worker's assets as
// dist/tv-app/ (manifest.json and v/<build id>/). Installed apps check the manifest in
// the background and switch to a new build on their next launch.
// Run by the Worker build (wrangler.jsonc) after scripts/build.mjs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeUpdate } from '../ota/build.mjs';
import { LOCAL_FILES, tvPage } from './tv-page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dist', 'tv');
const html = tvPage(await readFile(path.join(dir, 'index.html'), 'utf8'));
const id = await writeUpdate({ dir, html, exclude: LOCAL_FILES, out: path.join(root, 'dist') });
console.log(`TV app build ${id} published to dist/tv-app/.`);
