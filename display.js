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
  return 'SIMULATION IN PROGRESS';
}
function blockKpi(title,value,sub,kind=''){
  return '<div class="kpi '+kind+'"><span class="kpi-label">'+escapeHtml(title)+'</span><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub)+'</small></div>';
}
function render(data){
  const room=data.room||{},results=data.results||[],players=data.players||[];
  const ready=players.filter(p=>p.ready).length;
  const latest=results.at(-1);
  const progress=Math.min(100,Math.round(ready/7*100));
  const completed=room.status==='completed';
  const resultByRound=new Map(results.map(r=>[Number(r.round),r]));
  const kpis=
    blockKpi('BUSINESS CONTINUITY',String(room.business_continuity??'—'),'AFTER LAST COMPLETED ROUND','kpi-bc')+
    blockKpi('CASH REMAINING','฿'+money(room.cash_remaining),'CONFIRMED AFTER ROUND LOCK','kpi-cash')+
    blockKpi('CURRENT ROUND',room.current_round?room.current_round+' / 4':'— / 4','SCENARIO SET '+(room.scenario_set??'—'),'kpi-round')+
    blockKpi('TIME REMAINING','<timer>','LIVE ROUND CLOCK','kpi-time');
  const timed=kpis.replace('&lt;timer&gt;','<span id="mainTimer">--:--</span>');
  const archive=[1,2,3,4].map(n=>{
    const r=resultByRound.get(n);
    if(!r){
      const current=Number(room.current_round)===n&&room.status==='playing';
      return '<div class="archive-round '+(current?'archive-current':'archive-future')+'"><div class="archive-round-top"><span>ROUND '+n+'</span><b>'+(current?'IN PROGRESS':'PENDING')+'</b></div><div class="archive-wait">'+(current?'กำลังดำเนินรอบนี้ · ผลจะแสดงเมื่อ Lock':'รอผลสรุปของรอบนี้')+'</div></div>';
    }
    return '<div class="archive-round archive-complete"><div class="archive-round-top"><span>ROUND '+n+'</span><b>COMPLETED</b></div><div class="archive-score"><div><small>BC AFTER</small><strong>'+Number(r.bc_after)+'</strong></div><div><small>BC LOSS</small><strong class="score-loss">−'+Number(r.bc_loss)+'</strong></div></div><div class="archive-cash"><small>CASH USED</small><strong>฿'+money(r.cash_used)+'</strong></div><p>'+escapeHtml(r.outcome||'')+'</p></div>';
  }).join('');
  const mostRecent=latest?
    '<div class="history-outcome"><span>LAST COMPLETED ROUND · '+Number(latest.round)+'</span><h3>'+escapeHtml(latest.outcome||'ROUND COMPLETED')+'</h3><div class="history-outcome-stats"><div><small>BC LOST</small><b>−'+Number(latest.bc_loss)+'</b></div><div><small>CASH SPENT</small><b>฿'+money(latest.cash_used)+'</b></div></div></div>'
    :'<div class="history-outcome waiting-history"><span>LAST COMPLETED ROUND</span><h3>Waiting for Round 1</h3><p>ผลคะแนนและค่าใช้จ่ายจะแสดงหลังจบรอบเท่านั้น</p></div>';
  $('#displayApp').innerHTML=
    '<div class="display-headline"><div><span class="eyebrow">HISTORICAL PERFORMANCE / LIVE ROUND & READINESS</span><h1>'+escapeHtml(statusLabel(room))+'</h1><p>'+escapeHtml(room.title||'BCP Online Playtest')+'</p></div><span class="round-badge '+(completed?'result':'normal')+'">'+escapeHtml(room.status.toUpperCase())+'</span></div>'+
    '<section class="kpi-grid">'+timed+'</section>'+
    '<div class="history-layout"><section class="history-panel"><div class="section-header"><span>ROUND HISTORY</span><small>FINALIZED RESULTS ONLY · NO LIVE ACTION DATA</small></div><div class="archive-grid">'+archive+'</div></section>'+
    '<aside class="history-sidebar"><section class="readiness-panel"><div class="section-header"><span>TEAM READINESS</span><small>'+players.length+' / 7 ROLES</small></div><div class="readiness-count">'+ready+'<span> / 7 READY</span></div><div class="readiness-track"><div style="width:'+progress+'%"></div></div><div class="readiness-hint">'+(completed?'Simulation completed':room.status==='lobby'?'Waiting for session':ready===7?'All players are ready':'Awaiting players to confirm readiness')+'</div></section>'+mostRecent+
    '<div class="history-policy"><span class="policy-dot"></span><div><strong>TEAM COLLABORATION MODE</strong><p>ไม่มีการเปิดเผยการตัดสินใจราย Site บนจอกลาง · Cash และ BC อัปเดตเมื่อจบรอบเท่านั้น</p></div></div></aside></div>';
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
