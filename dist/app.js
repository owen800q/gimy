(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const S=window.TVState;
  const video=$('video');
  let show=null,currentSid=null,playback=null,hls=null,request=null,generation=0,busy=false,requested=null;
  let watchArmed=false,pendingResume=null,lastSavedAt=0,lastRecorded='',showRequest=null;
  const status=text=>{$('status').textContent=text;};
  const error=text=>{$('error').textContent=text;$('error').hidden=!text;};
  const episodeKey=(id,nid)=>id+'-'+nid;
  const routeOf=sid=>show?.routes.find(r=>r.sid===sid);
  const labelOf=(sid,nid)=>routeOf(sid)?.episodes.find(e=>e.nid===nid)?.label||'第 '+nid+' 集';
  async function json(url,signal){const r=await fetch(url,{signal});if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('服務暫時無法使用。');const data=await r.json();if(!r.ok){const e=new Error(data.error||'讀取失敗。');e.status=r.status;throw e;}return data;}

  function saveProgress(){
    if(!playback||!watchArmed||pendingResume||!Number.isFinite(video.duration)||video.duration<=0)return;
    lastSavedAt=Date.now();
    const fingerprint=[playback.id,playback.nid,Math.floor(video.currentTime*10),video.ended].join(':');
    if(fingerprint===lastRecorded)return;lastRecorded=fingerprint;
    S.save({episodeId:episodeKey(playback.id,playback.nid),seriesId:playback.id,sid:playback.sid,title:playback.label,seriesTitle:playback.title,position:video.currentTime,duration:video.duration,completed:video.ended});
  }
  function restorePosition(){
    if(!pendingResume||!Number.isFinite(video.duration)||video.duration<=0)return;
    const saved=pendingResume;pendingResume=null;
    video.currentTime=saved.completed?0:Math.min(saved.position,Math.max(0,video.duration-0.25));
    $('resume-status').hidden=false;$('resume-status').textContent=saved.completed?'本集已看完，從頭播放。':'已接續上次進度 '+S.time(video.currentTime);
  }
  function detach(){
    if(hls){hls.destroy();hls=null;}
    video.pause();video.removeAttribute('src');video.load();
  }
  // Samsung TVs and Safari play HLS natively; other browsers use hls.js over Media Source Extensions.
  function attach(data){
    detach();
    if(data.type==='hls'&&!video.canPlayType('application/vnd.apple.mpegurl')&&window.Hls?.isSupported()){
      hls=new window.Hls({enableWorker:false,maxBufferLength:30});
      hls.on(window.Hls.Events.ERROR,(_,detail)=>{
        if(!detail.fatal)return;
        if(detail.type===window.Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();return;}
        status('播放失敗');error('此線路的影片暫時無法載入，請按「重新載入」或在下方改選其他線路。');
      });
      hls.loadSource(data.media);hls.attachMedia(video);
    } else {video.src=data.media;video.load();}
  }
  function stop(){saveProgress();watchArmed=false;pendingResume=null;generation++;request?.abort();detach();playback=null;controls(false);if(document.fullscreenElement)void document.exitFullscreen?.().catch(()=>{});}
  function controls(loading){
    busy=loading;
    ['play','fullscreen'].forEach(id=>{$(id).disabled=busy||!playback;});
    $('reload').disabled=busy||!requested;
    $('previous').disabled=busy||!playback?.previous;
    $('next').disabled=busy||!playback?.next;
    document.querySelectorAll('.episode-button,.route-button').forEach(button=>{button.disabled=busy;});
  }

  function renderPicker(){
    $('episode-picker').hidden=!show;
    if(!show)return;
    $('series-title').textContent=show.title;
    $('routes').replaceChildren(...show.routes.map(route=>{
      const button=document.createElement('button');button.className='tv-button outline route-button';button.dataset.sid=route.sid;
      button.textContent=route.name+(route.direct===false?'（可能不支援）':'');
      button.setAttribute('aria-pressed',String(route.sid===currentSid));button.disabled=busy;
      button.addEventListener('click',()=>{currentSid=route.sid;renderPicker();$('routes').querySelector('[aria-pressed=true]')?.focus();});
      return button;
    }));
    const route=routeOf(currentSid);
    $('episodes').replaceChildren(...(route?.episodes||[]).map(episode=>{
      const button=document.createElement('button');button.className='episode-button';button.dataset.nid=episode.nid;button.disabled=busy;
      const label=document.createElement('span');label.textContent=episode.label;
      const note=document.createElement('small');button.append(label,note);
      button.addEventListener('click',()=>void prepare(show.id,currentSid,episode.nid));
      return button;
    }));
    $('episodes-status').textContent=show.routes.length?'共 '+show.routes.length+' 條線路 · 此線路 '+(route?.episodes.length||0)+' 集 · 選好後按播放':'原站暫未提供可播放的集數。';
    $('episodes-error').hidden=true;$('episodes-retry').hidden=true;
    markEpisodes();
  }
  function markEpisodes(){
    document.querySelectorAll('.episode-button').forEach(button=>{
      const nid=Number(button.dataset.nid);const current=playback&&playback.nid===nid&&playback.sid===currentSid;
      if(current)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
      const saved=show&&S.get(episodeKey(show.id,nid));
      button.lastElementChild.textContent=[current?'正在觀看':'',saved?(saved.completed?'已看完':'看到 '+S.time(saved.position)):''].filter(Boolean).join(' · ');
      let bar=button.querySelector('progress');if(saved){if(!bar){bar=document.createElement('progress');button.insertBefore(bar,button.lastElementChild);}bar.max=saved.duration;bar.value=saved.position;bar.setAttribute('aria-label','觀看進度');}
    });
  }
  async function loadShow(id){
    if(show?.id===id)return show;
    showRequest?.abort();showRequest=new AbortController();
    $('episode-picker').hidden=false;$('series-title').textContent='正在讀取集數…';$('episodes').replaceChildren();$('routes').replaceChildren();
    $('episodes-status').textContent='正在讀取集數…';$('episodes-error').hidden=true;$('episodes-retry').hidden=true;
    try{show=await json('/api/detail?id='+id,showRequest.signal);return show;}
    catch(e){if(showRequest.signal.aborted)throw e;$('episodes-status').textContent='';$('episodes-error').textContent=e.message;$('episodes-error').hidden=false;$('episodes-retry').hidden=false;$('episodes-retry').dataset.id=id;throw e;}
  }
  function pickRoute(preferred){
    const saved=S.latest(show.id);
    currentSid=[preferred,saved?.sid].find(sid=>routeOf(sid))??show.routes[0]?.sid??null;
  }

  // A route that needs the source site's parser is skipped automatically in favour of the next route carrying the same episode.
  async function prepare(id,sid,nid,opts={}){
    saveProgress();watchArmed=false;pendingResume=null;requested={id,sid,nid};
    if(opts.route!==false)S.navigate({view:'watch',id,sid,nid});
    $('home-browser').hidden=true;$('home-detail').hidden=true;$('watch-player').hidden=false;$('home-back').hidden=false;
    $('watch-player').after($('episode-picker'));
    const run=++generation;request?.abort();request=new AbortController();const signal=request.signal;
    detach();playback=null;$('play').textContent='▶ 播放';controls(true);error('');$('empty').hidden=false;$('resume-status').hidden=true;
    $('empty-title').textContent='正在準備你的影片';$('empty-description').textContent='取得播放資料';$('title').textContent='準備影片中';$('source').hidden=true;
    status('正在準備影片…');
    const sync=S.refresh();
    try{
      await loadShow(id);if(run!==generation)return;
      if(!routeOf(sid))sid=show.routes.find(r=>r.episodes.some(e=>e.nid===nid))?.sid??sid;
      currentSid=sid;renderPicker();
      const tried=opts.tried||new Set();tried.add(sid);
      let data;
      try{data=await json('/api/resolve?id='+id+'&sid='+sid+'&nid='+nid,signal);}
      catch(e){
        const fallback=e.status===422&&show.routes.find(r=>!tried.has(r.sid)&&r.direct!==false&&r.episodes.some(ep=>ep.nid===nid));
        if(fallback&&run===generation){status('此線路不支援，改用「'+fallback.name+'」…');return prepare(id,fallback.sid,nid,{tried,route:false});}
        throw e;
      }
      await sync;if(run!==generation)return;
      if(currentSid!==sid||S.route().get('sid')!==String(sid))S.navigate({view:'watch',id,sid,nid},true);
      playback={...data,label:show.title+' '+labelOf(sid,nid),title:show.title};
      pendingResume=S.get(episodeKey(id,nid))||null;
      attach(data);$('empty').hidden=true;
      $('title').textContent=playback.label+' · '+(routeOf(sid)?.name||'');$('source').href=data.source;$('source').hidden=false;
      status('影片已準備好，請按播放');markEpisodes();
      controls(false);$('play').focus();
      return {state:'ready'};
    }catch(e){
      if(signal.aborted||run!==generation)return;
      error(e.message||'連線失敗，請重試。');status('未能載入');$('empty-title').textContent='暫時未能載入';$('empty-description').textContent='請查看下方的錯誤提示，或改選其他線路';
      return {state:'error',message:e.message};
    }finally{if(run===generation){controls(false);if(!playback)$('reload').focus();}}
  }
  async function toggle(){
    if(!playback||$('watch-player').hidden)return;
    if(!video.paused){video.pause();return;}
    try{await video.play();}catch(e){error(e.name==='NotAllowedError'?'請再按一次播放鍵，允許電視開始播放。':'電視未能開始播放，可按「重新載入」或改選其他線路。');}
  }
  async function fullscreen(){
    const screen=$('screen');
    try{
      if(document.fullscreenElement||document.webkitFullscreenElement)await (document.exitFullscreen||document.webkitExitFullscreen).call(document);
      else await (screen.requestFullscreen||screen.webkitRequestFullscreen).call(screen);
    }catch{video.webkitEnterFullscreen?.();}
  }
  const step=direction=>{const target=playback?.[direction];if(target)void prepare(playback.id,target.sid,target.nid);};
  $('play').addEventListener('click',()=>void toggle());
  $('reload').addEventListener('click',()=>{if(requested)void prepare(requested.id,requested.sid,requested.nid,{route:false});});
  $('fullscreen').addEventListener('click',()=>void fullscreen());
  $('previous').addEventListener('click',()=>step('previous'));
  $('next').addEventListener('click',()=>step('next'));
  $('episodes-retry').addEventListener('click',()=>{const id=$('episodes-retry').dataset.id;if(id)void loadShow(id).then(()=>{pickRoute(currentSid);renderPicker();}).catch(()=>{});});
  video.addEventListener('playing',()=>{restorePosition();watchArmed=true;lastSavedAt=Date.now();status('播放中');$('play').textContent='❚❚ 暫停';error('');});
  video.addEventListener('pause',()=>{saveProgress();if(playback)status('已暫停');$('play').textContent='▶ 播放';});
  video.addEventListener('waiting',()=>{if(playback)status('緩衝中…');});
  video.addEventListener('canplay',()=>{if(playback)status(video.paused?'可以播放':'播放中');});
  video.addEventListener('ended',()=>{saveProgress();status('本集播放完畢');$('play').textContent='▶ 播放';if(playback?.next)$('next').focus();});
  video.addEventListener('error',()=>{if(playback&&!hls){status('播放失敗');error('影片未能播放（'+(video.error?.code||'未知')+'），可按「重新載入」或在下方改選其他線路。');}});
  video.addEventListener('loadedmetadata',restorePosition);
  video.addEventListener('durationchange',restorePosition);
  video.addEventListener('timeupdate',()=>{if(Date.now()-lastSavedAt>=15000)saveProgress();});
  video.addEventListener('seeked',saveProgress);
  window.addEventListener('pagehide',saveProgress);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveProgress();else void S.refresh();});
  document.addEventListener('gimy:history-updated',markEpisodes);
  // Samsung remotes: arrow keys move focus spatially; media keys control playback.
  document.addEventListener('keydown',e=>{
    const current=document.activeElement;
    if(current?.matches('input,textarea,select'))return;
    if(e.keyCode===10252||e.key==='MediaPlayPause'||e.code==='Space'&&!current?.matches('button')){e.preventDefault();void toggle();return;}
    if(e.keyCode===415){e.preventDefault();if(video.paused)void toggle();return;}
    if(e.keyCode===19){e.preventDefault();video.pause();return;}
    if(e.keyCode===417||e.key==='MediaFastForward'||e.keyCode===412||e.key==='MediaRewind'){if(playback&&Number.isFinite(video.duration)){e.preventDefault();video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(e.keyCode===417||e.key==='MediaFastForward'?30:-30)));}return;}
    if((e.key==='Escape'||e.keyCode===10009)&&document.fullscreenElement){e.preventDefault();void document.exitFullscreen();return;}
    if(current===video&&['ArrowLeft','ArrowRight'].includes(e.key)&&Number.isFinite(video.duration)){e.preventDefault();video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(e.key==='ArrowRight'?10:-10)));return;}
    const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const direction=directions[e.key];
    if(!direction||!current||current===document.body)return;
    const rect=current.getBoundingClientRect();const x=rect.x+rect.width/2;const y=rect.y+rect.height/2;
    let best=null;let bestScore=Infinity;
    document.querySelectorAll('button:not(:disabled),input,select,a[href],video').forEach(candidate=>{
      if(candidate===current||candidate.closest('[hidden]'))return;
      const r=candidate.getBoundingClientRect();if(!r.width||!r.height)return;
      const dx=r.x+r.width/2-x,dy=r.y+r.height/2-y;const forward=dx*direction[0]+dy*direction[1];
      if(forward<=1)return;const score=forward+Math.abs(dx*direction[1]-dy*direction[0])*3;
      if(score<bestScore){best=candidate;bestScore=score;}
    });
    if(best){e.preventDefault();best.focus();best.scrollIntoView({block:'nearest',inline:'nearest'});}
  });
  document.addEventListener('gimy:open-show',e=>{
    stop();requested=null;show=e.detail;pickRoute();
    $('detail-comments').before($('episode-picker'));renderPicker();
  });
  document.addEventListener('gimy:home',()=>{stop();showRequest?.abort();$('episode-picker').hidden=true;});
  document.addEventListener('gimy:watch',e=>void prepare(e.detail.seriesId,e.detail.sid,Number(e.detail.episodeId.split('-')[1])));
  document.addEventListener('gimy:route',()=>{
    const p=S.route();
    if(p.get('view')!=='watch')return;
    const [id,sid,nid]=['id','sid','nid'].map(k=>p.get(k)||'');
    if(!/^\d{1,10}$/.test(id)||!/^\d{1,5}$/.test(sid)||!/^\d{1,5}$/.test(nid))return;
    if(playback&&playback.id===id&&playback.sid===Number(sid)&&playback.nid===Number(nid))return;
    void prepare(id,Number(sid),Number(nid),{route:false});
  });
})();
