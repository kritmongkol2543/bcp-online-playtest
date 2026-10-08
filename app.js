import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
});

const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const esc = (v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('th-TH').format(Number(n||0));
const ROLE_LABEL = {
  CMC:'CMC',
  CMD_HO:'CMD · HO', CMD_PPD:'CMD · PPD', CMD_NKL:'CMD · NKL',
  CMT_HO:'CMT/LRTs · HO', CMT_PPD:'CMT/LRTs · PPD', CMT_NKL:'CMT/LRTs · NKL'
};
const ROLES = Object.keys(ROLE_LABEL);
const STORE='bcp_online_playtest_session_v1';

let session = JSON.parse(localStorage.getItem(STORE)||'null');
let state = null;
let channel = null;
let clockTimer = null;
let refreshTimer = null;
let heartbeatTimer = null;
let busy = false;
let selectedCard = null;
let selectedChp = null;
let serverOffsetMs = 0;
let connectionState = navigator.onLine ? 'connecting' : 'offline';
let pendingRequests = 0;
let clockActionPending=false;

function saveSession(v){ session=v; v?localStorage.setItem(STORE,JSON.stringify(v)):localStorage.removeItem(STORE); }
function requestStarted(){
  pendingRequests++;
  document.body.classList.add('network-busy');
}
function requestFinished(){
  pendingRequests=Math.max(0,pendingRequests-1);
  if(!pendingRequests) document.body.classList.remove('network-busy');
}
function setButtonBusy(btn,on,label='กำลังทำงาน…'){
  if(!btn)return;
  if(on){
    if(btn.dataset.busy==='1')return;
    btn.dataset.busy='1';
    btn.dataset.oldHtml=btn.innerHTML;
    btn.disabled=true;
    btn.innerHTML='<span class="btn-spinner" aria-hidden="true"></span><span>'+esc(label)+'</span>';
  }else{
    if(btn.dataset.busy!=='1')return;
    btn.disabled=false;
    btn.innerHTML=btn.dataset.oldHtml||btn.innerHTML;
    delete btn.dataset.busy;
    delete btn.dataset.oldHtml;
  }
}
async function withButtonBusy(btn,label,fn){
  setButtonBusy(btn,true,label);
  try{return await fn();}
  finally{setButtonBusy(btn,false);}
}
function pulseButton(btn){
  if(!btn||btn.disabled)return;
  btn.classList.remove('tap-feedback');
  void btn.offsetWidth;
  btn.classList.add('tap-feedback');
  setTimeout(()=>btn.classList.remove('tap-feedback'),220);
}
function cardSiteType(card){ return String(card?.card_key||'').split(':')[0]||''; }
function cardByKey(key){ return (state?.hand||[]).find(c=>c.card_key===key)||null; }
function chpSort(a,b){ return Number(String(a).replace(/\D/g,''))-Number(String(b).replace(/\D/g,'')); }
function ownedChps(){ return [...new Set((state?.hand||[]).map(c=>c.chp_code))].sort(chpSort); }
function validTargetSites(card,role=state?.me?.role_key){
  if(!card||!role)return [];
  if(role!=='CMC'){
    const site=roleSite(role);
    return site?[site]:[];
  }
  return cardSiteType(card)==='HO'?['HO']:['PPD','NKL'];
}
function adminToken(){ return session?.adminToken||session?.token; }
function hasAdminControl(){ return !!(state?.me?.is_admin||session?.adminToken); }
function roleSite(role=''){ return role.endsWith('_HO')?'HO':role.endsWith('_PPD')?'PPD':role.endsWith('_NKL')?'NKL':null; }
function toast(msg,type=''){ const el=document.createElement('div'); el.className='toast '+type; el.textContent=msg; $('#toast-root').append(el); setTimeout(()=>el.remove(),3600); }
function errText(e){
  return (e?.message||String(e||'Error'))
    .replace('ALL_7_ROLES_REQUIRED','ต้องกำหนด Role ให้ครบ 7 Role ก่อนเริ่ม')
    .replace('ALL_7_PLAYERS_MUST_BE_READY','ต้อง Ready ครบทั้ง 7 Role')
    .replace('ALL_7_ROLES_MUST_BE_ONLINE','Role ครบแล้ว แต่ยังมีผู้เล่น Offline — ให้กลับเข้าเกมหรือเปลี่ยนผู้เล่นก่อนเริ่ม')
    .replace('ADMIN_STILL_ONLINE','Admin เดิมยัง Online อยู่ จึงยังรับสิทธิ์แทนไม่ได้')
    .replace('INSUFFICIENT_CASH','Cash ไม่เพียงพอ')
    .replace('CARD_ALREADY_USED','การ์ดใบนี้ถูกใช้ใน Site นี้แล้ว')
    .replace('ADMIN_REQUIRED','เฉพาะ Admin เท่านั้น')
    .replace('ROLE_REQUIRED','ยังไม่ได้รับ Role')
    .replace('SITE_ROLE_REQUIRED','Role นี้จัดการ Deck ของ Site นี้ไม่ได้')
    .replace('GAME_NOT_PLAYING','เกมยังไม่ได้เริ่ม')
    .replace('GAME_ALREADY_STARTED','เกมเริ่มแล้ว ห้องปิดรับผู้เล่นใหม่')
    .replace('ROOM_CLOSED','ห้องนี้ปิดแล้ว')
    .replace('DISPLAY_NAME_TAKEN','ชื่อนี้มีผู้ใช้อยู่ในห้องแล้ว กรุณาใช้ชื่ออื่น')
    .replace('ROOM_MEMBER_LIMIT','ห้องนี้มีผู้เข้าร่วมถึงจำนวนสูงสุดแล้ว')
    .replace('DECK_HAS_ACTIVE_CARDS','นำ Action Card ออกจาก Deck ให้หมดก่อนจึงจะลบ Deck ได้')
    .replace('ROOM_CREATION_RATE_LIMIT','มีการสร้างห้องจำนวนมากเกินไป กรุณาลองใหม่ภายหลัง')
    .replace('ACTIVE_ROOM_LIMIT','ระบบมีห้องที่กำลังใช้งานถึงขีดจำกัดชั่วคราว')
    .replace('ROOM_NOT_FOUND','ไม่พบห้องเกม')
    .replace('LAST_ACTIVE_PARTICIPANT_CONFIRM_CLOSE','คุณเป็นคนสุดท้าย หากออก ห้องจะถูกปิดถาวร')
    .replace('ROLE_HOLDER_STILL_ONLINE','เจ้าของ Role เดิมยัง Online อยู่')
    .replace('TARGET_ALREADY_HAS_ROLE','ผู้เล่นนี้มี Role อยู่แล้ว')
    .replace('GAME_PAUSED','เกมถูก Pause อยู่');
}
async function rpc(name,args={}){
  const showActivity=name!=='bcp_web_heartbeat';
  if(showActivity)requestStarted();
  try{
    const {data,error}=await sb.rpc(name,args);
    if(error)throw error;
    return data;
  }finally{
    if(showActivity)requestFinished();
  }
}
function connectionBadge(){
  const map={online:['LIVE','online'],connecting:['CONNECTING','connecting'],degraded:['SYNC','degraded'],offline:['OFFLINE','offline']};
  const [label,cls]=map[connectionState]||map.connecting;
  return '<span id="connectionBadge" class="connection-badge '+cls+'"><i></i>'+label+'</span>';
}
function setConnectionState(next){
  connectionState=next;
  const el=$('#connectionBadge');
  if(!el)return;
  const map={online:['LIVE','online'],connecting:['CONNECTING','connecting'],degraded:['SYNC','degraded'],offline:['OFFLINE','offline']};
  const [label,cls]=map[next]||map.connecting;
  el.className='connection-badge '+cls;
  el.innerHTML='<i></i>'+label;
}

function topbar(extra=''){
  return '<header class="topbar"><div class="brand"><img class="brand-logo" src="./assets/tccc-learning-lab.webp" alt="TCCC Learning Lab"><div class="brand-product"><b>BCP PLAYTEST</b><small>Business Continuity Simulation</small></div></div><div class="top-actions">'+connectionBadge()+extra+'</div></header>';
}
function shell(html,extra=''){ $('#app').innerHTML='<div class="shell">'+topbar(extra)+html+'</div>'; }

function landing(){
  stopRealtime(); state=null;
  shell('<main class="landing"><section class="hero panel"><div class="learning-band"><span></span>TCCC LEARNING LAB · TEAM CRISIS SIMULATION</div><span class="eyebrow">BUSINESS CONTINUITY / ONLINE PLAYTEST</span><h1>ตัดสินใจ<br>เมื่อข้อมูลไม่ครบ</h1><p>BCP Online Playtest สำหรับ 7 Role — แต่ละคนเห็นข้อมูลและ Action ของตัวเอง ก่อนประกอบการตัดสินใจร่วมกันบน Timeline แบบ Realtime</p><div class="hero-grid"><div><small>01</small><b>7 Roles</b><span>CMC · CMD ×3 · CMT/LRTs ×3</span></div><div><small>02</small><b>4 Rounds</b><span>Scenario → Decision → Twist → Lock</span></div><div><small>03</small><b>Realtime</b><span>Private CHP Decks → Shared Timeline</span></div></div></section><section class="panel join-panel"><div class="join-kicker">ENTER SIMULATION</div><div class="tabs"><button id="tabJoin" class="tab active">Join Room</button><button id="tabCreate" class="tab">Create Room</button></div><div id="joinForm"><label>ชื่อผู้เล่น<input id="playerName" maxlength="60" placeholder="ชื่อที่ใช้ในเกม"></label><label>Room Code<input id="roomCode" maxlength="6" class="code-input" placeholder="ABC123"></label><button id="joinBtn" class="btn primary">เข้าห้องเกม</button></div><div id="createForm" hidden><label>ชื่อ Admin<input id="adminName" maxlength="60" placeholder="ชื่อ Admin / ผู้เล่น"></label><label>ชื่อห้อง<input id="roomTitle" maxlength="100" value="BCP Online Playtest"></label><button id="createBtn" class="btn primary">สร้างห้องเกม</button></div>'+(session?'<button id="resumeBtn" class="btn ghost full">กลับเข้าสู่ Session ล่าสุด</button>':'')+'</section></main>');
  $('#tabJoin').onclick=()=>{ $('#joinForm').hidden=false; $('#createForm').hidden=true; $('#tabJoin').classList.add('active'); $('#tabCreate').classList.remove('active'); };
  $('#tabCreate').onclick=()=>{ $('#joinForm').hidden=true; $('#createForm').hidden=false; $('#tabCreate').classList.add('active'); $('#tabJoin').classList.remove('active'); };
  $('#roomCode').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  $('#joinBtn').onclick=e=>joinRoom(e.currentTarget);
  $('#createBtn').onclick=e=>createRoom(e.currentTarget);
  if($('#resumeBtn')) $('#resumeBtn').onclick=()=>refresh(true);
}
async function createRoom(btn){
  const name=$('#adminName').value.trim(),title=$('#roomTitle').value.trim();
  if(!name)return toast('กรอกชื่อ Admin','error');
  return withButtonBusy(btn,'กำลังสร้างห้อง…',async()=>{
    try{
      const d=await rpc('bcp_web_create_room',{p_title:title,p_display_name:name});
      saveSession({roomId:d.room.id,token:d.session_token});
      await refresh(true);
    }catch(e){toast(errText(e),'error');}
  });
}
async function joinRoom(btn){
  const name=$('#playerName').value.trim(),code=$('#roomCode').value.trim();
  if(!name||code.length!==6)return toast('กรอกชื่อและ Room Code 6 ตัว','error');
  return withButtonBusy(btn,'กำลังเข้าห้อง…',async()=>{
    try{
      const d=await rpc('bcp_web_join_room',{p_code:code,p_display_name:name});
      saveSession({roomId:d.room.id,token:d.session_token});
      await refresh(true);
    }catch(e){toast(errText(e),'error');}
  });
}

async function refresh(first=false){
  if(!session||busy) return;
  busy=true;
  try{
    state=await rpc('bcp_web_get_state',{p_room_id:session.roomId,p_session_token:session.token});
    if(state?.server_now) serverOffsetMs=new Date(state.server_now).getTime()-Date.now();
    if(selectedChp && !(state.hand||[]).some(c=>c.chp_code===selectedChp)){
      selectedChp=null;
      selectedCard=null;
    }
    setConnectionState('online');
    render();
    if(first) startRealtime();
  }catch(e){
    setConnectionState(navigator.onLine?'degraded':'offline');
    if(first){ toast('Session ใช้งานไม่ได้: '+errText(e),'error'); saveSession(null); landing(); }
  }finally{ busy=false; }
}
function render(){
  if(!state) return landing();
  if(state.room.status==='closed') return closedRoom();
  if(state.room.status==='lobby') return lobby();
  if(state.room.status==='completed') return debrief();
  game();
}
function closedRoom(){
  stopRealtime();
  const reason={
    last_participant_left:'ผู้เล่นคนสุดท้ายออกจากห้อง',
    admin_closed:'Admin ปิดห้อง',
    solo_test_closed:'ปิดห้องทดสอบ Solo',
    lobby_inactive:'Lobby ไม่มีการใช้งานเกิน 30 นาที',
    playing_abandoned:'ไม่มีผู้เล่น Online เกิน 60 นาที'
  }[state.room.close_reason]||'Session ถูกปิด';
  shell('<main class="page"><section class="panel closed-panel"><span class="eyebrow">SESSION CLOSED</span><h1>ห้องนี้ถูกปิดแล้ว</h1><p>'+esc(reason)+'</p><p class="muted">Room Code นี้จะไม่เปิดให้ Join อีก และข้อมูล Session จะถูกเก็บตามรอบ retention ก่อนย้ายเป็นสรุป Archive</p><button id="clearClosedBtn" class="btn primary">กลับหน้าแรก</button></section></main>');
  $('#clearClosedBtn').onclick=()=>{saveSession(null);landing();};
}
async function leave(btn){
  if(!session||!state) return landing();
  if(session.soloSessions?.length){
    if(!confirm('ออกจาก Solo Test? ห้องทดสอบนี้จะถูกปิดถาวร'))return;
    return withButtonBusy(btn,'กำลังออก…',async()=>{
      try{await rpc('bcp_web_close_room',{p_room_id:state.room.id,p_session_token:adminToken(),p_reason:'solo_test_closed'});}catch{}
      saveSession(null);
      landing();
    });
  }
  if(!confirm(state.room.status==='completed'?'ออกจากผลสรุป Session นี้?':'ออกจากห้องเกม?'))return;
  return withButtonBusy(btn,'กำลังออก…',async()=>{
    try{
      await rpc('bcp_web_leave_room',{p_room_id:state.room.id,p_session_token:session.token,p_confirm_close:false});
    }catch(e){
      if((e?.message||'').includes('LAST_ACTIVE_PARTICIPANT_CONFIRM_CLOSE')){
        if(!confirm('คุณเป็นผู้เล่นคนสุดท้าย หากออกตอนนี้ ห้องจะถูกปิดถาวรและ Join กลับด้วย Room Code เดิมไม่ได้\n\nยืนยันออกและปิดห้อง?'))return;
        try{await rpc('bcp_web_leave_room',{p_room_id:state.room.id,p_session_token:session.token,p_confirm_close:true});}
        catch(e2){return toast(errText(e2),'error');}
      }else return toast(errText(e),'error');
    }
    saveSession(null);
    landing();
  });
}

function lobby(){
  const members=state.members||[];
  const assigned=new Set(members.filter(x=>x.role_key).map(x=>x.role_key));
  const roleCards=ROLES.map(r=>{
    const holder=members.find(m=>m.role_key===r);
    const options='<option value="">— เลือกผู้เล่น —</option>'+members.map(m=>'<option value="'+m.id+'" '+(holder?.id===m.id?'selected':'')+'>'+esc(m.display_name)+(m.is_admin?' · Admin':'')+'</option>').join('');
    return '<div class="role-card"><div><b>'+ROLE_LABEL[r]+'</b><small>'+(holder?esc(holder.display_name):'ยังไม่กำหนด')+'</small></div>'+(state.me.is_admin?'<select data-role="'+r+'" class="select role-select">'+options+'</select>':'')+'</div>';
  }).join('');
  const memberList=members.map(m=>'<div class="member"><span class="presence '+(m.is_bot?'bot':m.online?'online':'offline')+'"></span><div><b>'+esc(m.display_name)+'</b><small>'+esc(m.role_key?ROLE_LABEL[m.role_key]:'Waiting')+(m.is_admin?' · Admin':'')+(m.is_bot?' · TEST ROLE':'')+'</small></div><span class="presence-label">'+(m.is_bot?'TEST':m.online?'ONLINE':'OFFLINE')+'</span></div>').join('');
  const soloActive=!!session.soloSessions?.length;
  const currentAdmin=members.find(m=>m.is_admin&&!m.is_bot);
  const offlineAdmin=currentAdmin&&!currentAdmin.online?currentAdmin:null;
  const canClaimAdmin=!state.me.is_admin&&(!currentAdmin||offlineAdmin);
  const extra=(state.me.is_admin?'<button id="closeRoomBtn" class="btn small danger-btn">ปิดห้อง</button>':canClaimAdmin?'<button id="claimAdminBtn" class="btn small">รับสิทธิ์ Admin</button>':'')+'<button id="leaveBtn" class="btn small ghost">ออก</button>';
  shell('<main class="page"><div class="lobby-grid"><section class="panel"><span class="eyebrow">ROOM CODE</span><div class="room-code">'+esc(state.room.code)+'</div><h2>'+esc(state.room.title)+'</h2><p class="muted">ส่ง Code นี้ให้ทีม แล้ว Admin กำหนด Role ตามผู้ที่ Online อยู่</p>'+(state.me.is_admin?'<div class="admin-role-note"><b>Admin = สิทธิ์ควบคุมห้อง ไม่ใช่ Game Role</b><span>Admin เล่นด้วยได้ — ถ้าเล่นจริงให้ Assign ชื่อตัวเองเข้า 1 ใน 7 Role หรือเปิด Solo Test เพื่อสลับเล่นทุก Role บนอุปกรณ์เดียว</span></div><div class="solo-test-box"><div><b>Solo Test · Admin + 7 Test Players</b><small>หลังเริ่มเกมจะสลับได้ระหว่าง Admin Console และ CMC / CMD / CMT ทุก Role โดยไม่ต้องเปิด 7 เครื่อง</small></div><button id="soloBtn" class="btn '+(soloActive?'ghost':'primary')+'">'+(soloActive?'ปิด Solo Test':'เปิด Solo Test')+'</button></div>':'')+'<div class="member-list">'+memberList+'</div></section><section class="panel"><div class="panel-head"><div><h2>Role Assignment</h2><p>ต้องครบ 7 Role ก่อนเริ่มเกม · Admin จะถือ Role ด้วยก็ได้</p></div><span class="badge">'+assigned.size+'/7</span></div><div class="role-grid">'+roleCards+'</div>'+(state.me.is_admin?'<div class="setup-grid"><label>Scenario Set<select id="scenarioSet" class="select"><option value="1">Scenario Set 1</option><option value="2">Scenario Set 2</option></select></label><label>Starting Cash<input id="startingCash" class="input" type="number" value="11000000" step="1000"></label><label>เวลา / Round (นาที)<input id="roundMinutes" class="input" type="number" min="1" max="60" value="15"></label><label>Twist เมื่อเหลือ (นาที)<input id="twistMinutes" class="input" type="number" min="0" max="59" value="6"></label></div><button id="startBtn" class="btn primary full" '+(assigned.size===7?'':'disabled')+'>เริ่ม Simulation</button>':'<div class="waiting-box">รอ Admin กำหนด Role และเริ่มเกม</div>')+'</section></div></main>',extra);
  $('#leaveBtn').onclick=e=>leave(e.currentTarget);
  if($('#closeRoomBtn')) $('#closeRoomBtn').onclick=e=>closeRoomNow(e.currentTarget);
  if($('#claimAdminBtn')) $('#claimAdminBtn').onclick=e=>claimAdmin(e.currentTarget);
  if($('#soloBtn')) $('#soloBtn').onclick=e=>toggleSoloTest(e.currentTarget);
  $$('.role-select').forEach(el=>el.onchange=async()=>{
    el.disabled=true;
    el.classList.add('control-loading');
    try{
      await rpc('bcp_web_assign_role',{p_room_id:state.room.id,p_session_token:session.token,p_member_id:el.value||members.find(x=>x.role_key===el.dataset.role)?.id,p_role_key:el.value?el.dataset.role:null});
      await refresh();
    }catch(e){toast(errText(e),'error');}
    finally{el.disabled=false;el.classList.remove('control-loading');}
  });
  if($('#startBtn')) $('#startBtn').onclick=e=>startGame(e.currentTarget);
}
async function toggleSoloTest(btn){
  const adminToken=session.adminToken||session.token;
  return withButtonBusy(btn,session.soloSessions?.length?'กำลังปิด Test…':'กำลังสร้าง 7 Role…',async()=>{
  try{
    if(session.soloSessions?.length){
      await rpc('bcp_web_disable_solo_test',{p_room_id:state.room.id,p_session_token:adminToken});
      session.soloSessions=null; session.adminToken=null; session.token=adminToken; saveSession(session);
      toast('ปิด Solo Test Mode แล้ว'); await refresh(); return;
    }
    const d=await rpc('bcp_web_enable_solo_test',{p_room_id:state.room.id,p_session_token:adminToken});
    session.adminToken=adminToken;
    session.soloSessions=d.sessions||[];
    session.token=adminToken;
    saveSession(session);
    toast('สร้าง Test Player ครบ 7 Role แล้ว','success');
    await refresh();
  }catch(e){toast(errText(e),'error');}
  });
}

function soloSwitcher(){
  if(!session.soloSessions?.length) return '';
  const current=session.soloSessions.find(x=>x.session_token===session.token);
  const adminSelected=!!session.adminToken&&session.token===session.adminToken;
  return '<div class="test-view-switch"><small>TEST VIEW</small><select id="soloRoleSwitcher" class="select solo-switcher"><option value="__ADMIN__" '+(adminSelected?'selected':'')+'>Admin Console · ไม่ใช่ Player</option>'+session.soloSessions.map(x=>'<option value="'+esc(x.role_key)+'" '+(current?.role_key===x.role_key?'selected':'')+'>'+esc(ROLE_LABEL[x.role_key])+'</option>').join('')+'</select></div>';
}
async function switchSoloRole(role){
  if(role==='__ADMIN__'){
    if(!session.adminToken)return;
    session.token=session.adminToken;
  }else{
    const s=session.soloSessions?.find(x=>x.role_key===role); if(!s)return;
    session.token=s.session_token;
  }
  saveSession(session);
  selectedCard=null;
  selectedChp=null;
  await refresh();
}

async function startGame(btn){
  const mins=+$('#roundMinutes').value,twist=+$('#twistMinutes').value;
  return withButtonBusy(btn,'กำลังเริ่ม Simulation…',async()=>{
    try{
      const adminToken=session.adminToken||session.token;
      await rpc('bcp_web_start_game',{p_room_id:state.room.id,p_session_token:adminToken,p_scenario_set:+$('#scenarioSet').value,p_starting_cash:+$('#startingCash').value,p_timer_seconds:mins*60,p_twist_at_remaining:twist*60});
      if(session.soloSessions?.length){
        const first=session.soloSessions.find(x=>x.role_key==='CMC')||session.soloSessions[0];
        session.token=first.session_token;
        saveSession(session);
      }
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}

function storyHtml(){
  const s=state.story||{};
  return '<section class="panel story"><div class="panel-head"><div><span class="eyebrow">ROUND '+state.room.current_round+'</span><h2>Situation Brief</h2></div>'+(state.room.twist_revealed?'<span class="badge danger">TWIST ACTIVE</span>':'')+'</div><div class="story-block"><b>Big Story</b><p>'+esc(s.big_story||'').replace(/\n/g,'<br>')+'</p></div>'+(s.site_story?'<div class="story-block site"><b>My Site Story</b><p>'+esc(s.site_story).replace(/\n/g,'<br>')+'</p></div>':'')+(s.twist_story||s.site_twist_story?'<div class="story-block twist"><b>CRISIS UPDATE</b><p>'+esc([s.twist_story,s.site_twist_story].filter(Boolean).join('\n\n')).replace(/\n/g,'<br>')+'</p></div>':'')+'</section>';
}
function statsHtml(){
  const ready=state.members.filter(m=>m.role_key&&m.ready_to_lock).length;
  return '<div class="stats"><div><small>ROUND</small><b>'+state.room.current_round+'/4</b></div><div><small>TIME</small><b id="clock">--:--</b></div><div><small>CASH</small><b>฿'+money(state.room.cash_remaining)+'</b></div><div><small>BUSINESS CONTINUITY</small><b>'+state.room.business_continuity+'</b></div><div><small>READY</small><b>'+ready+'/7</b></div></div>';
}
function decksHtml(){
  const placements=(state.placements||[]).filter(p=>!p.removed_at);
  const paused=!!state.room.paused_at;
  const bySite={HO:[],PPD:[],NKL:[]};
  placements.forEach(p=>bySite[p.site].push(p));

  return '<section class="panel decision"><div class="panel-head"><div><span class="eyebrow">SHARED DECISION TIMELINE</span><h2>Team Response</h2><p>ลาก Action จาก CHP Deck ส่วนตัวมาวางตาม Site ระบบจะจัดกลุ่ม CHP ให้อัตโนมัติ · ลำดับมีผลภายใน CHP เดียวกัน</p></div></div><div class="site-columns">'+['HO','PPD','NKL'].map(site=>{
    const groups={};
    bySite[site].forEach(p=>(groups[p.chp_code]??=[]).push(p));
    const groupHtml=Object.entries(groups).sort(([a],[b])=>chpSort(a,b)).map(([chp,cards])=>{
      cards.sort((a,b)=>a.position-b.position);
      const deckId=cards[0]?.deck_id;
      return '<div class="timeline-chp"><div class="timeline-chp-head"><b>'+esc(chp)+'</b><span>'+cards.length+' Action</span></div><div class="timeline-cards" data-timeline-deck="'+deckId+'">'+cards.map((p,i)=>'<div class="placed-card" draggable="'+(!paused)+'" data-place="'+p.id+'" data-deck="'+p.deck_id+'"><span class="seq">'+(i+1)+'</span><div><b>'+esc(p.title)+'</b><small>'+esc(p.role)+' · ฿'+money(p.cash_cost)+'</small></div><div class="placed-controls"><button class="icon-btn" title="เลื่อนขึ้น" data-move="-1" data-place="'+p.id+'" data-deck="'+p.deck_id+'" '+(paused?'disabled':'')+'>↑</button><button class="icon-btn" title="เลื่อนลง" data-move="1" data-place="'+p.id+'" data-deck="'+p.deck_id+'" '+(paused?'disabled':'')+'>↓</button>'+(p.placed_by_member_id===state.me.id?'<button class="icon-btn" title="นำออก" data-remove-action="'+p.id+'" '+(paused?'disabled':'')+'>×</button>':'')+'</div></div>').join('')+'</div></div>';
    }).join('');
    return '<div class="site-col timeline-site"><div class="site-head"><b>'+site+'</b><span class="site-drop-hint">DROP ACTION</span></div><div class="site-dropzone" data-site-drop="'+site+'">'+(groupHtml||'<div class="empty site-empty">ยังไม่มี Action · ลากการ์ดมาวางที่ Site นี้</div>')+'</div></div>';
  }).join('')+'</div></section>';
}

function handHtml(){
  const hand=state.hand||[];
  const paused=!!state.room.paused_at;
  const role=state.me.role_key;

  if(!role){
    return '<section class="panel hand hand-locked"><div class="panel-head"><div><span class="eyebrow">ADMIN CONSOLE</span><h2>ไม่มี Private CHP Deck</h2><p>Admin Console คุม Session เท่านั้น — สลับ TEST VIEW ไป Game Role เพื่อดู CHP Deck ของผู้เล่นคนนั้น</p></div></div><div class="hand-empty-state"><span>ADMIN</span><b>เลือก CMC / CMD / CMT เพื่อทดสอบการเล่น</b></div></section>';
  }

  const chps=ownedChps();
  if(!selectedChp){
    return '<section class="panel hand private-decks"><div class="panel-head"><div><span class="eyebrow">PRIVATE CHP DECKS</span><h2>'+esc(ROLE_LABEL[role])+'</h2><p>Deck นี้เป็นของผู้เล่นคนนี้เท่านั้น และมีเฉพาะ Action ที่ Role นี้รับผิดชอบ</p></div></div><div class="private-deck-grid">'+chps.map(chp=>'<button class="private-deck-card" data-private-chp="'+esc(chp)+'"><b>'+esc(chp)+'</b><span>'+hand.filter(c=>c.chp_code===chp).length+' Actions</span></button>').join('')+'</div><div class="hand-empty-state compact"><span>STEP 1</span><b>เลือก CHP Deck ที่ต้องการเปิดดู</b></div></section>';
  }

  const cards=hand.filter(c=>c.chp_code===selectedChp);
  const active=(state.placements||[]).filter(p=>!p.removed_at);
  const cardHtml=card=>{
    const targets=validTargetSites(card,role);
    const usedSites=new Set(active.filter(p=>p.card_key===card.card_key).map(p=>p.site));
    const available=targets.filter(site=>!usedSites.has(site));
    const fullyUsed=available.length===0;
    const actionLabel=available.length>1?'เลือก Site':'วาง';
    const placementNote=targets.length>1&&usedSites.size?'<small class="card-placement-note">ลงแล้ว: '+[...usedSites].join(', ')+'</small>':'';
    return '<article class="action-card '+(fullyUsed?'used':'')+(paused?' paused':'')+(selectedCard===card.card_key?' selected':'')+'" draggable="'+(!fullyUsed&&!paused)+'" data-card="'+esc(card.card_key)+'"><div class="card-top"><span>'+esc(card.chp_code)+'</span><strong>฿'+money(card.cash_cost)+'</strong></div><h3>'+esc(card.title)+'</h3><p>'+esc(card.detail).replace(/\n/g,'<br>')+'</p><footer><span>'+esc(card.role)+'</span><div class="card-actions">'+placementNote+(fullyUsed?'<span class="used-label">USED</span>':'<button class="card-place-btn" data-quick-place="'+esc(card.card_key)+'" '+(paused?'disabled':'')+'>'+actionLabel+'</button>')+'</div></footer></article>';
  };

  let body='';
  if(role==='CMC'){
    const ho=cards.filter(c=>cardSiteType(c)==='HO');
    const fac=cards.filter(c=>cardSiteType(c)==='Factory');
    body=(ho.length?'<div class="private-card-section"><div class="private-card-section-title">HO ACTIONS</div><div class="hand-grid">'+ho.map(cardHtml).join('')+'</div></div>':'')+
         (fac.length?'<div class="private-card-section"><div class="private-card-section-title">FACTORY ACTIONS · PPD / NKL</div><div class="hand-grid">'+fac.map(cardHtml).join('')+'</div></div>':'');
  }else{
    body='<div class="hand-grid">'+cards.map(cardHtml).join('')+'</div>';
  }

  return '<section class="panel hand cards-reveal"><div class="panel-head"><div><span class="eyebrow">PRIVATE CHP DECK</span><h2>'+esc(selectedChp)+' · '+esc(ROLE_LABEL[role])+'</h2><p>เลือก Action ที่ต้องใช้ แล้วลากไป Shared Timeline · คลิกขวาหรือปุ่ม “วาง” ใช้เป็นทางลัด</p></div><button id="backToDecks" class="btn small ghost">← CHP Decks</button></div>'+body+'</section>';
}

function teamHtml(){
  const members=state.members.filter(m=>m.role_key);
  const waiting=state.members.filter(m=>!m.role_key&&!m.is_bot);
  const admin=hasAdminControl();
  const currentAdmin=state.members.find(m=>m.is_admin&&!m.is_bot);
  const offlineAdmin=currentAdmin&&!currentAdmin.online?currentAdmin:null;
  const canClaimAdmin=!admin&&(!currentAdmin||offlineAdmin);
  const adminPanel=admin?'<div class="admin-panel"><b>Admin Control</b><div class="admin-actions">'+
    '<button id="pauseBtn" class="btn small">'+(state.room.paused_at?'▶ Resume':'Ⅱ Pause')+'</button>'+
    '<button id="extendBtn" class="btn small">+1 min</button>'+
    '<button id="lateJoinBtn" class="btn small">เปิด Join 5 นาที</button>'+
    '<button id="closeRoomBtn" class="btn small danger-btn">ปิดห้อง</button></div>'+
    (waiting.length?'<div class="recovery-box"><small>Role Recovery</small><select id="recoveryMember" class="select">'+waiting.map(m=>'<option value="'+m.id+'">'+esc(m.display_name)+'</option>').join('')+'</select><select id="recoveryRole" class="select">'+ROLES.map(r=>'<option value="'+r+'">'+esc(ROLE_LABEL[r])+'</option>').join('')+'</select><button id="recoverRoleBtn" class="btn small">รับช่วง Role</button></div>':'')+
    '</div>':canClaimAdmin?'<div class="admin-panel"><b>Admin Recovery</b><p class="muted small-text">'+(offlineAdmin?'Admin เดิม Offline หากเกิน 90 วินาที สมาชิกที่ยัง Online สามารถรับสิทธิ์ดูแลห้องต่อได้':'ห้องนี้ไม่มี Admin ที่ Active — สมาชิกที่ยัง Online สามารถรับสิทธิ์ดูแลห้องต่อได้')+'</p><button id="claimAdminBtn" class="btn full">รับสิทธิ์ Admin</button></div>':'';
  const readyControl=state.me.role_key?'<button id="readyBtn" class="btn '+(state.me.ready_to_lock?'success':'primary')+' full" '+(state.room.paused_at?'disabled':'')+'>'+(state.me.ready_to_lock?'✓ Ready แล้ว · กดเพื่อยกเลิก':'Ready to Lock')+'</button><p class="muted small-text">ตำแหน่งจะ Lock เมื่อครบทั้ง 7 Role หรือหมดเวลา</p>':'<div class="admin-console-note"><b>Admin Console</b><span>ไม่ถูกนับเป็น 1 ใน 7 Role และไม่ต้องกด Ready</span></div>';
  return '<aside class="panel team-panel"><div class="panel-head"><div><h3>Team Status</h3><p>'+esc(ROLE_LABEL[state.me.role_key]||(admin?'Admin Console':''))+'</p></div></div><div class="member-list">'+members.map(m=>'<div class="member"><span class="presence '+(m.is_bot?'bot':m.online?'online':'offline')+(m.ready_to_lock?' ready':'')+'"></span><div><b>'+esc(ROLE_LABEL[m.role_key])+'</b><small>'+esc(m.display_name)+(m.is_bot?' · TEST ROLE':'')+'</small></div><span class="ready-text">'+(m.ready_to_lock?'READY':m.is_bot?'TEST':m.online?'ONLINE':'OFFLINE')+'</span></div>').join('')+'</div>'+readyControl+adminPanel+'</aside>';
}
function game(){
  const viewLabel=state.me.role_key?ROLE_LABEL[state.me.role_key]:(hasAdminControl()?'ADMIN CONSOLE':'Waiting Role');
  const extra=soloSwitcher()+'<span class="role-pill">'+esc(viewLabel)+'</span><button id="leaveBtn" class="btn small ghost">ออก</button>';
  shell('<main class="page">'+consequenceHtml()+statsHtml()+(state.room.paused_at?'<div class="pause-banner"><b>GAME PAUSED</b><span>Timer และการเปลี่ยน Decision ถูกหยุดชั่วคราว — Admin Resume เพื่อเล่นต่อ</span></div>':'')+'<div class="game-layout"><div class="main-stack">'+storyHtml()+decksHtml()+handHtml()+'</div>'+teamHtml()+'</div></main>',extra);

  $('#leaveBtn').onclick=e=>leave(e.currentTarget);
  const consequenceDone=$('#consequenceDone');
  if(consequenceDone)consequenceDone.onclick=()=>{const r=(state.round_results||[]).at(-1);if(r)sessionStorage.setItem(consequenceKey(r.round_no),'1');game();};
  if($('#soloRoleSwitcher')) $('#soloRoleSwitcher').onchange=e=>switchSoloRole(e.target.value);
  if($('#readyBtn')) $('#readyBtn').onclick=e=>toggleReady(e.currentTarget);
  if($('#claimAdminBtn')) $('#claimAdminBtn').onclick=e=>claimAdmin(e.currentTarget);
  if($('#pauseBtn')) $('#pauseBtn').onclick=e=>togglePause(e.currentTarget);
  if($('#extendBtn')) $('#extendBtn').onclick=e=>extendRound(e.currentTarget);
  if($('#lateJoinBtn')) $('#lateJoinBtn').onclick=e=>openLateJoin(e.currentTarget);
  if($('#closeRoomBtn')) $('#closeRoomBtn').onclick=e=>closeRoomNow(e.currentTarget);
  if($('#recoverRoleBtn')) $('#recoverRoleBtn').onclick=e=>recoverRole(e.currentTarget);

  $$('[data-private-chp]').forEach(b=>b.onclick=()=>{
    selectedChp=b.dataset.privateChp;
    selectedCard=null;
    game();
    requestAnimationFrame(()=>document.querySelector('.hand')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
  });
  if($('#backToDecks')) $('#backToDecks').onclick=()=>{selectedChp=null;selectedCard=null;game();};

  $$('[data-remove-action]').forEach(b=>b.onclick=e=>{e.stopPropagation();removeAction(b.dataset.removeAction,e.currentTarget);});
  $$('[data-move]').forEach(b=>b.onclick=e=>{e.stopPropagation();movePlacement(b.dataset.deck,b.dataset.place,+b.dataset.move,e.currentTarget);});

  $$('[data-card]').forEach(c=>{
    c.onclick=e=>{
      if(e.target.closest('button')||state.room.paused_at||c.classList.contains('used'))return;
      selectedCard=c.dataset.card;
      $$('.action-card').forEach(x=>x.classList.toggle('selected',x===c));
    };
    c.oncontextmenu=e=>{
      e.preventDefault();
      if(state.room.paused_at||c.classList.contains('used'))return;
      quickPlaceCard(c.dataset.card,null,e.clientX,e.clientY);
    };
    c.ondragstart=e=>{
      if(state.room.paused_at||c.classList.contains('used')){e.preventDefault();return;}
      selectedCard=c.dataset.card;
      e.dataTransfer.effectAllowed='copy';
      e.dataTransfer.setData('application/x-bcp-card',c.dataset.card);
    };
  });

  $$('[data-quick-place]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    quickPlaceCard(b.dataset.quickPlace,e.currentTarget);
  });

  $$('.placed-card').forEach(c=>{
    c.ondragstart=e=>{
      e.stopPropagation();
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('application/x-bcp-placement',JSON.stringify({id:c.dataset.place,deck:c.dataset.deck}));
    };
    c.ondragover=e=>e.preventDefault();
    c.ondrop=e=>{
      e.preventDefault();
      e.stopPropagation();
      const raw=e.dataTransfer.getData('application/x-bcp-placement');
      if(raw){
        try{
          const from=JSON.parse(raw);
          if(from.deck===c.dataset.deck)reorderPlacement(from.deck,from.id,c.dataset.place);
        }catch{}
      }
    };
  });

  $$('[data-site-drop]').forEach(zone=>{
    zone.ondragover=e=>{
      const types=[...e.dataTransfer.types];
      if(!types.includes('application/x-bcp-card'))return;
      const card=cardByKey(e.dataTransfer.getData('application/x-bcp-card')||selectedCard);
      if(!card||!validTargetSites(card).includes(zone.dataset.siteDrop))return;
      e.preventDefault();
      zone.classList.add('dragover');
    };
    zone.ondragleave=()=>zone.classList.remove('dragover');
    zone.ondrop=e=>{
      e.preventDefault();
      zone.classList.remove('dragover');
      const cardKey=e.dataTransfer.getData('application/x-bcp-card')||selectedCard;
      const card=cardByKey(cardKey);
      if(!card||!validTargetSites(card).includes(zone.dataset.siteDrop)){
        toast('Action นี้ใช้กับ Site นี้ไม่ได้','error');
        return;
      }
      placeCard(cardKey,zone.dataset.siteDrop,null);
    };
  });

  startClock();
  showLatestResult();
}

function availableSitesForCard(card){
  const active=(state.placements||[]).filter(p=>!p.removed_at&&p.card_key===card.card_key);
  const used=new Set(active.map(p=>p.site));
  return validTargetSites(card).filter(site=>!used.has(site));
}

function quickPlaceCard(cardKey,btn,x=null,y=null){
  const card=cardByKey(cardKey);
  if(!card)return;
  const sites=availableSitesForCard(card);
  if(!sites.length)return toast('Action นี้ถูกใช้ครบ Site ที่เกี่ยวข้องแล้ว','error');
  if(sites.length===1)return placeCard(cardKey,sites[0],btn);
  openSitePicker(cardKey,sites,btn,x,y);
}

function openSitePicker(cardKey,sites,anchor,x=null,y=null){
  document.querySelector('.site-choice-menu')?.remove();
  const menu=document.createElement('div');
  menu.className='site-choice-menu';
  menu.innerHTML='<small>วาง Action ที่ Site</small>'+sites.map(site=>'<button data-site-choice="'+site+'">'+site+'</button>').join('');
  document.body.appendChild(menu);

  if(x!==null&&y!==null){
    menu.style.left=Math.min(x,window.innerWidth-150)+'px';
    menu.style.top=Math.min(y,window.innerHeight-120)+'px';
  }else if(anchor){
    const r=anchor.getBoundingClientRect();
    menu.style.left=Math.min(r.left,window.innerWidth-150)+'px';
    menu.style.top=Math.min(r.bottom+6,window.innerHeight-120)+'px';
  }

  const close=()=>menu.remove();
  $$('[data-site-choice]',menu).forEach(b=>b.onclick=()=>{
    const site=b.dataset.siteChoice;
    close();
    placeCard(cardKey,site,anchor);
  });
  setTimeout(()=>document.addEventListener('pointerdown',function away(e){
    if(!menu.contains(e.target)){close();document.removeEventListener('pointerdown',away);}
  }),0);
}

async function placeCard(cardKey,site,btn){
  if(!cardKey||!site)return;
  const zone=document.querySelector('[data-site-drop="'+CSS.escape(site)+'"]');
  zone?.classList.add('is-working');

  return withButtonBusy(btn,'กำลังวาง…',async()=>{
    try{
      await rpc('bcp_web_play_action_direct',{
        p_room_id:state.room.id,
        p_session_token:session.token,
        p_site:site,
        p_card_key:cardKey
      });
      selectedCard=null;
      await refresh();
      requestAnimationFrame(()=>{
        const el=document.querySelector('[data-site-drop="'+CSS.escape(site)+'"]');
        el?.classList.add('just-updated');
        setTimeout(()=>el?.classList.remove('just-updated'),650);
      });
    }catch(e){toast(errText(e),'error');}
    finally{zone?.classList.remove('is-working');}
  });
}

async function removeAction(id,btn){
  return withButtonBusy(btn,'…',async()=>{
    try{
      await rpc('bcp_web_remove_action',{p_room_id:state.room.id,p_session_token:session.token,p_placement_id:id});
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}

async function movePlacement(deckId,placementId,delta,btn){
  const cards=(state.placements||[]).filter(p=>p.deck_id===deckId&&!p.removed_at).sort((a,b)=>a.position-b.position);
  const i=cards.findIndex(p=>p.id===placementId),j=i+delta;
  if(i<0||j<0||j>=cards.length)return;
  [cards[i],cards[j]]=[cards[j],cards[i]];

  return withButtonBusy(btn,'…',async()=>{
    try{
      await rpc('bcp_web_reorder_deck',{p_room_id:state.room.id,p_session_token:session.token,p_deck_id:deckId,p_placement_ids:cards.map(x=>x.id)});
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}

async function reorderPlacement(deckId,fromId,targetId){
  const cards=(state.placements||[]).filter(p=>p.deck_id===deckId&&!p.removed_at).sort((a,b)=>a.position-b.position);
  const from=cards.findIndex(p=>p.id===fromId),to=cards.findIndex(p=>p.id===targetId);
  if(from<0||to<0||from===to)return;
  const [item]=cards.splice(from,1);
  cards.splice(to,0,item);

  try{
    await rpc('bcp_web_reorder_deck',{p_room_id:state.room.id,p_session_token:session.token,p_deck_id:deckId,p_placement_ids:cards.map(x=>x.id)});
    await refresh();
  }catch(e){toast(errText(e),'error');}
}

async function claimAdmin(btn){
  return withButtonBusy(btn,'กำลังรับสิทธิ์…',async()=>{
    try{
      await rpc('bcp_web_claim_admin',{p_room_id:state.room.id,p_session_token:session.token});
      toast('รับสิทธิ์ Admin แล้ว','success');
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}
async function closeRoomNow(btn){
  if(!confirm('ปิดห้องถาวร? หลังปิดจะไม่มีใคร Join กลับด้วย Room Code นี้ได้'))return;
  return withButtonBusy(btn,'กำลังปิด…',async()=>{
    try{await rpc('bcp_web_close_room',{p_room_id:state.room.id,p_session_token:adminToken(),p_reason:'admin_closed'});await refresh();}
    catch(e){toast(errText(e),'error');}
  });
}
async function togglePause(btn){
  return withButtonBusy(btn,state.room.paused_at?'กำลัง Resume…':'กำลัง Pause…',async()=>{
    try{await rpc(state.room.paused_at?'bcp_web_resume_game':'bcp_web_pause_game',{p_room_id:state.room.id,p_session_token:adminToken()});await refresh();}
    catch(e){toast(errText(e),'error');}
  });
}
async function extendRound(btn){
  return withButtonBusy(btn,'กำลังเพิ่มเวลา…',async()=>{
    try{
      await rpc('bcp_web_extend_round',{p_room_id:state.room.id,p_session_token:adminToken(),p_seconds:60});
      toast('เพิ่มเวลา 1 นาที','success');
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}
async function openLateJoin(btn){
  return withButtonBusy(btn,'กำลังเปิด Join…',async()=>{
    try{
      await rpc('bcp_web_open_late_join',{p_room_id:state.room.id,p_session_token:adminToken(),p_minutes:5});
      toast('เปิดรับผู้เล่นทดแทน 5 นาที','success');
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}
async function recoverRole(btn){
  const member=$('#recoveryMember')?.value,role=$('#recoveryRole')?.value;
  if(!member||!role)return;
  return withButtonBusy(btn,'กำลังส่งต่อ…',async()=>{
    try{
      await rpc('bcp_web_reassign_role',{p_room_id:state.room.id,p_session_token:adminToken(),p_member_id:member,p_role_key:role});
      toast('ส่งต่อ Role แล้ว','success');
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}
async function toggleReady(btn){
  return withButtonBusy(btn,state.me.ready_to_lock?'กำลังยกเลิก…':'กำลัง Ready…',async()=>{
    try{
      await rpc('bcp_web_set_ready',{p_room_id:state.room.id,p_session_token:session.token,p_ready:!state.me.ready_to_lock});
      await refresh();
      const players=state.members.filter(m=>m.role_key);
      if(players.length===7&&players.every(m=>m.ready_to_lock)){
        try{
          await rpc('bcp_web_lock_round',{p_room_id:state.room.id,p_session_token:session.token});
          await refresh();
        }catch{}
      }
    }catch(e){toast(errText(e),'error');}
  });
}

function consequenceKey(round){return 'bcp_consequence_'+state.room.id+'_'+round;}
function consequenceHtml(){
  const r=(state?.round_results||[]).at(-1);
  if(!r||sessionStorage.getItem(consequenceKey(r.round_no)))return '';
  const next=state.room.status==='playing';
  return '<section class="round-consequence panel" aria-label="Round consequence"><div class="consequence-heading"><span class="eyebrow">ROUND '+r.round_no+' · CONSEQUENCE</span><h2>'+esc(r.bc_after<=0?'MISSION FAILED':'ผลการตัดสินใจของทีม')+'</h2></div><div class="consequence-metrics"><div><small>BC LOSS</small><strong>−'+Number(r.bc_loss)+'</strong></div><div><small>CASH USED</small><strong>฿'+money(r.cash_used_round)+'</strong></div><div><small>BC REMAINING</small><strong>'+Number(r.bc_after)+'</strong></div></div><p class="consequence-outcome">'+esc(r.outcome||'')+'</p><p class="consequence-hint">'+(next?'รอบถัดไปเริ่มนับเวลาแล้ว · กดต่อเพื่อกลับไปตัดสินใจ':'จบ Simulation · ดูรายละเอียดคำตอบใน Debrief')+'</p>'+(next?'<button id="consequenceDone" class="btn primary">ไปที่ Round '+state.room.current_round+' →</button>':'')+'</section>';
}
function warnAtSeconds(sec){
  if(!state||!state.room||!state.room.id)return;
  for(const threshold of [60,30,10]){
    if(sec>threshold)continue;
    const key='bcp_warning_'+state.room.id+'_'+state.room.current_round+'_'+threshold;
    if(sessionStorage.getItem(key))continue;
    sessionStorage.setItem(key,'1');
    if(sec<threshold-2)continue;
    toast(threshold+' วินาทีสุดท้าย · ตรวจ Action และกด Ready',threshold<=10?'error':'');
    const el=$('#clock');if(el){el.classList.remove('clock-attention');void el.offsetWidth;el.classList.add('clock-attention');}
  }
}
function startClock(){
  clearInterval(clockTimer);
  const tick=async()=>{
    if(!state||state.room.status!=='playing')return;
    const el=$('#clock');
    if(state.room.paused_at){
      if(el){el.textContent='PAUSED';el.classList.add('warning');}
      return;
    }
    const now=Date.now()+serverOffsetMs,end=new Date(state.room.round_ends_at).getTime(),reveal=state.room.twist_reveal_at?new Date(state.room.twist_reveal_at).getTime():null;
    const sec=Math.max(0,Math.ceil((end-now)/1000));
    if(el){
      el.textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
      el.classList.toggle('danger',sec<=30);
      el.classList.toggle('clock-warning',sec<=60&&sec>30);
      el.classList.toggle('clock-critical',sec<=10);
    }
    warnAtSeconds(sec);
    if(clockActionPending||busy)return;
    if(!state.room.twist_revealed&&reveal&&now>=reveal&&sec>0){
      clockActionPending=true;
      try{
        const r=await rpc('bcp_web_reveal_twist',{p_room_id:state.room.id,p_session_token:session.token});
        if(r?.revealed)toast('CRISIS UPDATE — Twist เปิดแล้ว','error');
        await refresh();
      }catch(e){ if(!String(e?.message||'').includes('TWIST_ALREADY'))toast(errText(e),'error'); }
      finally{clockActionPending=false;}
    }else if(sec<=0){
      clockActionPending=true;
      try{
        await rpc('bcp_web_expire_round',{p_room_id:state.room.id,p_session_token:session.token});
        await refresh();
      }catch(e){
        if(!String(e?.message||'').includes('GAME_NOT_PLAYING'))toast(errText(e),'error');
      }finally{clockActionPending=false;}
    }
  };
  tick();clockTimer=setInterval(tick,500);
}

const PLAYTEST_METRICS=[
  {key:'rules_clarity',label:'ความชัดเจนของกติกา'},
  {key:'engagement',label:'ความสนุกและการมีส่วนร่วม'},
  {key:'bcp_realism',label:'ความสมจริงของสถานการณ์ BCP'},
  {key:'game_balance',label:'ความสมดุลของ Cash / BC / Roles'},
  {key:'collaboration',label:'การสื่อสารและการทำงานร่วมกัน'}
];

function reconstructReplay(events){
  const placements=new Map();
  for(const event of [...(events||[])].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))){
    const p=event.payload||{};
    if(event.event_type==='action_played'&&p.placement_id){
      const prior=placements.get(p.placement_id)||{};
      placements.set(p.placement_id,{
        ...prior,id:p.placement_id,site:p.site,chp_code:p.chp_code,
        card_key:p.card_key,cash_cost:p.cash_cost,
        actor_member_id:event.actor_member_id,
        created_at:event.created_at,round_no:event.round_no,
        position:prior.position||placements.size+1,
        removed:false
      });
    }
    if(event.event_type==='action_removed'&&p.placement_id&&placements.has(p.placement_id)){
      placements.get(p.placement_id).removed=true;
    }
    if(event.event_type==='deck_reordered'&&Array.isArray(p.placement_ids)){
      p.placement_ids.forEach((id,index)=>{if(placements.has(id))placements.get(id).position=index+1;});
    }
  }
  return [...placements.values()].filter(x=>!x.removed);
}
function replayEventLabel(e,catalog,members){
  const p=e.payload||{};
  const card=catalog.get(p.card_key);
  const title=card?.title||p.card_key||'';
  const action={
    action_played:'วาง Action',
    action_removed:'นำ Action ออก',
    deck_reordered:'เปลี่ยนลำดับ Action',
    round_locked:'สรุป Round',
    round_started:'เริ่ม Round',
    twist_revealed:'Twist ปรากฏ',
    member_joined:'ผู้เล่นเข้าห้อง',
    role_assigned:'กำหนด Role',
    ready_changed:'เปลี่ยน Ready',
    game_started:'เริ่ม Simulation',
    game_paused:'Pause',
    game_resumed:'Resume'
  }[e.event_type]||String(e.event_type||'Event').replaceAll('_',' ');
  const who=members.get(e.actor_member_id);
  const when=e.created_at?new Date(e.created_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'–';
  return '<div class="replay-event"><time>'+esc(when)+'</time><b>'+esc(action)+'</b><span>'+esc([p.site,p.chp_code,title].filter(Boolean).join(' · '))+'</span><small>'+esc(who?.display_name||'System')+'</small></div>';
}
function playtestFormHtml(canSubmit){
  if(!canSubmit)return '<p class="muted">สลับจาก Admin Console ไปยัง TEST ROLE เพื่อส่งผลประเมินในมุมผู้เล่นได้</p>';
  const metrics=PLAYTEST_METRICS.map((m,i)=>
    '<label class="playtest-metric"><span>'+esc(m.label)+'</span><select class="select" data-feedback="'+m.key+'" required><option value="">เลือก 1–5</option>'+[1,2,3,4,5].map(n=>'<option value="'+n+'">'+n+' · '+(n===1?'น้อยที่สุด':n===5?'มากที่สุด':'')+'</option>').join('')+'</select></label>'
  ).join('');
  return '<div class="playtest-intro">ให้คะแนน 1 = น้อยที่สุด และ 5 = มากที่สุด เพื่อประเมินคุณภาพต้นแบบเกม ไม่ใช่คะแนนผู้เล่น</div><div class="playtest-metrics">'+metrics+'</div><label class="playtest-comment">จุดที่เข้าใจยากหรือไม่สมเหตุผล<textarea id="feedbackConfusing" maxlength="1500" rows="3" placeholder="เช่น กติกา Action, ลำดับ, บทบาท หรือ Scenario"></textarea></label><label class="playtest-comment">สิ่งที่อยากให้ปรับก่อนทำ Board Game จริง<textarea id="feedbackSuggestion" maxlength="1500" rows="3" placeholder="ข้อเสนอแนะเพิ่มเติม"></textarea></label><button id="savePlaytestFeedback" class="btn primary">บันทึกผลประเมิน Playtest</button><p id="feedbackSaveStatus" role="status" aria-live="polite" class="muted small-text"></p>';
}
function feedbackStatsHtml(stats){
  if(!stats)return '<p class="muted">ยังอ่านภาพรวมการประเมินไม่ได้</p>';
  const av=stats.averages||{};
  const summary=PLAYTEST_METRICS.map(m=>'<div class="feedback-stat"><span>'+esc(m.label)+'</span><strong>'+ (av[m.key]==null?'—':Number(av[m.key]).toFixed(2))+' / 5</strong></div>').join('');
  const notes=(stats.comments||[]).map(x=>
    '<div class="feedback-note">'+(x.confusing_point?'<p><b>จุดที่ติดขัด:</b> '+esc(x.confusing_point)+'</p>':'')+
    (x.suggested_improvement?'<p><b>เสนอให้ปรับ:</b> '+esc(x.suggested_improvement)+'</p>':'')+'</div>'
  ).join('');
  return '<div class="feedback-stats"><b>ผลประเมินจาก '+Number(stats.count||0)+' คน</b>'+summary+
    (notes?'<details><summary>อ่านข้อเสนอแนะ</summary>'+notes+'</details>':'')+'</div>';
}
async function savePlaytestFeedback(btn){
  const ratings={};
  for(const m of PLAYTEST_METRICS){
    const el=document.querySelector('[data-feedback="'+m.key+'"]');
    if(!el?.value)return toast('กรุณาให้คะแนนครบทั้ง 5 ด้าน','error');
    ratings[m.key]=Number(el.value);
  }
  return withButtonBusy(btn,'กำลังบันทึก…',async()=>{
    try{
      await rpc('bcp_web_submit_feedback',{
        p_room_id:state.room.id,p_session_token:session.token,
        p_rules_clarity:ratings.rules_clarity,p_engagement:ratings.engagement,
        p_bcp_realism:ratings.bcp_realism,p_game_balance:ratings.game_balance,
        p_collaboration:ratings.collaboration,
        p_confusing_point:$('#feedbackConfusing')?.value||'',
        p_suggested_improvement:$('#feedbackSuggestion')?.value||''
      });
      toast('บันทึกผลประเมิน Playtest แล้ว','success');
      const stats=await rpc('bcp_web_get_feedback_stats',{p_room_id:state.room.id,p_session_token:session.token});
      const zone=$('#feedbackResults');
      if(zone)zone.innerHTML=feedbackStatsHtml(stats);
      const text=$('#feedbackSaveStatus');if(text)text.textContent='บันทึกผลล่าสุดสำเร็จ สามารถแก้คะแนนแล้วบันทึกใหม่ได้';
    }catch(e){toast(errText(e),'error');}
  });
}

async function debrief(){
  stopRealtime();
  shell('<main class="page"><section class="panel" style="padding:26px"><span class="eyebrow">SIMULATION COMPLETE</span><h1>Debrief & Replay</h1><p>กำลังโหลดข้อมูลการตัดสินใจจริง…</p></section></main>','<button id="leaveBtn" class="btn small ghost">ออก</button>');
  $('#leaveBtn').onclick=e=>leave(e.currentTarget);
  try{
    const [d,feedback]=await Promise.all([
      rpc('bcp_web_get_debrief',{p_room_id:state.room.id,p_session_token:session.token}),
      rpc('bcp_web_get_feedback_stats',{p_room_id:state.room.id,p_session_token:session.token}).catch(()=>null)
    ]);
    const catalog=new Map((d.card_catalog||[]).map(c=>[c.card_key,c]));
    const members=new Map((d.members||[]).map(m=>[m.id,m]));
    const actualPlacements=reconstructReplay(d.replay||[]);
    const isDefeat=d.room.business_continuity<=0;
    const consequence=(state.round_results||[]).at(-1);
    const totals='<div class="debrief-summary"><div><small>FINAL BUSINESS CONTINUITY</small><b>'+Number(d.room.business_continuity)+'</b></div><div><small>CASH REMAINING</small><b>฿'+money(d.room.cash_remaining)+'</b></div></div>';
    const roundup=(d.rounds||[]).map(r=>
      '<div class="result-card"><small>ROUND '+r.round_no+'</small><b>BC '+r.summary.bc_after+'</b><span>−'+r.summary.bc_loss+' BC · ใช้ Cash ฿'+money(r.summary.cash_used_round)+'</span><p>'+esc(r.summary.outcome||'')+'</p></div>'
    ).join('');
    const comparisons=(d.rounds||[]).map((r,idx)=>{
      const expected=(r.scoring?.expected_chps||[]);
      const reqKeys=new Set();
      const expectedCost=expected.reduce((sum,s)=>{
        const cards=(d.answer_key||[]).filter(a=>a.round_no===r.round_no&&a.site===s.site&&a.chp_code===s.chp_code&&a.source===s.source);
        cards.forEach(a=>reqKeys.add(a.card_key+'@'+a.site));
        return sum+cards.reduce((v,a)=>v+Number(a.cash_cost||0),0);
      },0);
      const actual=actualPlacements.filter(p=>p.round_no===r.round_no);
      const playedCost=Number(r.summary.cash_used_round||0);
      const chps=expected.map(s=>{
        const required=(d.answer_key||[]).filter(a=>a.round_no===r.round_no&&a.site===s.site&&a.chp_code===s.chp_code&&a.source===s.source);
        const expectedIds=new Set(required.map(a=>a.card_key));
        const missing=new Set(s.missing_cards||[]);
        const wasted=new Set(s.wasted_cards||[]);
        const placed=actual.filter(a=>a.site===s.site&&a.chp_code===s.chp_code).sort((a,b)=>a.position-b.position);
        const expectedRows=required.map(a=>'<div class="compare-line"><b>#'+a.seq+'</b><span>'+esc(a.title)+'</span><small>'+esc(a.role)+'</small></div>').join('')||'<p class="muted">CHP นี้ไม่มี Action ที่ต้องลงตาม Source</p>';
        const actualRows=placed.map((p,i)=>{
          const info=catalog.get(p.card_key)||{};
          const label=missing.has(p.card_key)?'MISSING':wasted.has(p.card_key)?'WASTED':!expectedIds.has(p.card_key)?'EXTRA':'PLAYED';
          const actor=members.get(p.actor_member_id);
          return '<div class="compare-line"><b>#'+(i+1)+'</b><span>'+esc(info.title||p.card_key)+'<small>'+esc(actor?.display_name||'Unknown')+' · '+esc(p.created_at?new Date(p.created_at).toLocaleTimeString('th-TH'):'')+'</small></span><em class="audit-tag '+label.toLowerCase()+'">'+label+'</em></div>';
        }).join('')||'<p class="muted">ไม่ได้วาง Action</p>';
        const missingRows=[...missing].filter(k=>!placed.some(p=>p.card_key===k)).map(k=>'<div class="audit-missing">ขาด: '+esc(catalog.get(k)?.title||k)+'</div>').join('');
        return '<details class="chp-audit"><summary><b>'+esc(s.site)+' · '+esc(s.chp_code)+' · Level '+Number(s.actual_level)+'</b><span>BC −'+Number(s.chp_loss||0)+' · '+Number(s.response_cards||0)+'/'+Number(s.expected_cards||0)+' Actions</span></summary><div class="compare-grid"><div><h4>EXPECTED / ลำดับที่ควรใช้</h4>'+expectedRows+'</div><div><h4>ACTUAL / ทีมวางจริง</h4>'+actualRows+missingRows+'</div></div></details>';
      }).join('');
      const extras=actual.filter(a=>!expected.some(s=>s.site===a.site&&s.chp_code===a.chp_code));
      const extraHtml=extras.length?'<details class="chp-audit"><summary><b>EXTRA CHP / นอก Scenario</b><span>'+extras.length+' Actions</span></summary>'+extras.map(p=>'<div class="audit-missing">'+esc(p.site+' · '+p.chp_code+' · '+(catalog.get(p.card_key)?.title||p.card_key))+'</div>').join('')+'</details>':'';
      return '<details class="debrief-round" '+(idx===0?'open':'')+'><summary><span>ROUND '+r.round_no+'</span><b>BC −'+r.summary.bc_loss+' · CASH ฿'+money(playedCost)+'</b></summary><div class="round-analysis"><p class="muted">Expected Action Cost ฿'+money(expectedCost)+' · Actual Cash Charged ฿'+money(playedCost)+' · ต่างกัน ฿'+money(playedCost-expectedCost)+' (ค่าใช้จ่ายต่ำกว่าไม่ได้แปลว่าเล่นถูก ถ้าขาด Action)</p>'+chps+extraHtml+'</div></details>';
    }).join('');
    const events=(d.replay||[]).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    const history='<details class="panel full-replay"><summary>Event Replay · '+events.length+' เหตุการณ์</summary><div class="replay-list">'+events.map(e=>replayEventLabel(e,catalog,members)).join('')+'</div></details>';
    const headline=isDefeat?'MISSION FAILED · BC = 0':'SIMULATION COMPLETE';
    const feedbackView='<section class="panel playtest-panel"><div class="panel-head"><div><span class="eyebrow">PLAYTEST INSTRUMENT</span><h2>ประเมินคุณภาพ Board Game ต้นแบบ</h2><p>5 มิติของการทดสอบ ก่อนออกแบบกิจกรรมจริง</p></div></div><div id="feedbackResults">'+feedbackStatsHtml(feedback)+'</div><div class="feedback-form">'+playtestFormHtml(!!state.me.role_key)+'</div></section>';
    shell('<main class="page debrief-page">'+(consequence&&!sessionStorage.getItem(consequenceKey(consequence.round_no))?consequenceHtml():'')+'<section class="panel debrief-intro"><span class="eyebrow">'+esc(headline)+'</span><h1>Debrief & Decision Replay</h1><p>เทียบ Action ที่ควรใช้กับสิ่งที่ทีมตัดสินใจจริง เพื่อหาจุดปรับปรุงของเกม</p>'+totals+'<div class="result-grid">'+roundup+'</div></section><section class="panel debrief-analysis"><div class="panel-head"><div><h2>Expected vs Actual</h2><p>เฉลย CHP / Level / Missing / Wasted / Extra เปิดเฉพาะเมื่อ Simulation จบ</p></div></div>'+comparisons+'</section>'+history+feedbackView+'</main>','<button id="leaveBtn" class="btn small ghost">ออก</button>');
    $('#leaveBtn').onclick=e=>leave(e.currentTarget);
    if($('#savePlaytestFeedback'))$('#savePlaytestFeedback').onclick=e=>savePlaytestFeedback(e.currentTarget);
  }catch(e){
    toast('Debrief โหลดไม่สำเร็จ: '+errText(e),'error');
    const p=document.querySelector('.page .panel p');if(p)p.textContent='โหลด Debrief ไม่สำเร็จ กรุณา Refresh หรือกลับเข้า Session ใหม่';
  }
}

async function heartbeat(){
  if(!session||!state)return;
  const token=adminToken();
  try{
    const h=await rpc('bcp_web_heartbeat',{p_room_id:session.roomId,p_session_token:token});
    if(h?.server_now) serverOffsetMs=new Date(h.server_now).getTime()-Date.now();
    setConnectionState('online');
    if(h.room_status==='closed') await refresh();
  }catch(e){
    setConnectionState(navigator.onLine?'degraded':'offline');
    if((e?.message||'').includes('MEMBER_REQUIRED')&&!session.adminToken){
      toast('Session นี้หมดอายุหรือออกจากห้องแล้ว','error');
    }
  }
}
function startRealtime(){
  stopRealtime(false);
  channel=sb.channel('bcp-room-'+session.roomId)
    .on('postgres_changes',{event:'*',schema:'public',table:'bcp_web_live_signals',filter:'room_id=eq.'+session.roomId},()=>setTimeout(()=>refresh(),120))
    .subscribe(status=>{
      if(status==='SUBSCRIBED') setConnectionState('online');
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED') setConnectionState(navigator.onLine?'degraded':'offline');
    });
  refreshTimer=setInterval(()=>refresh(),30000);
  heartbeatTimer=setInterval(heartbeat,15000);
  heartbeat();
}
function stopRealtime(clearClock=true){
  if(channel){sb.removeChannel(channel);channel=null;}
  if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
  if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
  if(clearClock&&clockTimer){clearInterval(clockTimer);clockTimer=null;}
}

document.addEventListener('pointerdown',e=>{
  const btn=e.target.closest('button');
  if(btn)pulseButton(btn);
});

window.addEventListener('online',()=>{setConnectionState('connecting');if(session){heartbeat();refresh();}});
window.addEventListener('offline',()=>setConnectionState('offline'));

landing();
if(session) refresh(true);
