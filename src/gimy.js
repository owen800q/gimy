import { PlaybackError, SITE, TYPES, upstream, checkStatus, boundedText, exploreUrl, parseListing, parseDetail, parsePlayerConfig, classifyRoutes, parsePlayer, parseSuggest, mediaUrl } from './adapter.js';

// Short-lived memory cache plus single-flight requests, so a TV grid does not fan out upstream.
const memory = new Map();
const pending = new Map();
export function clearCaches() { memory.clear(); pending.clear(); }
async function cached(key, ttl, load) {
  const known = memory.get(key);
  if (known && known.expires > Date.now()) return known.data;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 32) throw new PlaybackError('服務暫時繁忙，請稍後重試。', 429);
  const promise = load().then(data => {
    while (memory.size >= 200) memory.delete(memory.keys().next().value);
    memory.set(key, { data, expires: Date.now() + ttl * 1000 });
    return data;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
async function page(url, stage) {
  const response = await upstream(url);
  checkStatus(response, stage);
  return boundedText(response);
}

function years() {
  const now = new Date().getFullYear();
  return Array.from({ length: now - 1989 }, (_, i) => String(now - i));
}
export async function browse(params) {
  const filters = { type: params.get('type') || '2', area: params.get('area') || '', sort: params.get('sort') || '', year: params.get('year') || '', page: Number(params.get('page') || 1) };
  const url = exploreUrl(filters);
  const data = await cached('explore:' + url, 300, async () => parseListing(await page(url, '讀取影片目錄')));
  return { ...data, page: filters.page, types: TYPES, years: years() };
}

export async function search(query) {
  const q = String(query || '').trim();
  if (!q || q.length > 80) throw new PlaybackError('請輸入 1 至 80 字的影片名稱。', 400);
  // /find/ pages and any `wd=` query string are behind the site's browser challenge; the path-style suggest route is not.
  const url = SITE + '/index.php/ajax/suggest/mid/1/limit/30/wd/' + encodeURIComponent(q);
  const items = await cached('search:' + q, 300, async () => {
    let data;
    try { data = JSON.parse(await page(url, '搜尋影片')); } catch (error) { if (error instanceof PlaybackError) throw error; throw new PlaybackError('搜尋服務回傳了無法讀取的資料。'); }
    return parseSuggest(data);
  });
  return { items };
}

async function playerFlags() {
  try { return await cached('playerconfig', 3600, async () => parsePlayerConfig(await page(SITE + '/static/js/playerconfig.js', '讀取播放器設定'))); }
  catch { return null; }
}
export async function detail(id) {
  if (!/^\d{1,10}$/.test(id || '')) throw new PlaybackError('影片編號無效。', 400);
  return cached('detail:' + id, 300, async () => {
    const [html, flags] = await Promise.all([page(SITE + '/detail/' + id + '.html', '讀取影片資料'), playerFlags()]);
    const data = parseDetail(html, id);
    return { ...data, routes: classifyRoutes(data.routes, flags) };
  });
}

const smallInt = value => /^\d{1,5}$/.test(value || '') ? Number(value) : null;
export async function resolve(id, sidInput, nidInput) {
  const sid = smallInt(sidInput), nid = smallInt(nidInput);
  if (!/^\d{1,10}$/.test(id || '') || sid == null || nid == null) throw new PlaybackError('影片、線路或集數編號無效。', 400);
  const source = SITE + '/play/' + id + '-' + sid + '-' + nid + '.html';
  const play = await cached('play:' + source, 120, async () => parsePlayer(await page(source, '讀取播放頁面')));
  if (play.id !== id || play.sid !== sid || play.nid !== nid) throw new PlaybackError('原站回傳的集數與所選不符，請重新載入。');
  let media;
  try { media = mediaUrl(play.url); } catch { throw new PlaybackError('此線路需要原站的解析器，暫不支援。請改選其他線路。', 422); }
  return { id, sid, nid, title: play.title, type: /\.mp4$/i.test(new URL(media).pathname) ? 'mp4' : 'hls', media, next: play.next, previous: play.previous, source };
}
