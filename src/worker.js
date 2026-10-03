import { errorResponse, PlaybackError } from './adapter.js';
import { browse, search, detail, resolve } from './gimy.js';
import { historyRoute } from './sync-server.js';

const noStore = { headers: { 'Cache-Control': 'no-store' } };

// API routes (history, catalogue, playback) run before static assets.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new PlaybackError('請從播放器網頁開啟。', 403);
      if (url.pathname === '/api/history') return await historyRoute(request, env);
      if (request.method === 'GET') {
        const q = url.searchParams;
        if (url.pathname === '/api/health') return Response.json({ service: 'gimy-tv', authentication: 'none', version: 'catalog-1' }, noStore);
        if (url.pathname === '/api/catalog') return Response.json(await browse(q), noStore);
        if (url.pathname === '/api/search') return Response.json(await search(q.get('q')), noStore);
        if (url.pathname === '/api/detail') return Response.json(await detail(q.get('id')), noStore);
        if (url.pathname === '/api/resolve') return Response.json(await resolve(q.get('id'), q.get('sid'), q.get('nid')), noStore);
      }
      return Response.json({ error: '找不到此功能或不支援此請求方式。' }, { status: 404 });
    } catch (error) { return errorResponse(error); }
  },
};
export { WatchHistory } from './sync-server.js';
