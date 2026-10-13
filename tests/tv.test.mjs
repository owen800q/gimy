import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../src/worker.js';

const env = { ASSETS: { fetch: async () => new Response('player assets') } };
const call = (path, options) => worker.fetch(new Request('https://gimy-tv.workers.dev' + path, options), env);
const source = name => readFile(new URL('../src/tv/' + name, import.meta.url), 'utf8');

test('the packaged TV app origin may call the API with CORS headers', async () => {
  for (const origin of ['file://', 'null']) {
    const preflight = await call('/api/history', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
    const health = await call('/api/health', { headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), origin);
    const history = await call('/api/history', { headers: { Origin: origin } });
    assert.equal(history.status, 401);
    assert.equal(history.headers.get('access-control-allow-origin'), origin);
  }
  const web = await call('/api/health');
  assert.equal(web.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/api/health', { headers: { Origin: 'https://evil.test' } })).status, 403);
});

// Tizen 4.0 (2018 TVs) runs Chromium 56 and the TV script ships without a transpiler.
test('the TV script avoids syntax and APIs missing from Chromium 56', async () => {
  const code = await source('tv.js');
  new vm.Script(code);
  const stripped = code.replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const banned = [[/\?\./, 'optional chaining'], [/\?\?/, 'nullish coalescing'], [/\{\s*\.\.\.|,\s*\.\.\.\w+\s*\}/, 'object spread/rest'], [/\.finally\(/, 'Promise#finally'], [/padStart|padEnd/, 'String#padStart'], [/replaceChildren|AbortController|AbortSignal|structuredClone|Object\.fromEntries|\.flat\(|\.at\(/, 'newer DOM/JS API'], [/new URLSearchParams\(\{/, 'URLSearchParams(object)'], [/,\s*\)/, 'trailing comma in a call']];
  for (const [pattern, name] of banned) assert.doesNotMatch(stripped, pattern, name);
  const css = (await source('tv.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /(?:^|[;{\s])(?:gap|inset|aspect-ratio)\s*:|:focus-within/, 'CSS newer than Chromium 56');
});
