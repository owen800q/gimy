import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exploreUrl, parseListing, parseDetail, parsePlayerConfig, parsePlayer, parseSuggest, mediaUrl, classifyRoutes } from '../src/adapter.js';

const fixture = name => readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8');

test('explore URLs follow the site twelve-field layout and omit page 1', () => {
  assert.equal(exploreUrl({ type: '4', area: '日本', sort: 'hits', page: 2, year: '2025' }), 'https://gimyai.tw/explore/4-%E6%97%A5%E6%9C%AC-hits------2---2025.html');
  assert.equal(exploreUrl({ type: '2' }), 'https://gimyai.tw/explore/2-----------.html');
  assert.equal(exploreUrl({ type: '13', page: 1, sort: 'time' }), 'https://gimyai.tw/explore/13--time---------.html');
  for (const bad of [{ type: '999' }, { type: '4', sort: 'evil' }, { type: '4', year: '20x5' }, { type: '4', area: 'a-b' }, { type: '4', area: '../x' }, { type: '4', page: 0 }, { type: '4', page: 1.5 }, { type: '4', page: 501 }]) assert.throws(() => exploreUrl(bad), /目錄篩選條件無效/, JSON.stringify(bad));
});

test('listing pages yield poster cards and the next page number', async () => {
  const { items, nextPage, heading } = parseListing(await fixture('explore.html'));
  assert.equal(heading, '動漫線上看 · 日本 2025');
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: '325361', title: '更衣人偶墜入愛河第二季', pic: 'https://img.1777cdn.com/upload/vod/20250706-1/fd4fbd3e1535ef475f526cf6d5d37a53.jpg', status: '已完結', cast: '直田姬奈,石毛翔彌,種崎敦美,羊宮妃那,斧篤,村瀨步,武田羅梨沙多胡,雨宮夕夏,關根明良,內田修一,小松昌平' });
  assert.equal(items[1].status, '更新至第12集');
  assert.equal(nextPage, 3);
  assert.equal(parseListing('<main><div class="grid"></div></main>').nextPage, null);
});

test('listing ignores posters with foreign hosts or non-numeric detail links', () => {
  const html = '<a class="poster" href="https://evil.test/detail/1.html"><img src="https://img.1777cdn.com/a.jpg"><h3 class="poster__title">X</h3></a>'
    + '<a class="poster" href="/detail/abc.html"><h3 class="poster__title">Y</h3></a>'
    + '<a class="poster" href="/detail/42.html"><img src="javascript:alert(1)"><h3 class="poster__title">&lt;b&gt;Z</h3></a>';
  const { items } = parseListing(html);
  assert.deepEqual(items.map(x => x.id), ['42']);
  assert.equal(items[0].title, '<b>Z');
  assert.equal(items[0].pic, null);
});

test('detail pages yield metadata, routes with episodes, summary and site comments', async () => {
  const detail = parseDetail(await fixture('detail.html'), '900929');
  assert.equal(detail.id, '900929');
  assert.equal(detail.title, '無可替代');
  assert.equal(detail.pic, 'https://imgs.1777cdn.com/upload/vod/20260928-1/cec7629049d63d71ad920ac24e64182c.jpg');
  assert.equal(detail.status, '更新至第10集');
  assert.equal(detail.category, '陸劇');
  assert.equal(detail.year, '2026');
  assert.equal(detail.area, '中國大陸');
  assert.equal(detail.language, '漢語普通話');
  assert.ok(detail.actors.startsWith('魏大勳、李子峰'));
  assert.equal(detail.director, '陳銘章、陳世嶧');
  assert.match(detail.summary, /徐遲/);
  assert.deepEqual(detail.routes.map(r => [r.sid, r.name, r.episodes.length]), [[10, '清晰雲', 10], [8, '藍光線路 ᴴᴰ', 9], [3, '高清線路Y ᴴᴰ', 10], [12, '4K線路 ᴴᴰ', 9], [4, '電光雲', 10]]);
  assert.deepEqual(detail.routes[0].episodes[0], { nid: 1, label: '第 1 集' });
  assert.deepEqual(detail.routes[4].episodes[9], { nid: 10, label: '第10集' });
  assert.equal(detail.comments.length, 2);
  assert.deepEqual(detail.comments[0], { author: '阿夕', time: '昨天22:26', text: '好好看！劇情節奏好快，畫面很舒服，葉信之恰到好處的指點，特別喜歡，好希望職場中能遇到葉信之這樣的～每一集都好精彩啊' });
});

test('detail parsing only accepts episode links for the requested title', () => {
  const html = '<h1 class="detail__title">T</h1><div class="route-title">清晰雲</div><div class="eps" data-route-sid="10"><a class="ep" href="/play/1-10-1.html">1</a><a class="ep" href="/play/2-10-2.html">bad</a><a class="ep" href="https://evil.test/play/1-10-3.html">bad</a></div>';
  const detail = parseDetail(html, '1');
  assert.deepEqual(detail.routes, [{ sid: 10, name: '清晰雲', episodes: [{ nid: 1, label: '1' }] }]);
  assert.throws(() => parseDetail('<html>Just a moment...</html>', '1'), /找不到/);
});

test('player config maps route names to flags; HLS routes are marked directly playable', async () => {
  const flags = parsePlayerConfig(await fixture('playerconfig.js'));
  assert.deepEqual(flags.get('清晰雲'), ['jlm3u8', 'mzm3u8']);
  assert.deepEqual(flags.get('藍光線路 ᴴᴰ').sort(), ['JK2', 'qsvip']);
  const detail = { routes: [{ sid: 8, name: '藍光線路 ᴴᴰ', episodes: [] }, { sid: 10, name: '清晰雲', episodes: [] }, { sid: 99, name: '神秘線', episodes: [] }, { sid: 4, name: '電光雲', episodes: [] }, { sid: 5, name: '優質雲', episodes: [] }] };
  const routes = classifyRoutes(detail.routes, flags);
  assert.deepEqual(routes.map(r => [r.sid, r.direct]), [[10, true], [4, true], [5, true], [99, null], [8, false]]);
});

test('play pages yield the media URL and neighbouring episodes in the same route', async () => {
  const play = parsePlayer(await fixture('play.html'));
  assert.deepEqual(play, { id: '900929', sid: 10, nid: 1, from: 'jlm3u8', url: 'https://jimaoys94.com/public/playback/a6cdda60124d5f0a423b11a3f3d0c0d0/smart.m3u8', title: '無可替代', next: { sid: 10, nid: 2 }, previous: null });
  assert.throws(() => parsePlayer('<script>var x=1</script>'), /播放資料/);
  assert.throws(() => parsePlayer('<script>var player_aaaa={"url":"x","encrypt":0;var player_data=player_aaaa;</script>'), /播放資料/);
});

test('encrypted player URLs are decoded like the site player', () => {
  const url = 'https://a.test/v/index.m3u8';
  const html1 = '<script>var player_aaaa=' + JSON.stringify({ encrypt: 1, url: escape(url), id: '1', sid: 2, nid: 3, from: 'xm3u8', link_next: '', link_pre: '', vod_data: { vod_name: 'A' } }) + ';var player_data=player_aaaa;</script>';
  assert.equal(parsePlayer(html1).url, url);
  const html2 = '<script>var player_aaaa=' + JSON.stringify({ encrypt: 2, url: Buffer.from(escape(url)).toString('base64'), id: '1', sid: 2, nid: 3, from: 'xm3u8', link_next: '/play/1-2-4.html', link_pre: '/play/1-2-2.html', vod_data: { vod_name: 'A' } }) + ';var player_data=player_aaaa;</script>';
  const parsed = parsePlayer(html2);
  assert.equal(parsed.url, url);
  assert.deepEqual([parsed.previous, parsed.next], [{ sid: 2, nid: 2 }, { sid: 2, nid: 4 }]);
});

test('only plain HTTPS HLS or MP4 media URLs are accepted', () => {
  assert.equal(mediaUrl('https://vip.dytt-tvs.com/20260928/38913_67cba9ae/index.m3u8'), 'https://vip.dytt-tvs.com/20260928/38913_67cba9ae/index.m3u8');
  assert.equal(mediaUrl('https://cdn.test/a/b.mp4?sign=1'), 'https://cdn.test/a/b.mp4?sign=1');
  for (const bad of ['http://cdn.test/a.m3u8', 'https://v.youku.com/v_show/id_X.html', 'qsvip-PXESfFzOHc0', 'JD-d8d0bd2b', 'https://user:pw@cdn.test/a.m3u8', 'https://cdn.test:8443/a.m3u8', 'https://localhost/a.m3u8', 'https://127.0.0.1/a.m3u8', 'https://10.0.0.1/a.m3u8', 'javascript:alert(1)//.m3u8']) assert.throws(() => mediaUrl(bad), bad);
});

test('suggest results become search cards', async () => {
  const items = parseSuggest(JSON.parse(await fixture('suggest.json')));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: '237333', title: '鬼滅之刃鍛刀村篇', pic: 'https://img.1777cdn.com/upload/vod/20230312-1/49ef347f63dfbd58183813a09efa2cf0.jpg', status: '', cast: '' });
  assert.deepEqual(parseSuggest({ code: 1, list: [{ id: 'x', name: 'bad' }, { id: 5, name: '' }] }), []);
  assert.throws(() => parseSuggest('<html>'), /搜尋/);
});

test('detail pages with a separate route-chip bar are parsed too', () => {
  const html = `<h1 class="detail__title">仙逆</h1>
    <div class="sources route-chips">
      <span class="source is-active" data-route-switch="2" data-line-name>電光雲</span>
      <span class="source" data-route-switch="9" data-line-name>藍光線路 ᴴᴰ</span>
      <span class="source" data-route-switch="3" data-line-name>高清線路Q ᴴᴰ </span>
    </div>
    <div class="block"><div class="block__head"><h2 class="block__title">選集播放</h2></div>
      <div class="eps episodes-route active" data-route-sid="2"><a class="ep" href="/play/245516-2-1.html">第01集</a><a class="ep" href="/play/245516-2-2.html">第02集</a></div>
      <div class="eps episodes-route" data-route-sid="9"><a class="ep" href="/play/245516-9-1.html">01</a></div>
      <div class="eps episodes-route" data-route-sid="3"><a class="ep" href="/play/245516-3-1.html">1</a></div>
      <div class="eps episodes-route" data-route-sid="7"><a class="ep" href="/play/245516-7-1.html">1</a></div>
    </div>`;
  const detail = parseDetail(html, '245516');
  assert.deepEqual(detail.routes.map(r => [r.sid, r.name, r.episodes.length]), [[2, '電光雲', 2], [9, '藍光線路 ᴴᴰ', 1], [3, '高清線路Q ᴴᴰ', 1], [7, '線路 7', 1]]);
});
