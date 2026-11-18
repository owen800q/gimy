// gimytv.io exposes episode slugs and watch pages instead of numeric route/episode pairs.
import { PlaybackError, plainText, mediaUrl } from './adapter.js';

export const GIMY_TV_SITE = 'https://gimytv.io';
export const gimyTvId = id => /^io\d{1,10}$/.test(id || '');

const detailPath = /^\/voddetail2\/(\d{1,10})\.html$/;
const episodePath = /^\/eps\/(\d{1,10})-([a-z0-9-]{1,100})\.html$/;
export function gimyTvLink(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.origin !== GIMY_TV_SITE || url.username || url.password) return null;
  const episode = url.pathname.match(episodePath);
  const match = episode || url.pathname.match(detailPath);
  return match ? { id: 'io' + match[1], episode: episode ? url.pathname : null } : null;
}

// A stable numeric key keeps saved progress attached to the slug as new episodes arrive.
function slugKey(slug) {
  let hash = 2166136261;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function gimyTvDetail(html, id) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
  const title = plainText(cleaned.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '', 200);
  if (!title) throw new PlaybackError('找不到這部影片的資料。');
  const info = label => plainText(cleaned.match(new RegExp('<li\\b[^>]*>\\s*<span\\b[^>]*>' + label + '：([\\s\\S]*?)</li>', 'i'))?.[1] || '', 300);
  const rawId = id.slice(2);
  const episodes = new Map();
  for (const match of cleaned.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const link = match[1].match(episodePath);
    if (!link || link[1] !== rawId) continue;
    const nid = slugKey(link[2]);
    const previous = episodes.get(nid);
    if (previous && previous.path !== match[1]) throw new PlaybackError('原站集數編號重複。');
    if (!previous) episodes.set(nid, { nid, label: plainText(match[2], 40) || link[2], path: match[1] });
  }
  const source = GIMY_TV_SITE + '/voddetail2/' + rawId + '.html';
  const rawSummary = cleaned.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)/i)?.[1] || '';
  return {
    id, title, source, pic: GIMY_TV_SITE + '/poster/' + rawId + '.jpg',
    status: info('狀態'), category: info('類別'), year: info('年代').match(/\d{4}/)?.[0] || '',
    area: info('國家/地區'), language: info('語言/字幕'), actors: info('主演'), director: info('導演'),
    summary: plainText(rawSummary.replace(/^[^|]*\|\s*/, ''), 2000),
    episodes: [...episodes.values()],
  };
}

export function gimyTvWatchPaths(html) {
  const paths = new Set();
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of cleaned.matchAll(/<(?:a|iframe)\b[^>]*\s(?:href|src)=["'](\/_watch\/\d{1,12})["']/gi)) paths.add(match[1]);
  return [...paths].slice(0, 8);
}

export function gimyTvMedia(html) {
  const url = html.match(/^\s*(?:var|let|const)\s+url\s*=\s*(["'])(https:\/\/[^"'\s]+)\1\s*;/m)?.[2];
  return mediaUrl(url);
}
