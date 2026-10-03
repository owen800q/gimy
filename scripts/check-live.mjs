// Live smoke check against gimyai.tw: catalogue, search, detail, resolve and the HLS playlist.
// Network-dependent, so it is not part of `npm test`. Usage: node scripts/check-live.mjs [query]
import worker from '../src/worker.js';

const env = { ASSETS: { fetch: async () => new Response('') } };
const call = async path => {
  const response = await worker.fetch(new Request('https://gimy-tv.local' + path), env);
  const data = await response.json();
  if (!response.ok) throw new Error(path + ' → ' + response.status + ' ' + data.error);
  return data;
};
const query = process.argv[2] || '鬼滅之刃';

const catalog = await call('/api/catalog?type=4&sort=hits_week');
console.log('catalog:', catalog.heading, catalog.items.length, 'items, next page', catalog.nextPage);
if (!catalog.items.length) throw new Error('catalogue is empty');

const found = await call('/api/search?q=' + encodeURIComponent(query));
console.log('search:', query, '→', found.items.slice(0, 3).map(x => x.title).join(' / '));
if (!found.items.length) throw new Error('search returned nothing');

const show = await call('/api/detail?id=' + catalog.items[0].id);
console.log('detail:', show.title, show.status, show.routes.map(r => r.name + (r.direct ? '✓' : r.direct === false ? '✗' : '?')).join(' '));
let played = null;
for (const route of show.routes.filter(r => r.direct !== false)) {
  try {
    played = await call(`/api/resolve?id=${show.id}&sid=${route.sid}&nid=${route.episodes[0].nid}`);
    break;
  } catch (error) { console.log('  route', route.name, 'failed:', error.message); }
}
if (!played) throw new Error('no playable route');
console.log('resolve:', played.title, played.type, played.media);
const playlist = await fetch(played.media, { headers: { Origin: 'https://gimy-tv.local' } });
const text = await playlist.text();
console.log('playlist:', playlist.status, playlist.headers.get('access-control-allow-origin'), text.split('\n')[0]);
if (!playlist.ok || !text.startsWith('#EXTM3U')) throw new Error('playlist is not HLS');
console.log('OK');
