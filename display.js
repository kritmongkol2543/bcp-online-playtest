import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
});
const $=s=>document.querySelector(s);
const escapeHtml=(value='')=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const money=n=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:0}).format(Number(n||0));
const names={HO:'HEAD OFFICE',PPD:'PHRA PRADAENG',NKL:'NAKHON LUANG'};
const EVENT_NAMES={
  action_played:'ACTION PLACED',
  action_removed:'ACTION REMOVED',
  deck_reordered:'ORDER UPDATED',
  twist_revealed:'CRISIS UPDATE',
  round_locked:'ROUND COMPLETE',
  solo_all_ready:'ALL READY',
  game_started:'SIMULATION STARTED',
  game_paused:'SIMULATION PAUSED',
  game_resumed:'SIMULATION RESUMED'
};
const sessionKey='bcp_central_display_v1';
const hash=new URLSearchParams(location.hash.slice(1));
if(hash.get('room')&&hash.get('token')){
  sessionStorage.setItem(sessionKey,JSON.stringify({room:hash.get('room'),token:hash.get('token')}));
  // Do not leave the bearer capability in the projector browser address bar/history.
  history.replaceState(null,'',location.pathname);
}
let auth=null;
try{auth=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{}
if(!auth?.room||!auth?.token||!/^[0-9a-f]{64}$/.test(auth.token)){
  auth=null;
}
let snapshot=null;
let lastSignature='';
let serverOffset=0;
let lastSuccess=0;
let requesting=false;
let stopped=false;
let channel=null;
const status=$('#syncStatus');
const syncLabel=(label,cls='')=>{
  status.className='sync-state '+cls;
  status.innerHTML='<span class="status-dot"></span> '+escapeHtml(label);
};
const dateLabel=value=>{
  if(!value)return '—';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
};
function timerString(){
  if(!snapshot)return '--:--';
  const room=snapshot.room;
  if(room.status==='lobby')return 'STANDBY';
  if(room.status==='closed')return 'CLOSED';
  if(room.status==='completed')return 'FINISHED';
  if(room.paused_at)return 'PAUSED';
  if(!room.round_ends_at)return '--:--';
  const ms=new Date(room.round_ends_at).getTime()-Date.now()-serverOffset;
  const remaining=Math.max(0,Math.ceil(ms/1000));
  return String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
}
function statusLabel(room){
  if(room.status==='closed')return 'SESSION CLOSED';
  if(room.status==='completed')return Number(room.business_continuity)<=0?'MISSION FAILED':'SIMULATION COMPLETE';
  if(room.status==='lobby')return 'WAITING FOR PLAYERS';
  if(room.paused_at)return 'PAUSED';
  return room.twist_revealed?'CRISIS UPDATE ACTIVE':'LIVE SIMULATION';
}
function blockKpi(title,value,sub,kind=''){
  return '<div class="kpi '+kind+'"><span class="kpi-label">'+escapeHtml(title)+'</span><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub)+'</small></div>';
}
function siteHtml(site,actions){
  const siteActions=actions.filter(a=>a.site===site);
  const chps=[...new Set(siteActions.map(a=>a.chp_code))];
  const limit=4;
  const items=siteActions.slice(0,limit).map((a,i)=>
    '<div class="site-action"><b>'+escapeHtml(a.chp_code)+'</b><span>'+escapeHtml(a.title)+'</span></div>'
  ).join('');
  const extra=siteActions.length>limit?'<div class="site-more">+'+(siteActions.length-limit)+' MORE ACTIONS</div>':'';
  return '<section class="site-board"><div class="site-heading"><div><span class="site-mark"></span><h3>'+site+'</h3><small>'+names[site]+'</small></div><strong>'+siteActions.length+' <small>ACTIONS</small></strong></div>'+
    '<div class="chp-tags">'+(chps.length?chps.map(c=>'<span>'+escapeHtml(c)+'</span>').join(''):'<span class="empty-chp">NO ACTIONS YET</span>')+'</div>'+
    '<div class="site-actions">'+(items||'<div class="no-cards">รอการตัดสินใจของทีม</div>')+extra+'</div></section>';
}
function eventHtml(event){
  const name=EVENT_NAMES[event.type]||'UPDATE';
  const danger=event.type==='twist_revealed';
  const desc=[event.site,event.chp,event.title].filter(Boolean).join(' · ');
  return '<div class="event-row '+(danger?'event-danger':'')+'"><span class="event-dot"></span><div class="event-copy"><strong>'+escapeHtml(name)+'</strong>'+
   (desc?'<span>'+escapeHtml(desc)+'</span>':'')+
   (event.role?'<small>'+escapeHtml(event.role)+'</small>':'')+
   '</div><time>'+dateLabel(event.at)+'</time></div>';
}
function render(data){
  const room=data.room||{},results=data.results||[],players=data.players||[],actions=data.actions||[];
  const complete=room.status==='completed';
  const ready=players.filter(p=>p.ready).length;
  const progress=players.length?Math.min(100,Math.round(ready/7*100)):0;
  const latest=results.at(-1);
  const story=data.story||{};
  const original=story.big_story||'รอเริ่ม Simulation';
  const excerpt=original.length>680?original.slice(0,680).trimEnd()+'…':original;
  const twist=room.twist_revealed&&story.twist_story;
  const banner=twist?'<div class="twist-banner"><div><span>CRISIS UPDATE</span><h3>เหตุการณ์ใหม่เกิดขึ้น</h3></div><p>'+escapeHtml(String(story.twist_story).slice(0,310))+(String(story.twist_story).length>310?'…':'')+'</p></div>':'';
  const allEvents=(data.events||[]).slice(0,8);
  const kpis=
    blockKpi('BUSINESS CONTINUITY',String(room.business_continuity??'—'),'/ 100 POINTS','kpi-bc')+
    blockKpi('CASH AVAILABLE','฿'+money(room.cash_available??room.cash_remaining),'RESERVED ฿'+money(room.cash_reserved??0)+' · COMMITTED ฿'+money(room.cash_committed??room.cash_remaining),'kpi-cash')+
    blockKpi('ROUND',room.current_round?room.current_round+' / 4':'— / 4','SCENARIO SET '+(room.scenario_set??'—'),'kpi-round')+
    blockKpi('TIME REMAINING','<timer>','AUTO-SYNCED CLOCK','kpi-time');
  // Use the timer as a normal DOM element, not injected through escaped KPI content.
  const timed=kpis.replace('&lt;timer&gt;','<span id="mainTimer">--:--</span>');
  const stage=complete?'result':room.twist_revealed?'twist':'normal';
  $('#displayApp').innerHTML=
    '<div class="display-headline"><div><span class="eyebrow">TEAM-WIDE LIVE OVERVIEW</span><h1>'+escapeHtml(statusLabel(room))+'</h1><p>'+escapeHtml(room.title||'BCP Online Playtest')+'</p></div><span class="round-badge '+stage+'">'+escapeHtml(room.status.toUpperCase())+'</span></div>'+
    '<section class="kpi-grid">'+timed+'</section>'+
    '<div class="display-main"><div class="display-primary"><div class="scenario-panel"><div class="section-header"><span>01 / GLOBAL SITUATION</span><small>INFORMATION SHARED WITH ALL ROLES</small></div><p>'+escapeHtml(excerpt).replace(/\n/g,'<br>')+'</p></div>'+
    banner+
    '<section class="sites"><div class="section-header"><span>02 / TEAM RESPONSE</span><small>ONLY PLACED ACTIONS ARE VISIBLE</small></div><div class="site-grid">'+['HO','PPD','NKL'].map(s=>siteHtml(s,actions)).join('')+'</div></section></div>'+
    '<aside class="display-aside"><div class="readiness-panel"><div class="section-header"><span>TEAM READINESS</span><small>'+players.length+' / 7 ROLES</small></div><div class="readiness-count">'+ready+'<span> / 7 READY</span></div><div class="readiness-track"><div style="width:'+progress+'%"></div></div><p>'+ (complete?'Simulation complete':room.status==='lobby'?'Waiting for room to start':ready===7?'Team ready to lock': 'Waiting for team decisions') +'</p></div>'+
    (latest?'<div class="outcome-panel"><div class="section-header"><span>LAST ROUND RESULT</span><small>ROUND '+latest.round+'</small></div><div class="outcome-numbers"><div><small>BC LOSS</small><strong>−'+latest.bc_loss+'</strong></div><div><small>CASH USED</small><strong>฿'+money(latest.cash_used)+'</strong></div></div><p>'+escapeHtml(latest.outcome||'')+'</p></div>':'')+
    '<div class="events-panel"><div class="section-header"><span>LIVE EVENT FEED</span><small>LAST '+allEvents.length+' EVENTS</small></div><div class="event-list">'+(allEvents.length?allEvents.map(eventHtml).join(''):'<div class="no-events">Waiting for events…</div>')+'</div></div></aside></div>';
  $('#roomCode').textContent='ROOM '+(room.code||'—');
  tick();
}
function tick(){
  $('#localClock').textContent=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const label=$('#mainTimer');
  if(label)label.textContent=timerString();
  if(snapshot?.room?.status==='playing'){
    const remain=timerString();
    label?.classList.toggle('urgent',remain!=='PAUSED'&&remain.startsWith('00:'));
  }
  if(lastSuccess&&Date.now()-lastSuccess>11000&&!stopped)syncLabel('RECONNECTING','offline');
}
async function load(){
  if(!auth||stopped||requesting)return;
  requesting=true;
  try{
    const {data,error}=await sb.rpc('bcp_web_get_display_state',{
      p_room_id:auth.room,p_display_token:auth.token
    });
    if(error)throw error;
    if(!data?.room)throw new Error('DISPLAY_STATE_UNAVAILABLE');
    lastSuccess=Date.now();
    serverOffset=new Date(data.server_now).getTime()-Date.now();
    syncLabel('LIVE · 3 SEC','online');
    const {server_now,...rest}=data;
    const sig=JSON.stringify(rest);
    snapshot=data;
    if(sig!==lastSignature){lastSignature=sig;render(data);}
    tick();
    if(data.room.status==='closed'){
      stopped=true;
      syncLabel('ROOM CLOSED','offline');
    }
  }catch(e){
    const msg=String(e.message||e);
    if(msg.includes('DISPLAY_ACCESS_DENIED')||msg.includes('INVALID_DISPLAY_TOKEN')||msg.includes('ROOM_NOT_FOUND')){
      stopped=true;
      sessionStorage.removeItem(sessionKey);
      syncLabel('ACCESS EXPIRED','offline');
      $('#displayApp').innerHTML='<div class="loading error-view"><h1>DISPLAY ACCESS EXPIRED</h1><p>ผู้ดูแลห้องได้ปิดหรือเปลี่ยนสิทธิ์หน้าจอ กรุณาเปิด Central Display ใหม่จากหน้า Admin</p></div>';
    }else{
      syncLabel('RECONNECTING','offline');
    }
  }finally{
    requesting=false;
  }
}
$('#fullscreenBtn').addEventListener('click',async()=>{
  try{
    if(document.fullscreenElement){
      await document.exitFullscreen();
    }else{
      await document.documentElement.requestFullscreen();
    }
  }catch(e){console.warn('Fullscreen unavailable',e);}
});
document.addEventListener('fullscreenchange',()=>{
  $('#fullscreenBtn').textContent=document.fullscreenElement?'⤢ EXIT FULLSCREEN':'⛶ FULLSCREEN';
});
window.addEventListener('online',()=>load());
if(auth){
  load();
  setInterval(load,3000);
  setInterval(tick,250);
}else{
  stopped=true;
  syncLabel('NO ACCESS','offline');
  $('#displayApp').innerHTML='<div class="loading error-view"><h1>CENTRAL DISPLAY</h1><p>เปิดหน้านี้ผ่านปุ่ม CENTRAL DISPLAY ในห้องเกมของ Admin เพื่อรับสิทธิ์ดูภาพรวม</p></div>';
}
