import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker.js';
import { clearCaches } from '../src/gimy.js';

const origin = 'https://gimy-tv.workers.dev';
const env = { ASSETS: { fetch: async () => new Response('player assets') } };
const call = (path, options) => worker.fetch(new Request(origin + path, options), env);
const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8');

// Every upstream request is recorded; unknown URLs fail the test loudly.
function mockUpstream(t, routes) {
  const requests = [];
  clearCaches();
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    assert.equal(init.redirect, 'manual');
    const handler = routes[url];
    if (!handler) throw new Error('unexpected fetch ' + url);
    return typeof handler === 'function' ? handler(url, init) : new Response(handler, { headers: { 'Content-Type': url.endsWith('.js') || url.includes('playerconfig') ? 'application/javascript' : 'text/html; charset=utf-8' } });
  });
  return requests;
}

test('anonymous health and static routes require no account or cookies', async () => {
  const response = await call('/api/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authentication, 'none');
  assert.equal(body.service, 'gimy-tv');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(await (await call('/')).text(), 'player assets');
  assert.equal((await call('/api/unknown')).status, 404);
});

test('reject cross-site and invalid requests before contacting the source site', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  assert.equal((await call('/api/detail?id=1', { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await call('/api/detail?id=1', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  for (const path of ['/api/detail?id=abc', '/api/detail?id=12345678901', '/api/resolve?id=1&sid=x&nid=1', '/api/resolve?id=1&sid=1', '/api/catalog?type=999', '/api/catalog?type=4&sort=bad', '/api/catalog?type=4&page=0', '/api/search?q=', '/api/search?q=' + 'x'.repeat(81)]) {
    const response = await call(path);
    assert.equal(response.status, 400, path);
    assert.ok((await response.json()).error, path);
  }
});

test('catalogue browsing reads the explore page for the chosen filters', async t => {
  const requests = mockUpstream(t, { 'https://gimyai.tw/explore/4-%E6%97%A5%E6%9C%AC-hits------2---2025.html': await fixture('explore.html') });
  const response = await call('/api/catalog?type=4&area=' + encodeURIComponent('日本') + '&sort=hits&year=2025&page=2');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.items.length, 3);
  assert.equal(data.items[0].id, '325361');
  assert.equal(data.nextPage, 3);
  assert.equal(data.page, 2);
  assert.ok(Array.isArray(data.types) && data.types.some(x => x.id === '4' && x.name === '動漫'));
  assert.ok(data.years.includes('2025'));
  assert.equal(requests.length, 1);
  assert.match(requests[0].init.headers['User-Agent'], /Mozilla/);
});

test('search uses the path-style suggest endpoint that is not behind the site challenge', async t => {
  const expected = 'https://gimyai.tw/index.php/ajax/suggest/mid/1/limit/30/wd/' + encodeURIComponent('鬼滅');
  const requests = mockUpstream(t, { [expected]: () => fixture('suggest.json').then(body => new Response(body, { headers: { 'Content-Type': 'application/json' } })) });
  const data = await (await call('/api/search?q=' + encodeURIComponent(' 鬼滅 '))).json();
  assert.equal(data.items.length, 3);
  assert.equal(data.items[1].title, '鬼滅之刃 劇場版 無限城篇第一章 猗窩座再來');
  assert.equal(requests.length, 1);
  assert.ok(!requests[0].url.includes('wd=') && !requests[0].url.includes('/find/'));
});

test('search keywords cannot inject extra path segments', async t => {
  const expected = 'https://gimyai.tw/index.php/ajax/suggest/mid/1/limit/30/wd/' + encodeURIComponent('a/b?c');
  const requests = mockUpstream(t, { [expected]: () => Response.json({ code: 1, list: [] }) });
  const data = await (await call('/api/search?q=' + encodeURIComponent('a/b?c'))).json();
  assert.deepEqual(data.items, []);
  assert.equal(requests[0].url, expected);
});

test('detail lists playable HLS routes first, with the site comments', async t => {
  mockUpstream(t, { 'https://gimyai.tw/detail/900929.html': await fixture('detail.html'), 'https://gimyai.tw/static/js/playerconfig.js': await fixture('playerconfig.js') });
  const response = await call('/api/detail?id=900929');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.title, '無可替代');
  assert.deepEqual(data.routes.map(r => [r.sid, r.direct]), [[10, true], [4, true], [8, false], [3, false], [12, false]]);
  assert.equal(data.comments[0].author, '阿夕');
});

test('detail still works when the player configuration is unavailable', async t => {
  mockUpstream(t, { 'https://gimyai.tw/detail/900929.html': await fixture('detail.html'), 'https://gimyai.tw/static/js/playerconfig.js': () => new Response('nope', { status: 500 }) });
  const data = await (await call('/api/detail?id=900929')).json();
  assert.equal(data.routes.length, 5);
  assert.ok(data.routes.every(r => r.direct === null));
});

test('resolve returns the direct HLS address and neighbouring episodes', async t => {
  mockUpstream(t, { 'https://gimyai.tw/play/900929-10-1.html': await fixture('play.html') });
  const response = await call('/api/resolve?id=900929&sid=10&nid=1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.deepEqual(data, { id: '900929', sid: 10, nid: 1, title: '無可替代', type: 'hls', media: 'https://jimaoys94.com/public/playback/a6cdda60124d5f0a423b11a3f3d0c0d0/smart.m3u8', next: { sid: 10, nid: 2 }, previous: null, source: 'https://gimyai.tw/play/900929-10-1.html' });
});

test('routes that need the site parser are reported so the viewer can switch route', async t => {
  const html = '<script>var player_aaaa={"flag":"play","encrypt":0,"link_next":"","link_pre":"","vod_data":{"vod_name":"A"},"url":"qsvip-PXESfFzOHc0","from":"qsvip","id":"900929","sid":8,"nid":1};var player_data=player_aaaa;</script>';
  mockUpstream(t, { 'https://gimyai.tw/play/900929-8-1.html': html });
  const response = await call('/api/resolve?id=900929&sid=8&nid=1');
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /線路/);
});

test('resolve rejects a play page describing a different episode', async t => {
  const html = (await fixture('play.html')).replace('"nid":1', '"nid":7');
  mockUpstream(t, { 'https://gimyai.tw/play/900929-10-1.html': html });
  assert.equal((await call('/api/resolve?id=900929&sid=10&nid=1')).status, 502);
});

test('source-site challenges, redirects and outages become clear errors', async t => {
  mockUpstream(t, {
    'https://gimyai.tw/detail/1.html': () => new Response('<title>Just a moment...</title>', { status: 403 }),
    'https://gimyai.tw/detail/2.html': () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } }),
    'https://gimyai.tw/detail/3.html': () => { throw new TypeError('network'); },
  });
  const challenged = await call('/api/detail?id=1');
  assert.equal(challenged.status, 502);
  assert.match((await challenged.json()).error, /403/);
  assert.equal((await call('/api/detail?id=2')).status, 502);
  assert.equal((await call('/api/detail?id=3')).status, 504);
});

test('repeated detail requests are served from the short-lived cache', async t => {
  const requests = mockUpstream(t, { 'https://gimyai.tw/detail/900929.html': await fixture('detail.html'), 'https://gimyai.tw/static/js/playerconfig.js': await fixture('playerconfig.js') });
  await call('/api/detail?id=900929');
  await call('/api/detail?id=900929');
  assert.equal(requests.filter(r => r.url.includes('/detail/')).length, 1);
  assert.equal(requests.filter(r => r.url.includes('playerconfig')).length, 1);
});
