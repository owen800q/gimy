// Gimy TV for Samsung TV (Tizen 4.0+ / Chromium 56+): remote-driven UI over the Worker's /api/*.
// Served by the Worker at /tv/ and packaged as a Tizen widget (scripts/package-tv.mjs).
// Classic script, no build step: avoid syntax newer than Chromium 56 (no `?.`, `??`, object
// spread/rest, trailing commas in calls) and APIs such as AbortController, Promise#finally,
// String#padStart, URLSearchParams(object) and Element#replaceChildren.
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const PACKAGED = !/^https?:$/.test(location.protocol);
  const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } };
  // Same-origin under /tv/; the packaged app calls the Worker set at package time or in 裝置同步.
  const apiBase = () => PACKAGED ? String(read('gimy-api', '') || window.GIMY_API || '').replace(/\/+$/, '') : '';
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const time = value => { const s = Math.max(0, Math.floor(value || 0)); const hr = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (hr ? hr + ':' + pad2(m) : m) + ':' + pad2(s % 60); };
  const query = params => Object.keys(params).filter(k => params[k] !== '' && params[k] != null).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), x => (x < 16 ? '0' : '') + x.toString(16)).join('');
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('連線逾時，請檢查網絡後重試。')), ms);
      promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
  }
  async function api(path, options) {
    const base = apiBase();
    if (PACKAGED && !base) { const e = new Error('尚未設定伺服器位址，請到「裝置同步」輸入 Gimy TV 的網址。'); e.status = 0; throw e; }
    let r;
    try { r = await withTimeout(fetch(base + path, options), 20000); } catch (e) { throw new Error(e.message && /逾時/.test(e.message) ? e.message : '未能連線到伺服器，請檢查網絡。'); }
    // A wrong or undeployed server answers with an HTML error page rather than the API's JSON.
    if ((r.headers.get('content-type') || '').indexOf('application/json') < 0) { const e = new Error('伺服器未能提供資料（HTTP ' + r.status + (base ? '，' + base : '') + '）。' + (PACKAGED ? '請確認 Worker 已部署，或到「裝置同步」更改伺服器位址。' : '')); e.status = r.status; throw e; }
    const data = await r.json();
    if (!r.ok) { const e = new Error(data.error || '讀取失敗。'); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  function h(tag, props, kids) {
    const el = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids == null ? [] : kids).forEach(c => { if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  const clear = el => { el.textContent = ''; return el; };
  const button = (cls, kids, onclick, props) => h('button', Object.assign({ type: 'button', tabindex: '-1', class: cls + ' focusable', onclick }, props), kids);

  /* ---------- icons (24×24 strokes) ---------- */
  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
    prev: '<path d="M6 5v14"/><path d="M19 5L9 12l10 7z" fill="currentColor"/>',
    next: '<path d="M18 5v14"/><path d="M5 5l10 7-10 7z" fill="currentColor"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
    reload: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.6"/><path d="M20 3v5.6h-5.6"/>',
  };
  const icon = name => { const el = h('i', { class: 'icon', 'aria-hidden': 'true' }); el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>'; return el; };

  /* ---------- Samsung remote ---------- */
  // Arrows, OK and Back always arrive; media and colour keys must be registered first.
  const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESCAPE: 27, BACKSPACE: 8, PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, FAST_FORWARD: 417, REWIND: 412, NEXT: 10233, PREVIOUS: 10232, CHANNEL_UP: 427, CHANNEL_DOWN: 428, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, INFO: 457, IME_DONE: 65376, IME_CANCEL: 65385 };
  const REMOTE_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info'];
  function registerKeys() {
    const input = window.tizen && window.tizen.tvinputdevice;
    if (!input) return;
    const oneByOne = () => REMOTE_KEYS.forEach(name => { try { input.registerKey(name); } catch (e) { /* unsupported on this model */ } });
    try {
      // registerKeyBatch rejects the whole batch when one name is unknown, so keep only supported keys.
      const supported = input.getSupportedKeys().map(k => k.name);
      const wanted = REMOTE_KEYS.filter(name => supported.indexOf(name) >= 0);
      if (!wanted.length) oneByOne(); else if (input.registerKeyBatch) input.registerKeyBatch(wanted); else wanted.forEach(name => input.registerKey(name));
    } catch (e) { oneByOne(); }
  }
  const isTyping = e => { const t = e && e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.readOnly; };
  // Desktop stand-ins: Esc = Back, Space = play/pause, PageUp/PageDown = previous/next episode.
  function actionOf(e) {
    switch (e.keyCode) {
      case KEY.LEFT: return 'left'; case KEY.RIGHT: return 'right'; case KEY.UP: return 'up'; case KEY.DOWN: return 'down';
      case KEY.ENTER: return 'enter'; case KEY.BACK: case KEY.ESCAPE: return 'back';
      case KEY.BACKSPACE: return isTyping(e) ? null : 'back';
      case KEY.PLAY_PAUSE: return 'playpause'; case KEY.PLAY: return 'play'; case KEY.PAUSE: return 'pause'; case KEY.STOP: return 'stop';
      case KEY.FAST_FORWARD: return 'forward'; case KEY.REWIND: return 'rewind';
      case KEY.NEXT: case KEY.CHANNEL_UP: return 'next'; case KEY.PREVIOUS: case KEY.CHANNEL_DOWN: return 'previous';
      case KEY.RED: return 'red'; case KEY.GREEN: return 'green'; case KEY.YELLOW: return 'yellow'; case KEY.BLUE: return 'blue';
      case KEY.INFO: return 'info'; case KEY.IME_DONE: return 'imedone'; case KEY.IME_CANCEL: return 'imecancel';
    }
    if (isTyping(e)) return null;
    if (e.keyCode === 32) return 'playpause';
    if (e.keyCode === 33) return 'previous';
    if (e.keyCode === 34) return 'next';
    return null;
  }
  const exitApp = () => { try { window.tizen.application.getCurrentApplication().exit(); return; } catch (e) { /* not on a TV */ } try { window.close(); } catch (e) { /* ignore */ } };
  function screenSaver(on) {
    try { const a = window.webapis.appcommon; a.setScreenSaver(on ? a.AppCommonScreenSaverState.SCREEN_SAVER_ON : a.AppCommonScreenSaverState.SCREEN_SAVER_OFF); } catch (e) { /* not on a TV */ }
  }

  /* ---------- spatial focus ---------- */
  // Focusable elements carry `.focusable`. Arrows move to the nearest one in that direction inside
  // the top-most `[data-focus-scope]` (dialog, player panel) or the visible page; covered screens
  // keep their layout but are skipped. `[data-scroll]` containers scroll to keep focus in view.
  const Focus = (function () {
    const scope = () => { const all = Array.prototype.filter.call(document.querySelectorAll('[data-focus-scope]'), el => !el.closest('[hidden],.is-covered')); return all.length ? all[all.length - 1] : document.body; };
    const visible = el => { if (el.closest('.is-covered,[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const candidates = root => Array.prototype.filter.call((root || scope()).querySelectorAll('.focusable:not([disabled])'), visible);
    const current = () => { const el = document.activeElement; return el && el !== document.body && scope().contains(el) && visible(el) ? el : null; };
    function reveal(el) {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const axis = node.getAttribute('data-scroll');
        if (!axis) continue;
        const box = node.getBoundingClientRect(), r = el.getBoundingClientRect(), pad = Number(node.getAttribute('data-scroll-pad')) || 60;
        if (axis === 'y') { if (r.top < box.top + pad) node.scrollTop -= box.top + pad - r.top; else if (r.bottom > box.bottom - pad) node.scrollTop += r.bottom - (box.bottom - pad); }
        else if (r.left < box.left + pad) node.scrollLeft -= box.left + pad - r.left; else if (r.right > box.right - pad) node.scrollLeft += r.right - (box.right - pad);
      }
    }
    function focus(el) { if (!el) return false; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } reveal(el); return true; }
    function first(selector, root) { const r = root || scope(); const el = selector && r.querySelector(selector); return focus(el && visible(el) && !el.disabled ? el : candidates(r)[0]); }
    function best(from, dir, list) {
      const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      let pick = null, score = Infinity;
      list.forEach(el => {
        if (el === from) return;
        const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
        const horizontal = dir === 'left' || dir === 'right';
        if (dir === 'right' ? bx <= ax : dir === 'left' ? bx >= ax : dir === 'down' ? by <= ay : by >= ay) return;
        const gap = Math.max(0, dir === 'right' ? b.left - a.right : dir === 'left' ? a.left - b.right : dir === 'down' ? b.top - a.bottom : a.top - b.bottom);
        const overlap = horizontal ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) : Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const off = horizontal ? Math.abs(by - ay) : Math.abs(bx - ax);
        // Neighbours sharing the row/column beat diagonal ones.
        const s = gap + off * (overlap > 0 ? 0.3 : 2.5) + (overlap > 0 ? 0 : 400);
        if (s < score) { score = s; pick = el; }
      });
      return pick;
    }
    function move(dir) {
      const from = current();
      if (!from) return first();
      const explicit = from.getAttribute('data-nav-' + dir);
      if (explicit === 'none') return false;
      const rail = document.getElementById('sidebar'), inRail = rail.contains(from);
      // Up/Down stay inside the sidebar; entering it lands on the current tab.
      const target = (explicit && scope().querySelector(explicit)) || best(from, dir, inRail && (dir === 'up' || dir === 'down') ? candidates(rail) : candidates());
      if (target && !inRail && rail.contains(target)) return focus(rail.querySelector('.is-current') || target);
      // Entering the content from the sidebar returns to where the user left off.
      if (target && inRail && !rail.contains(target) && Router.restoreContent()) return true;
      return focus(target);
    }
    return { current, focus, first, move, candidates };
  })();

  /* ---------- watch history and device sync ---------- */
  // Local storage is only an offline outbox; the Worker's Durable Object holds the shared history.
  const Store = (function () {
    let token = read('gimy-profile', null);
    if (!/^[a-f0-9]{32}$/.test(token || '')) { token = newToken(); write('gimy-profile', token); }
    let entries = read('gimy-history:' + token, {}), pulling = null, sending = null, status = '正在連接雲端紀錄…';
    const listeners = [];
    const emit = () => listeners.slice().forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    const announce = () => { write('gimy-history:' + token, entries); emit(); };
    const setStatus = text => { status = text; emit(); };
    const auth = profile => ({ Authorization: 'Bearer ' + profile });
    function send() {
      if (sending) return sending;
      const profile = token;
      sending = (async () => {
        try {
          for (;;) {
            const local = Object.values(entries).find(x => x.dirty);
            if (!local || profile !== token) break;
            const stamp = local.localStamp;
            const body = { episodeId: local.episodeId, seriesId: local.seriesId, sid: local.sid, title: local.title, seriesTitle: local.seriesTitle, position: local.position, duration: local.duration, completed: local.completed, revision: local.revision };
            let data;
            try { data = await api('/api/history', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, auth(profile)), body: JSON.stringify(body) }); }
            catch (e) { if (e.status !== 409 || !e.data) throw e; data = e.data; }
            if (profile !== token) return false;
            if (!data.entry) throw new Error('Missing progress');
            const known = entries[local.episodeId];
            if (data.conflict || (known && known.localStamp === stamp)) entries[local.episodeId] = Object.assign({}, data.entry, { dirty: false });
            else if (known) known.revision = data.entry.revision;
            announce();
          }
          setStatus('觀看紀錄已儲存至雲端');
          return true;
        } catch (e) { setStatus(e.status === 0 ? e.message : '暫存於此裝置，連線恢復後再同步'); return false; }
      })();
      sending.then(() => { sending = null; });
      return sending;
    }
    function refresh() {
      if (pulling) return pulling;
      const profile = token;
      pulling = (async () => {
        try {
          const uploaded = await send();
          const data = await api('/api/history', { headers: auth(profile) });
          if (profile !== token) return false;
          (data.entries || []).forEach(remote => { const local = entries[remote.episodeId]; if (!(local && local.dirty) && remote.revision >= ((local && local.revision) || 0)) entries[remote.episodeId] = Object.assign({}, remote, { dirty: false }); });
          announce();
          setStatus(uploaded ? '觀看紀錄已儲存至雲端' : '仍有紀錄暫存於此裝置，連線恢復後再同步');
          return uploaded;
        } catch (e) { setStatus(e.status === 0 ? e.message : '暫存於此裝置，連線恢復後再同步'); return false; }
      })();
      pulling.then(() => { pulling = null; });
      return pulling;
    }
    function save(value) {
      const id = String(value.episodeId), previous = entries[id];
      entries[id] = Object.assign({}, value, { episodeId: id, revision: (previous && previous.revision) || 0, updatedAt: Date.now(), localStamp: newToken(), dirty: true });
      const kept = {};
      Object.values(entries).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500).forEach(x => { kept[x.episodeId] = x; });
      entries = kept;
      announce();
      send();
    }
    async function changeProfile(next) {
      if (!/^[a-f0-9]{32}$/.test(next)) throw new Error('同步碼應為 32 位英數字。');
      if (!await send()) throw new Error('仍有未儲存的紀錄，請連線後重試。');
      if (pulling) await pulling;
      if (!write('gimy-profile', next)) throw new Error('電視無法保存同步碼。');
      token = next; entries = read('gimy-history:' + token, {}); announce();
      return refresh();
    }
    const all = () => Object.values(entries).sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      save, refresh, changeProfile, all,
      profile: () => token, status: () => status,
      get: id => entries[String(id)],
      latest: seriesId => all().filter(x => String(x.seriesId) === String(seriesId))[0],
      subscribe: fn => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    };
  })();

  /* ---------- toasts, dialogs, choosers ---------- */
  function toast(text) {
    const el = h('div', { class: 'toast', text });
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
  const overlays = [];
  // A modal layer with its own focus scope; Back closes it and focus returns to the opener.
  function modal(build, onKey) {
    const opener = document.activeElement;
    const layer = h('div', { class: 'dialog-backdrop', 'data-focus-scope': '' });
    const entry = { onKey: (action, e) => (onKey && onKey(action, e)) || (action === 'back' && (close(), true)) };
    function close() {
      const i = overlays.indexOf(entry);
      if (i < 0) return;
      overlays.splice(i, 1); layer.remove();
      if (opener && document.body.contains(opener)) Focus.focus(opener);
    }
    layer.appendChild(build(close));
    document.getElementById('app').appendChild(layer);
    overlays.push(entry);
    setTimeout(() => Focus.first('[data-autofocus]', layer), 0);
    return close;
  }
  function confirmDialog(title, message, actions) {
    return modal(close => h('div', { class: 'dialog', role: 'dialog' }, [
      h('h2', { class: 'dialog-title', text: title }), h('p', { class: 'dialog-message', text: message }),
      h('div', { class: 'dialog-actions' }, actions.map(a => button('btn' + (a.primary ? ' btn-primary' : ''), a.label, () => { close(); if (a.onSelect) a.onSelect(); }, { 'data-autofocus': a.autofocus || null }))),
    ]));
  }
  // A vertical list picker standing in for <select>, which a remote cannot drive comfortably.
  function chooser(title, options, value, onSelect) {
    return modal(close => h('div', { class: 'dialog', role: 'dialog' }, [
      h('h2', { class: 'dialog-title', text: title }),
      h('div', { class: 'dialog-list', 'data-scroll': 'y', 'data-scroll-pad': '90' }, options.map(o => button('dialog-option' + (o.value === value ? ' is-selected' : ''), o.label, () => { close(); onSelect(o.value); }, { 'data-autofocus': o.value === value || null }))),
    ]));
  }

  /* ---------- shared widgets ---------- */
  function tabRow(items, value, onChange, opts) {
    const o = opts || {};
    const track = h('div', { class: 'tab-row-track' }, items.map(item => button('chip' + (item.value === value ? ' is-selected' : '') + (item.warn ? ' is-warn' : ''), item.label, () => onChange(item.value), { 'data-autofocus': (o.autofocus && item.value === value) || null, 'data-value': item.value })));
    return h('div', { class: 'tab-row' + (o.size ? ' tab-row-' + o.size : ''), 'data-scroll': 'x', 'data-scroll-pad': '140', role: 'tablist', 'aria-label': o.label || null }, track);
  }
  function posterArt(pic, title) {
    const art = h('div', { class: 'poster-art' }, h('div', { class: 'poster-fallback', 'aria-hidden': 'true' }, [h('small', { text: 'GIMY TV' }), h('strong', { text: title || '' })]));
    if (pic) { const img = h('img', { alt: '', src: pic, referrerpolicy: 'no-referrer' }); img.addEventListener('error', () => img.remove()); art.appendChild(img); }
    return art;
  }
  function poster(item, onSelect) {
    const art = posterArt(item.pic, item.title);
    if (item.status) art.appendChild(h('span', { class: 'poster-badge', text: item.status }));
    return button('poster', [art, h('div', { class: 'poster-title', text: item.title }), h('div', { class: 'poster-meta', text: item.cast || '' })], () => onSelect(item), { 'data-id': item.id, 'aria-label': [item.title, item.status].filter(Boolean).join('，') });
  }
  const skeletons = n => h('div', { class: 'poster-grid' }, Array.from({ length: n }, () => h('div', { class: 'poster poster-skeleton' }, [h('div', { class: 'poster-art' })])));
  const spinner = label => h('div', { class: 'status' }, [h('span', { class: 'spinner' }), label ? h('span', { class: 'status-text', text: label }) : null]);
  function empty(title, message, actionLabel, onAction) {
    return h('div', { class: 'status' }, [h('div', { class: 'status-title', text: title }), message ? h('div', { class: 'status-text', text: message }) : null, onAction ? button('btn btn-primary', actionLabel || '重試', onAction, { 'data-autofocus': '' }) : null]);
  }
  // Text fields stay read-only while the remote moves past them; OK opens the TV keyboard.
  function textField(opts) {
    const input = h('input', { class: 'field-input focusable', tabindex: '-1', maxlength: opts.maxlength || '80', placeholder: opts.placeholder || '', autocomplete: 'off', 'data-autofocus': opts.autofocus || null });
    input.readOnly = true;
    const field = h('div', { class: 'field' }, [opts.icon ? icon(opts.icon) : null, input]);
    const stop = () => { input.readOnly = true; field.classList.remove('is-editing'); };
    // Re-focusing an editable input is what opens the Tizen on-screen keyboard.
    function edit() { input.blur(); input.readOnly = false; field.classList.add('is-editing'); input.focus(); }
    input.addEventListener('blur', stop);
    input.addEventListener('click', () => { if (input.readOnly) edit(); });
    function onKey(action, e) {
      if (e.target !== input) return false;
      if (input.readOnly) { if (action === 'enter') { edit(); return true; } return false; }
      if (action === 'enter' || action === 'imedone') { stop(); opts.onSubmit(input.value.trim()); return true; }
      if (action === 'imecancel' || action === 'back') { stop(); return true; }
      if (action === 'up' || action === 'down') { stop(); return false; }
      return 'typing';
    }
    return { el: field, input, onKey };
  }

  /* ---------- screens ---------- */
  const TYPES = [['2', '電視劇'], ['1', '電影'], ['4', '動漫'], ['29', '綜藝'], ['13', '陸劇'], ['20', '韓劇'], ['15', '日劇'], ['14', '台劇'], ['21', '港劇'], ['16', '美劇'], ['34', '短劇'], ['22', '紀錄片']];
  const AREAS = ['中國大陸', '香港', '台灣', '日本', '韓國', '美國', '歐美', '英國', '泰國'];
  const SORTS = [['', '預設'], ['time', '最近更新'], ['time_add', '最新上架'], ['hits_week', '本週人氣'], ['hits', '總人氣']];
  const openShow = item => Router.push(DetailScreen({ id: String(item.id), title: item.title, pic: item.pic }));

  function BrowseScreen() {
    const f = { type: '2', area: '', year: '', sort: '' };
    let years = [], items = 0, nextPage = null, loading = false, generation = 0, failedPage = null;
    const typeRow = h('div'), filterRow = h('div'), caption = h('p', { class: 'status-line' }), grid = h('div', { class: 'poster-grid' }), tail = h('div');
    const el = h('div', { class: 'page', 'data-scroll': 'y', 'data-scroll-pad': '170' }, [
      h('header', { class: 'page-header' }, [h('div', { class: 'page-header-row' }, [h('h1', { class: 'page-title', text: '影視目錄' }), h('span', { class: 'page-sub', text: '片源 · Gimy 劇迷' })]), typeRow]),
      filterRow, caption, grid, tail,
    ]);
    function renderFilters() {
      clear(typeRow).appendChild(tabRow(TYPES.map(t => ({ value: t[0], label: t[1] })), f.type, v => { f.type = v; f.area = f.year = f.sort = ''; renderFilters(); load(1); Focus.first('[data-value="' + v + '"]', typeRow); }, { size: 'lg', autofocus: true, label: '分類' }));
      const chip = (label, value, onclick) => button('chip', [h('b', { text: label }), value], onclick, { 'data-filter': label });
      const chips = [
        chip('地區', f.area || '全部', () => chooser('地區', [{ value: '', label: '全部地區' }].concat(AREAS.map(a => ({ value: a, label: a }))), f.area, v => set('area', v))),
        chip('年份', f.year || '全部', () => chooser('年份', [{ value: '', label: '全部年份' }].concat(years.map(y => ({ value: y, label: y }))), f.year, v => set('year', v))),
        chip('排序', SORTS.filter(s => s[0] === f.sort)[0][1], () => chooser('排序', SORTS.map(s => ({ value: s[0], label: s[1] })), f.sort, v => set('sort', v))),
      ];
      if (f.area || f.year || f.sort) chips.push(button('chip', '重設篩選', () => { f.area = f.year = f.sort = ''; renderFilters(); load(1); Focus.first(null, filterRow); }));
      clear(filterRow).appendChild(h('div', { class: 'tab-row tab-row-sm', 'data-scroll': 'x' }, h('div', { class: 'tab-row-track' }, chips)));
    }
    function set(key, value) { f[key] = value; renderFilters(); load(1); Focus.first('[data-filter="' + { area: '地區', year: '年份', sort: '排序' }[key] + '"]', filterRow); }
    async function load(page) {
      const run = ++generation;
      loading = true;
      if (page === 1) { items = 0; nextPage = null; clear(grid); el.scrollTop = 0; }
      clear(tail).appendChild(page === 1 ? skeletons(6) : spinner('正在載入更多…'));
      caption.textContent = '正在讀取影視目錄…';
      try {
        const data = await api('/api/catalog?' + query({ type: f.type, area: f.area, year: f.year, sort: f.sort, page }));
        if (run !== generation) return;
        if (data.years && !years.length) years = data.years;
        const seen = {};
        Array.prototype.forEach.call(grid.children, c => { seen[c.getAttribute('data-id')] = true; });
        data.items.forEach(item => { if (seen[item.id]) return; seen[item.id] = true; items++; grid.appendChild(poster(item, openShow)); });
        nextPage = data.nextPage || null; failedPage = null;
        caption.textContent = items ? (data.heading || '影視目錄') + ' · 已顯示 ' + items + ' 套' : '未找到符合條件的影片，試下其他篩選。';
        clear(tail);
        if (!items) tail.appendChild(empty('這裏暫時沒有影片', '換個分類或篩選看看。'));
        else if (!nextPage) tail.appendChild(h('div', { class: 'list-end', text: '已經到底了' }));
      } catch (e) {
        if (run !== generation) return;
        failedPage = page;
        caption.textContent = '未能載入目錄';
        clear(tail).appendChild(empty('目錄暫時載入不了', e.message, '重新載入目錄', () => load(failedPage || 1)));
      } finally { if (run === generation) loading = false; }
    }
    // Infinite scroll: focusing a poster in the last two rows fetches the next page.
    grid.addEventListener('focusin', e => {
      const index = Array.prototype.indexOf.call(grid.children, e.target);
      if (index >= grid.children.length - 12 && nextPage && !loading) load(nextPage);
    });
    renderFilters();
    load(1);
    return { name: 'browse', el };
  }

  function SearchScreen() {
    let generation = 0;
    const results = h('div', { class: 'poster-grid' }), caption = h('p', { class: 'status-line', text: '用遙控器輸入繁體中文劇名，例如：鬼滅之刃。' }), tail = h('div');
    const field = textField({ icon: 'search', placeholder: '按 OK 輸入劇名', autofocus: true, onSubmit: run });
    const el = h('div', { class: 'page', 'data-scroll': 'y', 'data-scroll-pad': '170' }, [
      h('header', { class: 'page-header' }, h('h1', { class: 'page-title', text: '搜尋' })),
      h('div', { class: 'sync-form' }, [field.el, button('btn btn-primary btn-lg', '搜尋', () => run(field.input.value.trim()))]),
      caption, results, tail,
    ]);
    async function run(q) {
      if (!q) { caption.textContent = '請先輸入劇名。'; return; }
      const id = ++generation;
      clear(results); clear(tail).appendChild(spinner());
      caption.textContent = '正在搜尋「' + q + '」…';
      try {
        const data = await api('/api/search?q=' + encodeURIComponent(q));
        if (id !== generation) return;
        clear(tail);
        data.items.forEach(item => results.appendChild(poster(item, openShow)));
        caption.textContent = data.items.length ? '找到 ' + data.items.length + ' 套與「' + q + '」相關的影片' : '找不到「' + q + '」。請用繁體中文劇名再試（簡體字搜尋不到）。';
        if (data.items.length) Focus.focus(results.firstChild);
      } catch (e) {
        if (id !== generation) return;
        caption.textContent = '搜尋失敗';
        clear(tail).appendChild(empty('暫時未能搜尋', e.message, '重試', () => run(q)));
      }
    }
    return { name: 'search', el, onKey: (action, e) => { const r = field.onKey(action, e); return r === 'typing' ? null : r; } };
  }

  function HistoryScreen() {
    const sub = h('span', { class: 'page-sub' }), list = h('div', { class: 'history-list' });
    const el = h('div', { class: 'page', 'data-scroll': 'y', 'data-scroll-pad': '170' }, [
      h('header', { class: 'page-header' }, h('div', { class: 'page-header-row' }, [h('h1', { class: 'page-title', text: '觀看歷史' }), sub])), list,
    ]);
    function render() {
      sub.textContent = Store.status();
      const rows = Store.all();
      // Keep the focused row across re-renders when progress syncs in.
      const focused = document.activeElement && list.contains(document.activeElement) ? document.activeElement : null;
      const key = focused && focused.getAttribute('data-key');
      clear(list);
      if (!rows.length) { list.appendChild(empty('未有觀看紀錄', '播放影片後會自動儲存；其他裝置可用「裝置同步」接住睇。')); return; }
      rows.forEach(entry => {
        const percent = entry.duration ? Math.min(100, entry.position / entry.duration * 100) : 0;
        const bar = h('div', { class: 'history-bar' }, h('i')); bar.firstChild.style.width = (entry.completed ? 100 : percent) + '%';
        list.appendChild(h('div', { class: 'history-row' }, [
          button('history-main', [icon('play'), h('div', { class: 'history-text' }, [
            h('div', { class: 'history-title', text: entry.title }),
            h('div', { class: 'history-meta', text: (entry.completed ? '已看完' : '看到 ' + time(entry.position) + ' / ' + time(entry.duration)) + ' · ' + new Date(entry.updatedAt).toLocaleString('zh-HK') }), bar])],
          () => Router.push(PlayerScreen({ id: String(entry.seriesId), sid: entry.sid, nid: Number(String(entry.episodeId).split('-')[1]) })),
          { 'data-key': 'p' + entry.episodeId, 'aria-label': (entry.completed ? '重新觀看 ' : '繼續觀看 ') + entry.title }),
          button('btn btn-lg', '全部集數', () => openShow({ id: entry.seriesId, title: entry.seriesTitle }), { 'data-key': 'd' + entry.episodeId }),
        ]));
      });
      const again = key && list.querySelector('[data-key="' + key + '"]');
      if (again) Focus.focus(again); else if (focused) Focus.first(null, list);
    }
    let unsubscribe = null;
    return {
      name: 'history', el,
      onShow() { render(); Store.refresh(); if (!unsubscribe) unsubscribe = Store.subscribe(() => { if (Router.top().el === el) render(); }); },
    };
  }

  function SyncScreen() {
    const code = h('div', { class: 'sync-code' }), status = h('p', { class: 'sync-status', role: 'status' });
    const other = textField({ placeholder: '按 OK 輸入 32 位私人同步碼', maxlength: '64', onSubmit: switchProfile });
    const server = textField({ placeholder: 'https://gimy-tv.<帳戶>.workers.dev', maxlength: '200', onSubmit: saveServer });
    const el = h('div', { class: 'page', 'data-scroll': 'y', 'data-scroll-pad': '170' }, [
      h('header', { class: 'page-header' }, h('h1', { class: 'page-title', text: '裝置同步' })),
      h('div', { class: 'sync' }, [
        h('section', { class: 'sync-card' }, [h('h2', { text: '此裝置的私人同步碼' }), code,
          h('p', { text: '觀看紀錄會自動儲存到雲端。想在另一部電視或電腦接住睇，就在那部裝置的「裝置同步」輸入此同步碼。持有同步碼的人可讀取及更改紀錄，請勿公開分享。' })]),
        h('section', { class: 'sync-card' }, [h('h2', { text: '改用另一部裝置的紀錄' }),
          h('div', { class: 'sync-form' }, [other.el, button('btn btn-primary', '切換紀錄', () => switchProfile(other.input.value.trim()))])]),
        PACKAGED ? h('section', { class: 'sync-card' }, [h('h2', { text: '伺服器位址' }),
          h('p', { text: '電視版透過你部署的 Gimy TV Worker 讀取片源及同步紀錄。打包時用 --api 指定的位址會自動填入。' }),
          h('div', { class: 'sync-form' }, [server.el, button('btn btn-primary', '儲存', () => saveServer(server.input.value.trim()))])]) : null,
        status,
      ]),
    ]);
    async function switchProfile(value) {
      const next = value.replace(/\s+/g, '').toLowerCase();
      try { await Store.changeProfile(next); other.input.value = ''; render(); toast('已切換至另一份觀看紀錄'); }
      catch (e) { status.textContent = e.message; }
    }
    function saveServer(value) {
      const url = value.replace(/\/+$/, '');
      if (url && !/^https?:\/\/[^\s/]+$/i.test(url)) { status.textContent = '請輸入完整網址，例如 https://gimy-tv.example.workers.dev'; return; }
      write('gimy-api', url); render(); toast(url ? '已儲存伺服器位址' : '已改用預設伺服器位址'); Store.refresh();
    }
    function render() {
      code.textContent = Store.profile().match(/.{4}/g).join(' ');
      server.input.value = apiBase();
      status.textContent = Store.status();
    }
    Store.subscribe(() => { status.textContent = Store.status(); });
    return {
      name: 'sync', el,
      onShow() { render(); Store.refresh(); },
      onKey(action, e) { const r = other.onKey(action, e) || server.onKey(action, e); return r === 'typing' ? null : r; },
    };
  }

  const episodeKey = (id, nid) => id + '-' + nid;
  const RANGE = 60;
  function episodeButton(show, route, ep, onSelect, current) {
    const saved = Store.get(episodeKey(show.id, ep.nid));
    const note = [current ? '正在觀看' : '', saved ? (saved.completed ? '已看完' : '看到 ' + time(saved.position)) : ''].filter(Boolean).join(' · ');
    const b = button('episode' + (current ? ' is-current' : '') + (saved && saved.completed ? ' is-done' : ''), [h('span', { text: ep.label }), note ? h('small', { text: note }) : null], () => onSelect(ep), { 'data-nid': ep.nid, 'aria-label': ep.label + (note ? '，' + note : '') });
    if (saved && !saved.completed && saved.duration) { const bar = h('i', { class: 'episode-bar' }); bar.style.width = Math.min(100, saved.position / saved.duration * 100) + '%'; b.appendChild(bar); }
    return b;
  }

  function DetailScreen(preview) {
    let show = null, sid = null, range = 0;
    const backdrop = h('div', { class: 'detail-backdrop' }), cover = h('div', { class: 'detail-cover' });
    const eyebrow = h('div', { class: 'detail-eyebrow', text: 'Gimy 劇迷' }), title = h('h1', { class: 'detail-title', text: preview.title || '正在讀取影片…' });
    const people = h('p', { class: 'detail-people' }), intro = h('p', { class: 'detail-intro' }), resume = h('p', { class: 'detail-resume' }), actions = h('div', { class: 'detail-actions' });
    const routesBox = h('div'), rangeBox = h('div'), episodes = h('div', { class: 'episode-grid' }), body = h('section', { class: 'detail-section' }, spinner('正在讀取集數…')), comments = h('section', { class: 'comments' });
    const el = h('div', { class: 'detail', 'data-scroll': 'y', 'data-scroll-pad': '140' }, [
      backdrop, h('div', { class: 'detail-shade' }),
      h('div', { class: 'detail-hero' }, [cover, h('div', { class: 'detail-info' }, [eyebrow, title, people, intro, resume, actions])]),
      body, comments,
    ]);
    function setCover(pic) {
      clear(cover).appendChild(posterArt(pic, show ? show.title : preview.title).firstChild);
      if (pic) { const img = h('img', { alt: '', src: pic, referrerpolicy: 'no-referrer' }); img.addEventListener('error', () => img.remove()); cover.appendChild(img); backdrop.style.backgroundImage = 'url("' + pic.replace(/"/g, '%22') + '")'; }
    }
    setCover(preview.pic);
    const routeOf = id => show && show.routes.filter(r => r.sid === id)[0];
    const play = (routeSid, nid) => Router.push(PlayerScreen({ id: show.id, sid: routeSid, nid, show }));
    function renderActions() {
      const last = Store.latest(show.id);
      const route = routeOf(sid);
      const first = route && route.episodes[0];
      resume.textContent = last ? '上次觀看：' + last.title + ' · ' + (last.completed ? '已看完' : '看到 ' + time(last.position)) : '尚未有觀看紀錄';
      const lastNid = last && Number(String(last.episodeId).split('-')[1]);
      const resumeEp = last && route && route.episodes.filter(ep => ep.nid === lastNid)[0];
      clear(actions);
      if (!first) { actions.appendChild(button('btn btn-lg', '原站暫未提供可播放的集數', null, { disabled: true })); return; }
      actions.appendChild(button('btn btn-primary btn-lg', [icon('play'), resumeEp ? (last.completed ? '重看 ' : '繼續觀看 ') + resumeEp.label : '開始播放 ' + first.label], () => play(sid, (resumeEp || first).nid), { 'data-autofocus': '', 'data-action': 'play' }));
      if (resumeEp && resumeEp !== first) actions.appendChild(button('btn btn-lg', '從 ' + first.label + ' 開始', () => play(sid, first.nid)));
      actions.appendChild(button('btn btn-lg', [icon('list'), '選擇集數'], () => Focus.first(null, episodes)));
    }
    function renderEpisodes() {
      const route = routeOf(sid);
      const list = route ? route.episodes : [];
      const ranges = [];
      for (let i = 0; i < list.length; i += RANGE) ranges.push([i, Math.min(list.length, i + RANGE)]);
      if (range >= ranges.length) range = 0;
      clear(rangeBox);
      if (ranges.length > 1) rangeBox.appendChild(tabRow(ranges.map((r, i) => ({ value: i, label: list[r[0]].label + ' – ' + list[r[1] - 1].label })), range, i => { range = i; renderEpisodes(); Focus.first('[data-value="' + i + '"]', rangeBox); }, { size: 'sm', label: '集數範圍' }));
      clear(episodes);
      const shown = ranges[range] ? list.slice(ranges[range][0], ranges[range][1]) : [];
      shown.forEach(ep => episodes.appendChild(episodeButton(show, route, ep, e => play(sid, e.nid))));
    }
    function renderRoutes() {
      clear(routesBox);
      if (show.routes.length > 1) routesBox.appendChild(tabRow(show.routes.map(r => ({ value: r.sid, label: r.name + (r.direct === false ? '（可能不支援）' : '') + ' · ' + r.episodes.length + ' 集', warn: r.direct === false })), sid, next => {
        sid = next; range = 0; renderRoutes(); renderEpisodes(); renderActions(); Focus.first('[data-value="' + next + '"]', routesBox);
      }, { label: '播放線路' }));
    }
    function render() {
      title.textContent = show.title;
      eyebrow.textContent = [show.category, show.year, show.area, show.language, show.status].filter(Boolean).join(' · ') || 'Gimy 劇迷';
      people.textContent = [show.actors && '主演：' + show.actors, show.director && '導演：' + show.director].filter(Boolean).join('　');
      intro.textContent = show.summary || '暫未有簡介，仍然可以從下方選集播放。';
      setCover(show.pic || preview.pic);
      const last = Store.latest(show.id);
      sid = [last && last.sid].concat(show.routes.map(r => r.sid)).filter(s => routeOf(s))[0];
      if (sid == null) sid = null;
      // Open on the episode range holding the last-watched episode.
      const route = routeOf(sid), lastNid = last && Number(String(last.episodeId).split('-')[1]);
      const at = route ? route.episodes.findIndex(ep => ep.nid === lastNid) : -1;
      range = at > 0 ? Math.floor(at / RANGE) : 0;
      clear(body).appendChild(h('h2', { class: 'section-title', text: show.routes.length ? '選擇線路及集數' : '集數' }));
      body.appendChild(routesBox); body.appendChild(rangeBox); body.appendChild(episodes);
      if (!show.routes.length) body.appendChild(h('p', { class: 'status-line', text: '原站暫未提供可播放的集數。' }));
      renderRoutes(); renderEpisodes(); renderActions();
      clear(comments);
      if (show.comments && show.comments.length) {
        comments.appendChild(h('h2', { class: 'section-title', text: '劇迷留言' }));
        comments.appendChild(h('p', { class: 'status-line', text: '來自 Gimy 劇迷的觀眾留言，內容可能包含劇透。' }));
        show.comments.forEach(c => comments.appendChild(button('comment', [h('div', { class: 'comment-meta' }, [h('b', { text: c.author }), c.time]), h('p', { text: c.text })])));
      }
      Focus.first('[data-autofocus]', el);
    }
    async function load() {
      clear(body).appendChild(spinner('正在讀取集數…'));
      try { show = await api('/api/detail?id=' + encodeURIComponent(preview.id)); render(); }
      catch (e) { title.textContent = preview.title || '未能載入影片'; clear(body).appendChild(empty('影片資料載入失敗', e.message, '重新讀取集數', load)); Focus.first('[data-autofocus]', body); }
    }
    load();
    // Returning from the player: refresh progress marks without moving focus off the episode.
    function refreshMarks() {
      if (!show) return;
      const route = routeOf(sid);
      Array.prototype.forEach.call(episodes.children, b => {
        const ep = route.episodes.filter(x => x.nid === Number(b.getAttribute('data-nid')))[0];
        const fresh = episodeButton(show, route, ep, e => play(sid, e.nid));
        const focused = document.activeElement === b;
        episodes.replaceChild(fresh, b);
        if (focused) Focus.focus(fresh);
      });
      const onPlay = document.activeElement && document.activeElement.getAttribute('data-action') === 'play';
      renderActions();
      if (onPlay) Focus.first('[data-autofocus]', actions);
    }
    function returned() {
      const last = show && Store.latest(show.id);
      if (!last || last.sid === sid || !routeOf(last.sid)) { refreshMarks(); return; }
      // The player switched routes: follow it, as the web version preselects the route last used.
      sid = last.sid; range = 0; renderRoutes(); renderEpisodes(); renderActions();
      setTimeout(() => Focus.first('[data-autofocus]', actions), 40);
    }
    return { name: 'detail', el, fullscreen: true, onShow: (fresh) => { if (!fresh) returned(); } };
  }

  function PlayerScreen(opts) {
    let show = opts.show || null, playback = null, requested = null, hls = null, generation = 0;
    let watchArmed = false, pendingResume = null, lastSavedAt = 0, lastRecorded = '', osdTimer = null, seekTarget = null, seekTimer = null, panelClose = null, resumeTimer = null;
    const video = h('video', { class: 'player-video', playsinline: '', preload: 'auto' });
    const title = h('div', { class: 'player-title', text: '準備影片中' }), sub = h('div', { class: 'player-sub', text: '取得播放資料' });
    const buffered = h('i', { class: 'player-bar-buffered' }), fill = h('i', { class: 'player-bar-fill' }), knob = h('i', { class: 'player-bar-knob' });
    const bar = h('div', { class: 'player-bar focusable', tabindex: '-1', role: 'slider', 'aria-label': '播放進度' }, [buffered, fill, knob]);
    const elapsed = h('span', { class: 'player-time', text: '0:00' }), total = h('span', { class: 'player-time', text: '0:00' });
    const playBtn = button('ctrl', [icon('play'), '播放'], () => toggle(), { 'data-autofocus': '' });
    const prevBtn = button('ctrl', [icon('prev'), '上一集'], () => step('previous'));
    const nextBtn = button('ctrl', [icon('next'), '下一集'], () => step('next'));
    const loading = h('div', { class: 'player-loading' }, [h('span', { class: 'spinner' }), h('span', { text: '正在準備影片…' })]);
    const errorBox = h('div', { class: 'player-error', 'data-focus-scope': '', hidden: true });
    const seekBadge = h('div', { class: 'player-seek', hidden: true }), resumeBadge = h('div', { class: 'player-resume', hidden: true });
    const el = h('div', { class: 'player osd-visible' }, [
      video, h('div', { class: 'player-top' }, [title, sub]),
      h('div', { class: 'player-osd' }, [
        h('div', { class: 'player-bar-row' }, [elapsed, bar, total]),
        h('div', { class: 'player-controls' }, [prevBtn, playBtn, nextBtn, button('ctrl', [icon('list'), '選集'], () => openEpisodes()), button('ctrl', [icon('route'), '線路'], () => openRoutes()), button('ctrl', [icon('reload'), '重新載入'], () => reload())]),
        h('div', { class: 'player-hints' }, [h('span', null, [h('b', { text: '◀ ▶' }), '快退 / 快進 10 秒']), h('span', null, [h('i', { class: 'key-green' }), '選集']), h('span', null, [h('i', { class: 'key-yellow' }), '線路']), h('span', null, [h('b', { text: 'CH ▲▼' }), '上 / 下一集'])]),
      ]),
      loading, seekBadge, resumeBadge, errorBox,
    ]);
    const routeOf = sid => show && show.routes.filter(r => r.sid === sid)[0];
    const labelOf = (sid, nid) => { const r = routeOf(sid); const ep = r && r.episodes.filter(e => e.nid === nid)[0]; return ep ? ep.label : '第 ' + nid + ' 集'; };
    const status = text => { sub.textContent = [routeOf(requested && requested.sid) ? routeOf(requested.sid).name : '', text].filter(Boolean).join(' · '); };
    const duration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

    function saveProgress() {
      if (!playback || !watchArmed || pendingResume || !duration()) return;
      lastSavedAt = Date.now();
      const fingerprint = [playback.id, playback.nid, Math.floor(video.currentTime * 10), video.ended].join(':');
      if (fingerprint === lastRecorded) return;
      lastRecorded = fingerprint;
      Store.save({ episodeId: episodeKey(playback.id, playback.nid), seriesId: playback.id, sid: playback.sid, title: playback.label, seriesTitle: playback.title, position: video.currentTime, duration: video.duration, completed: video.ended });
    }
    function restorePosition() {
      if (!pendingResume || !duration()) return;
      const saved = pendingResume; pendingResume = null;
      video.currentTime = saved.completed ? 0 : Math.min(saved.position, Math.max(0, video.duration - 0.25));
      if (saved.completed || video.currentTime > 1) flashResume(saved.completed ? '本集已看完，從頭播放。' : '已接續上次進度 ' + time(video.currentTime));
    }
    function flashResume(text) { resumeBadge.textContent = text; resumeBadge.hidden = false; clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { resumeBadge.hidden = true; }, 4000); }
    function detach() {
      if (hls) { hls.destroy(); hls = null; }
      video.pause(); video.removeAttribute('src'); video.load();
    }
    // Samsung TVs play HLS natively; desktop browsers previewing /tv/ fall back to hls.js.
    function attach(data) {
      detach();
      if (data.type === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl') && window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: false, maxBufferLength: 30 });
        hls.on(window.Hls.Events.ERROR, (_, detail) => {
          if (!detail.fatal) return;
          if (detail.type === window.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          fail('此線路的影片暫時無法載入，請重新載入或改選其他線路。');
        });
        hls.loadSource(data.media); hls.attachMedia(video);
      } else { video.src = data.media; video.load(); }
    }
    function fail(message) {
      loading.hidden = true; status('未能載入');
      clear(errorBox).appendChild(h('div', { class: 'player-error-title', text: '暫時未能播放' }));
      errorBox.appendChild(h('div', { class: 'player-error-text', text: message }));
      errorBox.appendChild(h('div', { class: 'player-error-actions' }, [
        button('btn btn-primary', [icon('reload'), '重新載入'], () => reload(), { 'data-autofocus': '' }),
        show && show.routes.length > 1 ? button('btn', [icon('route'), '改選線路'], () => openRoutes()) : null,
        button('btn', '返回', () => Router.back()),
      ]));
      errorBox.hidden = false;
      setTimeout(() => Focus.first('[data-autofocus]', errorBox), 0);
      screenSaver(true);
    }
    function controls() {
      prevBtn.disabled = !(playback && playback.previous);
      nextBtn.disabled = !(playback && playback.next);
    }
    async function loadShow(id) {
      if (show && show.id === id) return show;
      show = await api('/api/detail?id=' + encodeURIComponent(id));
      return show;
    }
    // A route needing the source site's parser (HTTP 422) falls through to the next direct route carrying the same episode.
    async function prepare(id, sid, nid, tried) {
      saveProgress(); watchArmed = false; pendingResume = null;
      requested = { id, sid, nid };
      const run = ++generation;
      closePanel(); detach(); playback = null; controls();
      errorBox.hidden = true; loading.hidden = false; resumeBadge.hidden = true; showOsd(true);
      title.textContent = show ? show.title + ' ' + labelOf(sid, nid) : '準備影片中';
      status('正在準備影片…');
      const sync = Store.refresh();
      try {
        await loadShow(id);
        if (run !== generation) return;
        if (!routeOf(sid)) { const carrying = show.routes.filter(r => r.episodes.some(e => e.nid === nid))[0]; if (carrying) sid = carrying.sid; }
        requested = { id, sid, nid };
        title.textContent = show.title + ' ' + labelOf(sid, nid);
        const attempted = tried || {};
        attempted[sid] = true;
        let data;
        try { data = await api('/api/resolve?' + query({ id, sid, nid })); }
        catch (e) {
          const fallback = e.status === 422 && show.routes.filter(r => !attempted[r.sid] && r.direct !== false && r.episodes.some(ep => ep.nid === nid))[0];
          if (fallback && run === generation) { toast('此線路不支援，改用「' + fallback.name + '」'); return prepare(id, fallback.sid, nid, attempted); }
          throw e;
        }
        await sync;
        if (run !== generation) return;
        playback = Object.assign({}, data, { label: show.title + ' ' + labelOf(sid, nid), title: show.title });
        pendingResume = Store.get(episodeKey(id, nid)) || null;
        controls();
        attach(data);
        status('緩衝中…');
        try { await video.play(); }
        catch (e) { if (run === generation) { loading.hidden = true; status('請按播放鍵開始'); showOsd(true); Focus.focus(playBtn); } }
      } catch (e) {
        if (run === generation) fail(e.message || '連線失敗，請重試。');
      }
    }
    async function toggle() {
      if (!playback) return;
      if (!video.paused) { video.pause(); return; }
      try { await video.play(); } catch (e) { toast(e.name === 'NotAllowedError' ? '請再按一次播放鍵，允許電視開始播放。' : '電視未能開始播放，可按「重新載入」或改選其他線路。'); }
    }
    const reload = () => { if (requested) prepare(requested.id, requested.sid, requested.nid); };
    function step(direction) {
      const target = playback && playback[direction];
      if (target) prepare(playback.id, target.sid, target.nid);
      else toast(direction === 'next' ? '已經是最後一集' : '已經是第一集');
    }
    function stop() {
      saveProgress(); watchArmed = false; pendingResume = null; generation++;
      clearTimeout(osdTimer); clearTimeout(seekTimer); clearTimeout(resumeTimer); closePanel();
      detach(); playback = null; screenSaver(true);
    }

    // On-screen display: hidden while playing, shown by any key, auto-hidden after 5 seconds.
    const osdVisible = () => el.classList.contains('osd-visible');
    function showOsd(keep) {
      el.classList.add('osd-visible');
      paint();
      clearTimeout(osdTimer);
      if (!keep) osdTimer = setTimeout(hideOsd, 5000);
    }
    function hideOsd() {
      if (video.paused || panelClose || !errorBox.hidden || !playback) return;
      el.classList.remove('osd-visible');
      if (el.contains(document.activeElement)) document.activeElement.blur();
    }
    function paint() {
      const d = duration(), at = seekTarget == null ? video.currentTime : seekTarget;
      elapsed.textContent = time(at); total.textContent = time(d);
      const pct = d ? Math.min(100, at / d * 100) : 0;
      fill.style.width = pct + '%'; knob.style.left = pct + '%';
      let end = 0;
      try { if (video.buffered.length) end = video.buffered.end(video.buffered.length - 1); } catch (e) { /* not ready */ }
      buffered.style.width = (d ? Math.min(100, end / d * 100) : 0) + '%';
    }
    // Repeated presses accumulate and seek once, which keeps the TV's player responsive.
    function seekBy(seconds) {
      const d = duration();
      if (!playback || !d) return;
      seekTarget = Math.max(0, Math.min(d - 1, (seekTarget == null ? video.currentTime : seekTarget) + seconds));
      seekBadge.textContent = (seconds > 0 ? '▶▶ ' : '◀◀ ') + time(seekTarget) + ' / ' + time(d);
      seekBadge.hidden = false; paint();
      clearTimeout(seekTimer);
      seekTimer = setTimeout(() => { video.currentTime = seekTarget; seekTarget = null; seekBadge.hidden = true; }, 650);
    }

    function closePanel() { if (panelClose) { const close = panelClose; panelClose = null; close(); } }
    function panel(titleText, note, bodyEl, focusSelector) {
      closePanel();
      showOsd(true);
      const box = h('div', { class: 'player-panel', 'data-focus-scope': '' }, [h('h2', { class: 'player-panel-title' }, [titleText, h('small', { text: note })]), h('div', { class: 'player-panel-body', 'data-scroll': 'y', 'data-scroll-pad': '120' }, bodyEl)]);
      el.appendChild(box);
      panelClose = () => { box.remove(); panelClose = null; showOsd(); Focus.focus(playBtn); };
      setTimeout(() => Focus.first(focusSelector, box), 0);
    }
    function openEpisodes() {
      const route = show && requested && routeOf(requested.sid);
      if (!route) return;
      const grid = h('div', { class: 'episode-grid' }, route.episodes.map(ep => episodeButton(show, route, ep, e => prepare(show.id, route.sid, e.nid), ep.nid === requested.nid)));
      panel('選集', route.name + ' · 共 ' + route.episodes.length + ' 集', grid, '.is-current');
    }
    function openRoutes() {
      if (!show || !requested) return;
      const list = h('div', { class: 'route-list' }, show.routes.map(r => {
        const has = r.episodes.some(e => e.nid === requested.nid);
        return button('dialog-option' + (r.sid === requested.sid ? ' is-selected' : ''), [r.name, h('small', { text: (r.direct === false ? '可能不支援 · ' : '') + (has ? labelOf(r.sid, requested.nid) : '沒有此集，改播 ' + (r.episodes[0] ? r.episodes[0].label : '')) })], () => {
          const nid = has ? requested.nid : r.episodes[0] && r.episodes[0].nid;
          if (nid != null) prepare(show.id, r.sid, nid);
        }, { 'data-current': r.sid === requested.sid || null });
      }));
      panel('播放線路', '播放不順可改選其他線路', list, '[data-current]');
    }

    video.addEventListener('playing', () => { restorePosition(); watchArmed = true; lastSavedAt = Date.now(); loading.hidden = true; status('播放中'); clear(playBtn).appendChild(icon('pause')); playBtn.appendChild(document.createTextNode('暫停')); screenSaver(false); showOsd(); });
    video.addEventListener('pause', () => { saveProgress(); if (playback) status('已暫停'); clear(playBtn).appendChild(icon('play')); playBtn.appendChild(document.createTextNode('播放')); screenSaver(true); showOsd(true); });
    video.addEventListener('waiting', () => { if (playback) { status('緩衝中…'); loading.hidden = false; } });
    video.addEventListener('canplay', () => { loading.hidden = true; if (playback) status(video.paused ? '可以播放' : '播放中'); });
    video.addEventListener('ended', () => {
      saveProgress(); status('本集播放完畢'); screenSaver(true);
      if (playback && playback.next) { toast('自動播放下一集'); step('next'); } else { showOsd(true); Focus.focus(playBtn); }
    });
    video.addEventListener('error', () => { if (playback && !hls) fail('影片未能播放（錯誤 ' + ((video.error && video.error.code) || '未知') + '），可重新載入或改選其他線路。'); });
    video.addEventListener('loadedmetadata', restorePosition);
    video.addEventListener('durationchange', restorePosition);
    video.addEventListener('timeupdate', () => { if (Date.now() - lastSavedAt >= 15000) saveProgress(); if (osdVisible()) paint(); });
    video.addEventListener('progress', () => { if (osdVisible()) paint(); });
    video.addEventListener('seeked', saveProgress);
    const onHidden = () => { if (document.hidden) { saveProgress(); if (playback && !video.paused) video.pause(); } };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', saveProgress);

    function onKey(action) {
      if (panelClose) {
        if (action === 'back' || action === 'green' || action === 'yellow') { closePanel(); return true; }
        if (action === 'playpause') { toggle(); return true; }
        return false;
      }
      switch (action) {
        case 'playpause': toggle(); showOsd(); return true;
        case 'play': if (video.paused) toggle(); return true;
        case 'pause': if (!video.paused) video.pause(); return true;
        case 'stop': Router.back(); return true;
        case 'forward': seekBy(30); return true;
        case 'rewind': seekBy(-30); return true;
        case 'next': step('next'); return true;
        case 'previous': step('previous'); return true;
        case 'green': openEpisodes(); return true;
        case 'yellow': openRoutes(); return true;
        case 'info': showOsd(); return true;
      }
      if (!errorBox.hidden) return action === 'back' ? (Router.back(), true) : false;
      const focused = Focus.current();
      if (!osdVisible() || !focused) {
        // OSD hidden: arrows seek, OK pauses, Up reveals the controls, Down opens the episode list.
        if (action === 'left' || action === 'right') { seekBy(action === 'left' ? -10 : 10); return true; }
        if (action === 'enter') { toggle(); showOsd(); return true; }
        if (action === 'up') { showOsd(); Focus.focus(playBtn); return true; }
        if (action === 'down') { openEpisodes(); return true; }
        if (action === 'back') { Router.back(); return true; }
        return true;
      }
      showOsd(video.paused);
      if (focused === bar && (action === 'left' || action === 'right')) { seekBy(action === 'left' ? -10 : 10); return true; }
      if (action === 'back') { if (playback && !video.paused) { el.classList.remove('osd-visible'); focused.blur(); } else Router.back(); return true; }
      return false;
    }
    prepare(String(opts.id), Number(opts.sid), Number(opts.nid));
    return {
      name: 'player', el, fullscreen: true, onKey,
      destroy() { stop(); document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', saveProgress); },
    };
  }

  /* ---------- router: one root tab plus pushed detail/player screens ---------- */
  const Router = (function () {
    const stage = document.getElementById('stage'), app = document.getElementById('app'), sidebar = document.getElementById('sidebar');
    const roots = {}, makers = { browse: BrowseScreen, search: SearchScreen, history: HistoryScreen, sync: SyncScreen };
    let stack = [], tab = null, lastContent = null;
    const top = () => stack[stack.length - 1];
    function cover(screen) {
      if (!screen) return;
      const focused = document.activeElement;
      if (focused && screen.el.contains(focused)) screen.saved = focused;
      screen.el.parentNode.classList.add('is-covered');
      if (screen.onHide) screen.onHide();
    }
    function reveal(screen, fresh) {
      const wrap = screen.el.parentNode;
      wrap.classList.remove('is-covered');
      app.classList.toggle('is-fullscreen', !!screen.fullscreen);
      if (screen.onShow) screen.onShow(fresh);
      // Deferred: focus() is a no-op until visibility:hidden is gone and layout settles.
      setTimeout(() => {
        if (top() !== screen || overlays.length) return;
        if (!fresh && screen.saved && document.body.contains(screen.saved) && Focus.focus(screen.saved)) return;
        if (!Focus.current() || !wrap.contains(document.activeElement)) Focus.first('[data-autofocus]', wrap) || Focus.first(null, wrap);
      }, 30);
    }
    function mount(screen) { const wrap = h('div', { class: 'screen screen-' + screen.name }, screen.el); stage.appendChild(wrap); }
    function push(screen) { cover(top()); stack.push(screen); mount(screen); reveal(screen, true); }
    function pop() {
      const screen = stack.pop();
      if (screen.destroy) screen.destroy();
      screen.el.parentNode.remove();
      reveal(top(), false);
    }
    function switchTab(name) {
      if (!makers[name]) return;
      while (stack.length > 1) { const s = stack.pop(); if (s.destroy) s.destroy(); s.el.parentNode.remove(); }
      const current = stack[0];
      if (current && tab === name) { reveal(current, false); return; }
      if (current) { cover(current); current.el.parentNode.remove(); }
      tab = name;
      Array.prototype.forEach.call(sidebar.querySelectorAll('.sidebar-item'), b => b.classList.toggle('is-current', b.getAttribute('data-tab') === name));
      // Tab roots stay alive so the catalogue keeps its filters and scroll position.
      const fresh = !roots[name];
      if (fresh) roots[name] = makers[name]();
      stack = [roots[name]];
      mount(roots[name]);
      reveal(roots[name], fresh);
    }
    function back() {
      if (stack.length > 1) pop();
      else if (tab !== 'browse') { switchTab('browse'); }
      else confirmDialog('離開 Gimy TV？', '觀看紀錄會自動保留，下次可以接住睇。', [{ label: '離開', onSelect: exitApp }, { label: '繼續觀看', primary: true, autofocus: true }]);
    }
    // Remember the last content element so Right from the sidebar lands back on it.
    document.addEventListener('focusin', e => { if (!sidebar.contains(e.target) && stage.contains(e.target)) lastContent = e.target; });
    function restoreContent() { const s = top(); return !!(lastContent && s && s.el.contains(lastContent) && document.body.contains(lastContent) && Focus.focus(lastContent)); }
    sidebar.addEventListener('focusin', () => sidebar.classList.add('is-open'));
    sidebar.addEventListener('focusout', () => sidebar.classList.remove('is-open'));
    Array.prototype.forEach.call(sidebar.querySelectorAll('.sidebar-item'), b => {
      b.setAttribute('tabindex', '-1');
      b.addEventListener('click', () => switchTab(b.getAttribute('data-tab')));
    });
    return { push, back, top, switchTab, restoreContent };
  })();

  /* ---------- key dispatch ---------- */
  document.addEventListener('keydown', e => {
    const action = actionOf(e);
    if (!action) return;
    const overlay = overlays[overlays.length - 1];
    const screen = Router.top();
    const handled = overlay ? overlay.onKey(action, e) : screen && screen.onKey && screen.onKey(action, e);
    if (handled) { e.preventDefault(); return; }
    if (isTyping(e)) return;
    if (!Focus.current() && ['left', 'right', 'up', 'down', 'enter'].indexOf(action) >= 0) {
      // Focus was lost (its element re-rendered away): land back inside the active layer.
      e.preventDefault();
      Focus.first('[data-autofocus]', overlay ? undefined : screen.el.parentNode);
      return;
    }
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') { e.preventDefault(); Focus.move(action); }
    else if (action === 'enter') { const el = Focus.current(); if (el && el.tagName !== 'INPUT') { e.preventDefault(); el.click(); } }
    else if (action === 'back') { e.preventDefault(); if (!overlay) Router.back(); }
  });

  /* ---------- boot ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'), el => el.parentNode.replaceChild(icon(el.getAttribute('data-icon')), el));
  // The UI is laid out for 1920×1080; scale it to fit other window sizes (desktop preview).
  function fit() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.getElementById('app').style.transform = Math.abs(scale - 1) < 0.01 ? '' : 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);
  fit();
  registerKeys();
  Router.switchTab('browse');
  setInterval(() => { if (!document.hidden) Store.refresh(); }, 30000);
  window.addEventListener('online', () => Store.refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Store.refresh(); });
  Store.refresh();
})();
