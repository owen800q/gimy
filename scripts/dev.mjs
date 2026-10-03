// Local preview without Wrangler: serves dist/ and routes /api/* to the bundled Worker.
// Cloud history needs the Durable Object binding, so it reports "unavailable" here and stays local.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { default: worker } = await import(path.join(dist, '_worker.js'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const ASSETS = { async fetch(request) {
  const name = new URL(request.url).pathname.replace(/\/$/, '/index.html');
  const file = path.join(dist, path.normalize(name));
  if (!file.startsWith(dist)) return new Response('Not found', { status: 404 });
  try { return new Response(await readFile(file), { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' } }); }
  catch { return new Response('Not found', { status: 404 }); }
} };
const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(done => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => done(Buffer.concat(parts))); });
  const response = await worker.fetch(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body }), { ASSETS });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log('Gimy TV preview on http://localhost:' + port));
