(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const S=window.TVState;
  let lastHome='view=home&type=2',generation=0,request=null,nextPage=null,type='2',preset='',selected=null,returnFocus=null,detailRequest=null;
  const ids=new Set();
  const FILTERS=['q','area','year','sort'];
  async function json(url,signal){const r=await fetch(url,{signal});if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('影視資料暫時無法讀取。');const data=await r.json();if(!r.ok)throw new Error(data.error||'影視資料暫時無法讀取。');return data;}
  function poster(pic,title){
    const box=document.createElement('div');box.className='show-poster';
    const placeholder=document.createElement('div');placeholder.className='poster-placeholder';placeholder.setAttribute('aria-hidden','true');
    const small=document.createElement('small');small.textContent='GIMY TV';const name=document.createElement('strong');name.textContent=title;placeholder.append(small,name);box.append(placeholder);
    if(pic){const img=document.createElement('img');img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.src=pic;img.addEventListener('error',()=>{img.hidden=true;});box.append(img);}
    return box;
  }
  function card(item){
    const button=document.createElement('button');button.className='show-card';button.dataset.id=item.id;button.setAttribute('aria-label',[item.title,item.status].filter(Boolean).join('，'));
    const box=poster(item.pic,item.title);
    if(item.status){const badge=document.createElement('span');badge.className='poster-badge';badge.textContent=item.status;box.append(badge);}
    const body=document.createElement('div');body.className='show-card-body';
    const title=document.createElement('span');title.className='show-card-title';title.textContent=item.title;
    const meta=document.createElement('span');meta.className='show-card-meta';meta.textContent=item.cast||'';body.append(title,meta);
    button.append(box,body);button.addEventListener('click',()=>{returnFocus=item.id;void openShow(item.id);});
    return button;
  }
  function filters(page){
    const p=new URLSearchParams({view:'home'});
    if(preset)p.set('preset',preset);else p.set('type',type);
    for(const key of FILTERS){const value=$('catalog-'+key).value.trim();if(value)p.set(key,value);}
    if(page>1)p.set('page',page);return p;
  }
  function pressed(){document.querySelectorAll('.catalog-presets .filter-chip').forEach(b=>b.setAttribute('aria-pressed',String(preset?b.dataset.preset===preset:!$('catalog-q').value.trim()&&b.dataset.type===type)));}
  async function load(page=1,updateRoute=true){
    const isHistory=preset==='history';const q=$('catalog-q').value.trim();
    $('watch-history').hidden=!isHistory;$('catalog-grid').hidden=isHistory;$('catalog-form').hidden=isHistory;pressed();
    if(updateRoute)S.navigate(filters(page));
    lastHome=filters(1).toString();
    request?.abort();const id=++generation;
    $('catalog-more').hidden=true;$('catalog-error').hidden=true;$('catalog-retry').hidden=true;
    if(isHistory){renderHistory();void S.refresh();return;}
    request=new AbortController();const signal=request.signal;
    if(page===1){ids.clear();$('catalog-grid').replaceChildren();}
    $('catalog-status').textContent=q?'正在搜尋「'+q+'」…':'正在讀取影視目錄…';
    try{
      const params=new URLSearchParams({type,page});for(const key of ['area','year','sort']){const value=$('catalog-'+key).value;if(value)params.set(key,value);}
      const data=await json(q?'/api/search?q='+encodeURIComponent(q):'/api/catalog?'+params,signal);if(id!==generation)return;
      if(data.years&&$('catalog-year').options.length<2)for(const year of data.years){const o=document.createElement('option');o.value=year;o.textContent=year;$('catalog-year').append(o);}
      for(const item of data.items){if(ids.has(item.id))continue;ids.add(item.id);$('catalog-grid').append(card(item));}
      nextPage=q?null:data.nextPage;$('catalog-more').hidden=!nextPage;
      $('catalog-status').textContent=q?(ids.size?'找到 '+ids.size+' 套與「'+q+'」相關的影片':'找不到「'+q+'」。請用繁體中文劇名再試。'):(ids.size?(data.heading||'影視目錄')+' · 已顯示 '+ids.size+' 套':'未找到符合條件的影片，試下其他篩選。');
    }catch(e){if(signal.aborted||id!==generation)return;$('catalog-status').textContent='未能載入目錄';$('catalog-error').textContent=e.message;$('catalog-error').hidden=false;$('catalog-retry').hidden=false;nextPage=page;}
  }
  function reset(){for(const key of FILTERS)$('catalog-'+key).value='';preset='';}
  document.querySelectorAll('.catalog-presets .filter-chip').forEach(button=>button.addEventListener('click',()=>{reset();if(button.dataset.preset)preset=button.dataset.preset;else type=button.dataset.type;void load();}));
  $('catalog-form').addEventListener('submit',e=>{e.preventDefault();preset='';void load();});
  for(const key of ['area','year','sort'])$('catalog-'+key).addEventListener('change',()=>{$('catalog-q').value='';void load();});
  $('catalog-clear').addEventListener('click',()=>{reset();void load();});
  $('catalog-retry').addEventListener('click',()=>void load(nextPage||1));
  $('catalog-more').addEventListener('click',()=>{if(nextPage)void load(nextPage);});

  function reminder(){
    const last=selected?S.latest(selected):null;
    $('detail-history').textContent=last?'上次觀看：'+last.title+' · '+(last.completed?'已看完':'看到 '+S.time(last.position)):'尚未有觀看紀錄';
  }
  async function openShow(id,updateRoute=true){
    if(updateRoute)S.navigate({view:'detail',id});
    document.dispatchEvent(new CustomEvent('gimy:home'));
    selected=id;detailRequest?.abort();detailRequest=new AbortController();const signal=detailRequest.signal;
    $('home-browser').hidden=true;$('watch-player').hidden=true;$('home-detail').hidden=false;$('home-back').hidden=false;
    $('detail-title').textContent='正在讀取影片…';for(const key of ['facts','people','summary','history'])$('detail-'+key).textContent='';
    $('detail-cover').hidden=true;$('detail-cover').removeAttribute('src');$('detail-source').hidden=true;$('detail-comments').hidden=true;$('detail-episodes').disabled=true;
    window.scrollTo(0,0);$('home-back').focus();
    try{
      const data=await json('/api/detail?id='+id,signal);if(selected!==id)return;
      $('detail-title').textContent=data.title;
      $('detail-facts').textContent=[data.category,data.year,data.area,data.language,data.status].filter(Boolean).join(' · ');
      $('detail-people').textContent=[data.actors&&'主演：'+data.actors,data.director&&'導演：'+data.director].filter(Boolean).join('　');
      $('detail-summary').textContent=data.summary||'暫未有簡介，仍然可以從下方選集播放。';
      if(data.pic){$('detail-cover').src=data.pic;$('detail-cover').hidden=false;}
      $('detail-source').href='https://gimyai.tw/detail/'+id+'.html';$('detail-source').hidden=false;
      $('comments-list').replaceChildren(...data.comments.map(comment=>{
        const row=document.createElement('article');row.className='site-comment';
        const meta=document.createElement('div');meta.className='comment-meta';
        const author=document.createElement('strong');author.textContent=comment.author;const time=document.createElement('span');time.textContent=comment.time;meta.append(author,time);
        const body=document.createElement('p');body.textContent=comment.text;row.append(meta,body);return row;
      }));
      $('detail-comments').hidden=!data.comments.length;
      $('detail-episodes').disabled=!data.routes.length;reminder();
      document.dispatchEvent(new CustomEvent('gimy:open-show',{detail:data}));
    }catch(e){if(!signal.aborted&&selected===id)$('detail-title').textContent=e.message;}
  }
  $('detail-cover').addEventListener('error',()=>{$('detail-cover').hidden=true;});
  $('detail-episodes').addEventListener('click',()=>{const target=document.querySelector('.episode-button:not(:disabled)');target?.focus();target?.scrollIntoView({block:'center'});});

  function renderHistory(){
    const rows=S.all();$('watch-history').replaceChildren();
    $('catalog-status').textContent=rows.length?'共 '+rows.length+' 項觀看紀錄':'未有觀看紀錄。播放影片後會自動儲存；其他裝置可用「裝置同步」接住睇。';
    for(const entry of rows){
      const row=document.createElement('article');row.className='history-row';
      const title=document.createElement('h3');title.textContent=entry.title;
      const meta=document.createElement('p');meta.textContent=(entry.completed?'已看完':'看到 '+S.time(entry.position)+' / '+S.time(entry.duration))+' · '+new Date(entry.updatedAt).toLocaleString('zh-HK');
      const bar=document.createElement('progress');bar.max=entry.duration;bar.value=entry.position;bar.setAttribute('aria-label','觀看進度');
      const play=document.createElement('button');play.className='tv-button';play.textContent=entry.completed?'重新觀看':'繼續觀看';play.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('gimy:watch',{detail:entry})));
      const more=document.createElement('button');more.className='tv-button outline';more.textContent='全部集數';more.addEventListener('click',()=>void openShow(entry.seriesId));
      const actions=document.createElement('div');actions.className='history-actions';actions.append(play,more);
      row.append(title,meta,bar,actions);$('watch-history').append(row);
    }
  }
  document.addEventListener('gimy:history-updated',()=>{reminder();if(preset==='history'&&!$('home-browser').hidden)renderHistory();});

  let routeGeneration=0;
  function restoreRoute(){
    const p=S.route();const view=p.get('view')||'home';++routeGeneration;
    if(view==='watch')return;
    if(view==='detail'&&/^\d{1,10}$/.test(p.get('id')||'')){if(selected!==p.get('id')||$('home-detail').hidden)void openShow(p.get('id'),false);return;}
    document.dispatchEvent(new CustomEvent('gimy:home'));
    selected=null;detailRequest?.abort();
    $('watch-player').hidden=true;$('home-detail').hidden=true;$('home-browser').hidden=false;$('home-back').hidden=true;
    preset=p.get('preset')==='history'?'history':'';
    type=/^\d{1,3}$/.test(p.get('type')||'')?p.get('type'):'2';
    for(const key of FILTERS){
      const el=$('catalog-'+key),value=p.get(key)||'';
      if(el.tagName==='SELECT'&&value&&![...el.options].some(o=>o.value===value)){const o=document.createElement('option');o.value=value;o.textContent=value;el.append(o);}el.value=value;
    }
    void load(Math.max(1,Math.min(500,Number(p.get('page'))||1)),false).then(()=>{
      const card=returnFocus&&$('catalog-grid').querySelector('[data-id="'+returnFocus+'"]');returnFocus=null;
      if(card){card.focus();card.scrollIntoView({block:'center'});}
    });
  }
  $('home-back').addEventListener('click',()=>{
    const p=S.route();
    if(p.get('view')==='watch'&&p.get('id')){S.navigate({view:'detail',id:p.get('id')});void openShow(p.get('id'),false);return;}
    S.navigate(lastHome);restoreRoute();
  });
  document.addEventListener('gimy:route',restoreRoute);
  document.dispatchEvent(new CustomEvent('gimy:route'));
})();
