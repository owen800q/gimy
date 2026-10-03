(() => {
  const $=id=>document.getElementById(id);
  const emit=(name,detail)=>document.dispatchEvent(new CustomEvent(name,{detail}));
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
  const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  let token=read('gimy-profile',null);if(!/^[a-f0-9]{32}$/.test(token||'')){token=newToken();write('gimy-profile',token);}
  let entries=read('gimy-history:'+token,{}),pulling=null,sending=null;
  const announce=()=>{write('gimy-history:'+token,entries);emit('gimy:history-updated');};
  const syncStatus=text=>{$('sync-status').textContent=text;};
  // Local storage is only an offline outbox; the Durable Object holds the shared history.
  function send(){
    if(sending)return sending;const profile=token;
    sending=(async()=>{
      try{
        for(;;){
          const local=Object.values(entries).find(x=>x.dirty);if(!local||profile!==token)break;
          const stamp=local.localStamp;const {dirty,localStamp,updatedAt,...body}=local;
          const response=await fetch('/api/history',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+profile},body:JSON.stringify(body),keepalive:true,signal:AbortSignal.timeout(8000)});
          const data=await response.json();if(profile!==token)return;
          if(!response.ok&&response.status!==409)throw new Error(data.error||'同步暫時無法使用');
          if(!data.entry)throw new Error('Missing progress');
          const current=entries[local.episodeId];
          if(response.status===409||current?.localStamp===stamp)entries[local.episodeId]={...data.entry,dirty:false};
          else if(current)current.revision=data.entry.revision;
          announce();
        }
        syncStatus('觀看紀錄已儲存至雲端');return true;
      }catch{syncStatus('暫存於此裝置，連線恢復後再同步');return false;}
    })().finally(()=>{sending=null;});return sending;
  }
  async function refresh(){
    if(pulling)return pulling;
    const profile=token;
    pulling=(async()=>{
      try{
        const uploaded=await send();
        const response=await fetch('/api/history',{headers:{Authorization:'Bearer '+profile},signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw new Error('History unavailable');const data=await response.json();if(profile!==token)return;
        for(const remote of data.entries||[]){const local=entries[remote.episodeId];if(!local?.dirty&&(remote.revision>=(local?.revision||0)))entries[remote.episodeId]={...remote,dirty:false};}
        announce();syncStatus(uploaded?'觀看紀錄已儲存至雲端':'仍有紀錄暫存於此裝置，連線恢復後再同步');return uploaded;
      }catch{syncStatus('暫存於此裝置，連線恢復後再同步');return false;}
    })().finally(()=>{pulling=null;});return pulling;
  }
  function save(value){
    const id=String(value.episodeId);const previous=entries[id];
    entries[id]={...value,episodeId:id,revision:previous?.revision||0,updatedAt:Date.now(),localStamp:newToken(),dirty:true};
    const sorted=Object.values(entries).sort((a,b)=>b.updatedAt-a.updatedAt);entries=Object.fromEntries(sorted.slice(0,500).map(x=>[x.episodeId,x]));announce();void send();
  }
  function navigate(values,replace=false){const hash='#'+new URLSearchParams(values);if(location.hash!==hash)history[replace?'replaceState':'pushState'](null,'',hash);}
  const route=()=>new URLSearchParams(location.hash.slice(1));
  const time=value=>{const s=Math.max(0,Math.floor(value||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s%60).padStart(2,'0');};
  async function changeProfile(next){
    if(!/^[a-f0-9]{32}$/.test(next))throw new Error('同步碼應為 32 位英數字。');
    if(!await send())throw new Error('仍有未儲存的紀錄，請連線後重試。');
    if(pulling)await pulling;
    if(!write('gimy-profile',next))throw new Error('瀏覽器無法保存同步碼，請關閉私密模式或允許網站儲存資料。');
    token=next;entries=read('gimy-history:'+token,{});announce();$('sync-code').value=token;
    return refresh();
  }
  window.TVState={route,navigate,time,save,refresh,changeProfile,profile:()=>token,
    all:()=>Object.values(entries).sort((a,b)=>b.updatedAt-a.updatedAt),get:id=>entries[String(id)],
    latest:seriesId=>Object.values(entries).filter(x=>String(x.seriesId)===String(seriesId)).sort((a,b)=>b.updatedAt-a.updatedAt)[0]};

  $('sync-code').value=token;
  const panel=open=>{$('sync-panel').hidden=!open;$('sync-toggle').setAttribute('aria-expanded',String(open));if(open){$('sync-title').focus();void refresh();}else $('sync-toggle').focus();};
  $('sync-toggle').addEventListener('click',()=>panel($('sync-panel').hidden));
  $('sync-close').addEventListener('click',()=>panel(false));
  $('sync-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(token);syncStatus('已複製同步碼');}catch{$('sync-code').select();syncStatus('請手動複製同步碼');}});
  $('sync-form').addEventListener('submit',async e=>{
    e.preventDefault();const next=$('sync-input').value.trim().toLowerCase();
    try{await changeProfile(next);$('sync-input').value='';syncStatus('已切換至另一份觀看紀錄');}catch(error){syncStatus(error.message);}
  });
  setInterval(()=>{if(!document.hidden)void refresh();},30000);
  window.addEventListener('online',()=>void refresh());
  window.addEventListener('focus',()=>void refresh());
  window.addEventListener('hashchange',()=>emit('gimy:route'));
  window.addEventListener('storage',e=>{if(e.key==='gimy-history:'+token){entries=read(e.key,{});emit('gimy:history-updated');}});
  void refresh();
})();
