// Public-page adapter for gimyai.tw. No upstream scripts execute; pages are parsed as text.
// The browser plays the source's public HLS address directly, so no media is proxied here.
export class PlaybackError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export const SITE = 'https://gimyai.tw';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 GimyTV/1.0';
const decoder = new TextDecoder();

export const TYPES = [
  { id: '2', name: '電視劇' }, { id: '1', name: '電影' }, { id: '4', name: '動漫' }, { id: '29', name: '綜藝' },
  { id: '13', name: '陸劇' }, { id: '20', name: '韓劇' }, { id: '15', name: '日劇' }, { id: '14', name: '台劇' },
  { id: '21', name: '港劇' }, { id: '16', name: '美劇' }, { id: '31', name: '海外劇' }, { id: '34', name: '短劇' },
  { id: '22', name: '紀錄片' }, { id: '24', name: '動畫電影' }, { id: '38', name: 'AI漫劇' },
  { id: '6', name: '動作片' }, { id: '7', name: '喜劇片' }, { id: '8', name: '愛情片' }, { id: '9', name: '科幻片' },
  { id: '10', name: '恐怖片' }, { id: '11', name: '劇情片' }, { id: '12', name: '戰爭片' },
];
export const SORTS = ['', 'time', 'time_add', 'hits_week', 'hits'];

export function plainText(html, max = 350) {
  const names = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(html).replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity[0] !== '#') return names[entity.toLowerCase()] ?? all;
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/\s+/g, ' ').trim().slice(0, max);
}
const attr = (tag, name) => tag.match(new RegExp('\\b' + name + '=["\']([^"\']*)["\']', 'i'))?.[1];
const firstText = (html, cls, max) => { const m = html.match(new RegExp('<([a-z0-9]+)\\b[^>]*class=["\'][^"\']*\\b' + cls + '\\b[^"\']*["\'][^>]*>([\\s\\S]*?)</\\1>', 'i')); return m ? plainText(m[2], max) : ''; };

function publicHost(u) {
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && u.hostname.includes('.') && !/^[\d.]+$/.test(u.hostname) && !u.hostname.startsWith('[');
}
export function imageUrl(input) {
  try { const u = new URL(plainText(input || '', 1000)); return publicHost(u) && !u.hash ? u.href : null; } catch { return null; }
}
export function mediaUrl(input) {
  let u;
  try { u = new URL(String(input)); } catch { throw new PlaybackError('此線路沒有可直接播放的影片網址。', 422); }
  if (!publicHost(u) || u.hash || !/\.(?:m3u8|mp4)$/i.test(u.pathname)) throw new PlaybackError('此線路沒有可直接播放的影片網址。', 422);
  return u.href;
}

export function exploreUrl({ type, area = '', sort = '', page = 1, year = '' } = {}) {
  page = Number(page);
  if (!TYPES.some(t => t.id === String(type)) || !SORTS.includes(sort) || year && !/^\d{4}$/.test(year) || area && (area.length > 20 || !/^[\p{L}\p{N} ]+$/u.test(area)) || !Number.isInteger(page) || page < 1 || page > 500) throw new PlaybackError('目錄篩選條件無效。', 400);
  const fields = [String(type), area ? encodeURIComponent(area) : '', sort, '', '', '', '', '', page > 1 ? String(page) : '', '', '', year];
  return SITE + '/explore/' + fields.join('-') + '.html';
}

function card(id, title, pic, status = '', cast = '') {
  return { id, title, pic: imageUrl(pic), status, cast };
}
const detailId = href => { const m = plainText(href || '', 300).match(/^(?:https:\/\/gimyai\.tw)?\/detail\/(\d{1,10})\.html$/); return m?.[1] || null; };

export function parseListing(html) {
  const items = []; const seen = new Set();
  for (const m of html.matchAll(/<a\b([^>]*\bclass=["']poster["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const id = detailId(attr(m[1], 'href'));
    if (!id || seen.has(id)) continue;
    const img = m[2].match(/<img\b[^>]*>/i)?.[0] || '';
    const title = firstText(m[2], 'poster__title') || plainText(attr(img, 'alt') || '');
    if (!title) continue;
    seen.add(id);
    items.push(card(id, title, attr(img, 'src'), firstText(m[2], 'poster__status', 60), firstText(m[2], 'poster__meta', 300)));
  }
  let nextPage = null;
  const next = html.match(/<a\b[^>]*\brel=["']next["'][^>]*>/i)?.[0];
  const field = next && plainText(attr(next, 'href') || '', 500).match(/^\/explore\/((?:[^-/]*-){11}[^-/]*)\.html$/)?.[1].split('-')[8];
  if (/^\d{1,3}$/.test(field || '')) nextPage = Number(field);
  const heading = plainText(html.match(/<div class=["']page-head["']>\s*<h1>([\s\S]*?)<\/h1>/i)?.[1] || '');
  return { items, nextPage, heading };
}

export function parseDetail(html, id) {
  const title = firstText(html, 'detail__title', 200);
  if (!title) throw new PlaybackError('找不到這部影片的資料，原站可能已下架或要求額外驗證。', 502);
  const posterBlock = html.match(/class=["']detail__poster["'][\s\S]*?<img\b[^>]*>/i)?.[0] || '';
  const meta = {};
  for (const m of html.matchAll(/<span class=["']k["']>([^<]{1,10})：<\/span>([\s\S]*?)<\/div>/gi)) meta[m[1]] = m[2];
  const category = meta['類別'] ? plainText(meta['類別'].match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || meta['類別'].split('·')[0], 40) : '';
  // Two layouts exist: a title above each episode block, or a separate bar of route chips.
  const routes = []; const chips = new Map();
  const routeLabel = label => plainText(label.replace(/<span\b[^>]*class=["']hd["'][^>]*>[\s\S]*?<\/span>/gi, ''), 40);
  for (const m of html.matchAll(/<span\b[^>]*\bdata-route-switch=["'](\d{1,5})["'][^>]*>([\s\S]*?)<\/span>/gi)) chips.set(Number(m[1]), routeLabel(m[2]));
  for (const m of html.matchAll(/(?:<div class=["']route-title["']>([\s\S]*?)<\/div>\s*)?<div class=["']eps\b[^"']*["'][^>]*\bdata-route-sid=["'](\d{1,5})["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const sid = Number(m[2]); const episodes = []; const seen = new Set();
    for (const ep of m[3].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const link = plainText(attr(ep[1], 'href') || '', 300).match(/^\/play\/(\d{1,10})-(\d{1,5})-(\d{1,5})\.html$/);
      if (!link || link[1] !== String(id) || Number(link[2]) !== sid || seen.has(link[3])) continue;
      seen.add(link[3]);
      episodes.push({ nid: Number(link[3]), label: plainText(ep[2], 40) || '第 ' + link[3] + ' 集' });
    }
    if (episodes.length) routes.push({ sid, name: (m[1] && routeLabel(m[1])) || chips.get(sid) || '線路 ' + sid, episodes });
  }
  const comments = [];
  for (const m of html.matchAll(/<article class=["']cmt["'][\s\S]*?<\/article>/gi)) {
    const text = firstText(m[0], 'cmt__text', 1000);
    if (text) comments.push({ author: firstText(m[0], 'cmt__name', 60) || 'Gimy 用戶', time: firstText(m[0], 'cmt__time', 40), text });
    if (comments.length >= 20) break;
  }
  return {
    id: String(id), title, pic: imageUrl(attr(posterBlock.match(/<img\b[^>]*>$/i)?.[0] || '', 'src')),
    status: plainText(meta['狀態'] || '', 60), category, year: plainText(meta['類別'] || '', 80).match(/\b(\d{4})\b/)?.[1] || '',
    area: plainText(meta['地區'] || '', 60), language: plainText(meta['語言'] || '', 60),
    actors: plainText(meta['主演'] || '', 300), director: plainText(meta['導演'] || '', 120),
    summary: plainText(html.match(/<div class=["']desc["']>([\s\S]*?)<\/div>/i)?.[1] || '', 2000),
    routes, comments,
  };
}

const routeName = name => String(name).replace(/\s+/g, ' ').trim();
export function parsePlayerConfig(js) {
  const m = js.match(/MacPlayerConfig\.player_list\s*=\s*(\{[\s\S]*?\})\s*(?:,MacPlayerConfig|;)/);
  if (!m) throw new PlaybackError('原站播放器設定無法解析。');
  let list;
  try { list = JSON.parse(m[1]); } catch { throw new PlaybackError('原站播放器設定無法解析。'); }
  const flags = new Map();
  for (const [flag, value] of Object.entries(list)) {
    const name = routeName(value?.show || '');
    if (!name) continue;
    if (!flags.has(name)) flags.set(name, []);
    flags.get(name).push(flag.trim());
  }
  return flags;
}
// HLS routes ("…m3u8" flags) and resource-library routes ("…zyk") play directly; the others need the source site's external parser.
export function classifyRoutes(routes, flags) {
  const rank = { true: 0, null: 1, false: 2 };
  return routes.map(route => {
    const list = flags?.get(routeName(route.name));
    return { ...route, direct: list ? list.every(flag => /(?:m3u8|zyk)$/i.test(flag)) : null };
  }).map((route, index) => ({ route, index })).sort((a, b) => rank[a.route.direct] - rank[b.route.direct] || a.index - b.index).map(x => x.route);
}

function playLink(link, id) {
  const m = String(link || '').match(/^\/play\/(\d{1,10})-(\d{1,5})-(\d{1,5})\.html$/);
  return m && m[1] === String(id) ? { sid: Number(m[2]), nid: Number(m[3]) } : null;
}
export function parsePlayer(html) {
  const m = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;\s*var\s+player_data\b/);
  let data;
  try { data = JSON.parse(m[1]); } catch { throw new PlaybackError('原站播放資料無法解析。'); }
  if (!data || typeof data.url !== 'string' || !/^\d{1,10}$/.test(String(data.id)) || !Number.isInteger(Number(data.sid)) || !Number.isInteger(Number(data.nid))) throw new PlaybackError('原站播放資料不完整。');
  let url = data.url;
  // Matches the site's player: 1 = escape(), 2 = base64(escape()).
  try {
    if (Number(data.encrypt) === 1) url = unescape(url);
    else if (Number(data.encrypt) === 2) url = unescape(atob(url));
  } catch { throw new PlaybackError('原站播放資料無法解析。'); }
  const id = String(data.id);
  return { id, sid: Number(data.sid), nid: Number(data.nid), from: String(data.from || ''), url, title: plainText(data.vod_data?.vod_name || '', 200), next: playLink(data.link_next, id), previous: playLink(data.link_pre, id) };
}

export function parseSuggest(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.list)) throw new PlaybackError('搜尋服務回傳了無法讀取的資料。');
  return data.list.filter(x => Number.isSafeInteger(x?.id) && x.id > 0 && typeof x.name === 'string' && x.name.trim()).slice(0, 40).map(x => card(String(x.id), plainText(x.name, 200), x.pic));
}

export async function upstream(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9', Referer: SITE + '/', ...init.headers } });
  } catch {
    throw new PlaybackError('原站連線逾時或暫時無法連接，請稍後重試。', 504);
  } finally { clearTimeout(timer); }
}
export function checkStatus(r, stage) {
  if (!r.ok) {
    void r.body?.cancel();
    throw new PlaybackError(`${stage}失敗（原站 ${r.status}）。${r.status === 403 ? '原站拒絕此部署的連線，並非電視設定問題。' : '請稍後重試。'}`);
  }
}
export async function boundedText(r, max = 2000000) {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) { void reader.cancel().catch(() => {}); throw new PlaybackError('原站回應過大，無法處理。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; }
  return decoder.decode(bytes);
}
export function errorResponse(error) {
  return Response.json({ error: error instanceof PlaybackError ? error.message : '服務暫時無法處理，請稍後重試。' }, { status: error instanceof PlaybackError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
