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
let selectedDeck = null;
let serverOffsetMs = 0;
let connectionState = navigator.onLine ? 'connecting' : 'offline';
let pendingRequests = 0;

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
function selectedDeckData(){ return (state?.decks||[]).find(d=>d.id===selectedDeck)||null; }
function cardSiteType(card){ return String(card?.card_key||'').split(':')[0]||''; }
function canRolePlayDeck(role,deck){
  if(!role||!deck)return false;
  return role==='CMC'||roleSite(role)===deck.site;
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
  return '<header class="topbar"><div class="brand"><div class="brand-mark">BCP</div><div><b>ONLINE PLAYTEST</b><small>Business Continuity Simulation</small></div></div><div class="top-actions">'+connectionBadge()+extra+'</div></header>';
}
function shell(html,extra=''){ $('#app').innerHTML='<div class="shell">'+topbar(extra)+html+'</div>'; }

function landing(){
  stopRealtime(); state=null;
  shell('<main class="landing"><section class="hero panel"><span class="eyebrow">TEAM CRISIS SIMULATION</span><h1>ตัดสินใจภายใต้<br>ความกดดันจริง</h1><p>BCP Online Playtest สำหรับ 7 Role — คุยกันจริง เห็นข้อมูลต่างกัน วาง Action ร่วมกันแบบ Realtime</p><div class="hero-grid"><div><b>7 Roles</b><span>CMC · CMD ×3 · CMT/LRTs ×3</span></div><div><b>4 Rounds</b><span>Scenario → Decision → Twist → Lock</span></div><div><b>Realtime</b><span>Action Timeline และ Team Ready</span></div></div></section><section class="panel join-panel"><div class="tabs"><button id="tabJoin" class="tab active">Join Room</button><button id="tabCreate" class="tab">Create Room</button></div><div id="joinForm"><label>ชื่อผู้เล่น<input id="playerName" maxlength="60" placeholder="ชื่อที่ใช้ในเกม"></label><label>Room Code<input id="roomCode" maxlength="6" class="code-input" placeholder="ABC123"></label><button id="joinBtn" class="btn primary">เข้าห้องเกม</button></div><div id="createForm" hidden><label>ชื่อ Admin<input id="adminName" maxlength="60" placeholder="ชื่อ Admin / ผู้เล่น"></label><label>ชื่อห้อง<input id="roomTitle" maxlength="100" value="BCP Online Playtest"></label><button id="createBtn" class="btn primary">สร้างห้องเกม</button></div>'+(session?'<button id="resumeBtn" class="btn ghost full">กลับเข้าสู่ Session ล่าสุด</button>':'')+'</section></main>');
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
    if(selectedDeck && !(state.decks||[]).some(d=>d.id===selectedDeck)){
      selectedDeck=null;
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
  const memberList=members.map(m=>'<div class="member"><span class="presence '+(m.is_bot?'bot':m.online?'online':'offline')+'"></span><div><b>'+esc(m.display_name)+'</b><small>'+esc(m.role_key?ROLE_LABEL[m.role_key]:'Waiting')+(m.is_admin?' · Admin':'')+(m.is_bot?' · BOT':'')+'</small></div><span class="presence-label">'+(m.is_bot?'BOT':m.online?'ONLINE':'OFFLINE')+'</span></div>').join('');
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
  selectedDeck=null;
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
  const decks=state.decks||[],placements=state.placements||[];
  const paused=!!state.room.paused_at;
  const bySite={HO:[],PPD:[],NKL:[]};
  decks.forEach(d=>bySite[d.site].push(d));

  return '<section class="panel decision"><div class="panel-head"><div><span class="eyebrow">STEP 1 · CHOOSE CHP</span><h2>CHP Decision Decks</h2><p>เลือก CHP Deck ก่อน แล้วระบบจะแสดงเฉพาะ Action Cards ที่เกี่ยวข้องกับ CHP + Site นั้น</p></div></div><div class="site-columns">'+['HO','PPD','NKL'].map(site=>'<div class="site-col"><div class="site-head"><b>'+site+'</b>'+(roleSite(state.me.role_key)===site?'<button class="btn small" data-add-deck="'+site+'" '+(paused?'disabled':'')+'>+ เพิ่ม CHP</button>':'')+'</div><div class="deck-list">'+(bySite[site].length?bySite[site].sort((a,b)=>a.deck_order-b.deck_order).map(d=>{
    const cards=placements.filter(p=>p.deck_id===d.id).sort((a,b)=>a.position-b.position);
    const selected=selectedDeck===d.id;
    return '<div class="deck '+(selected?'selected':'')+'" data-deck="'+d.id+'" tabindex="0" role="button" aria-pressed="'+selected+'"><div class="deck-head"><div><div class="deck-title-row"><b>'+esc(d.chp_code)+'</b>'+(selected?'<span class="selected-chip">SELECTED</span>':'')+'</div><span>'+site+' · Level '+d.selected_level+'</span></div>'+(roleSite(state.me.role_key)===site?'<button class="icon-btn" title="ลบ CHP Deck" data-remove-deck="'+d.id+'" '+(paused?'disabled':'')+'>×</button>':'')+'</div><div class="dropzone '+(selected?'active-target':'')+'" data-drop="'+d.id+'">'+(cards.length?cards.map((p,i)=>'<div class="placed-card" draggable="'+(!paused)+'" data-place="'+p.id+'" data-deck="'+d.id+'"><span class="seq">'+(i+1)+'</span><div><b>'+esc(p.title)+'</b><small>'+esc(p.role)+' · ฿'+money(p.cash_cost)+'</small></div><div class="placed-controls"><button class="icon-btn" title="เลื่อนขึ้น" data-move="-1" data-place="'+p.id+'" data-deck="'+d.id+'" '+(paused?'disabled':'')+'>↑</button><button class="icon-btn" title="เลื่อนลง" data-move="1" data-place="'+p.id+'" data-deck="'+d.id+'" '+(paused?'disabled':'')+'>↓</button>'+(p.placed_by_member_id===state.me.id?'<button class="icon-btn" title="นำออก" data-remove-action="'+p.id+'" '+(paused?'disabled':'')+'>×</button>':'')+'</div></div>').join(''):'<div class="empty">'+(selected?'พร้อมรับ Action Card — ลากมาวางตรงนี้':'กด Deck นี้ก่อนเพื่อเลือก')+'</div>')+'</div></div>';
  }).join(''):'<div class="empty site-empty">ยังไม่มี CHP Deck</div>')+'</div></div>').join('')+'</div></section>';
}
function handHtml(){
  const hand=state.hand||[];
  const paused=!!state.room.paused_at;
  const deck=selectedDeckData();
  const role=state.me.role_key;

  if(!role){
    return '<section class="panel hand hand-locked"><div class="panel-head"><div><span class="eyebrow">ADMIN CONSOLE</span><h2>Action Cards ถูกซ่อน</h2><p>Admin Console ใช้ควบคุม Session ไม่ใช่ Game Role — สลับ TEST VIEW ไป CMC / CMD / CMT เพื่อเล่นการ์ด</p></div></div><div class="hand-empty-state"><span>ADMIN</span><b>เลือก Game Role เพื่อทดสอบการเล่น</b></div></section>';
  }

  if(!deck){
    return '<section class="panel hand hand-locked"><div class="panel-head"><div><span class="eyebrow">STEP 2 · ACTION CARDS</span><h2>'+esc(ROLE_LABEL[role]||'My Cards')+'</h2><p>Action Cards จะยังไม่เปิดจนกว่าจะเลือก CHP Deck ด้านบนก่อน</p></div></div><div class="hand-empty-state"><span>01</span><b>กดเลือก CHP Deck ที่ต้องการตอบสนอง</b><small>จากนั้นจะแสดงเฉพาะการ์ดของ CHP + Site นั้น</small></div></section>';
  }

  if(!canRolePlayDeck(role,deck)){
    return '<section class="panel hand hand-locked"><div class="panel-head"><div><span class="eyebrow">STEP 2 · ACTION CARDS</span><h2>'+esc(deck.chp_code)+' · '+esc(deck.site)+'</h2><p>คุณดู Decision Timeline ของ Site นี้ได้ แต่ Role ปัจจุบันวาง Action ลง Site นี้ไม่ได้</p></div></div><div class="hand-empty-state"><span>LOCK</span><b>สลับไป Role ของ '+esc(deck.site)+' หรือ CMC</b></div></section>';
  }

  const expectedSiteType=deck.site==='HO'?'HO':'Factory';
  const cards=hand.filter(c=>c.chp_code===deck.chp_code&&cardSiteType(c)===expectedSiteType);
  const used=new Set((state.placements||[]).map(p=>p.card_key));

  return '<section class="panel hand cards-reveal"><div class="panel-head"><div><span class="eyebrow">STEP 2 · CHOOSE ACTION</span><h2>'+esc(deck.chp_code)+' · '+esc(deck.site)+' · Level '+deck.selected_level+'</h2><p>'+esc(ROLE_LABEL[role])+' · ลากลง Deck หรือคลิกขวาเพื่อวางทันที · Mobile ใช้ปุ่ม “วาง”</p></div><button id="clearDeckSelection" class="btn small ghost">เปลี่ยน CHP</button></div>'+(cards.length?'<div class="hand-grid">'+cards.map(c=>'<article class="action-card '+(used.has(c.card_key)?'used':'')+(paused?' paused':'')+(selectedCard===c.card_key?' selected':'')+'" draggable="'+(!used.has(c.card_key)&&!paused)+'" data-card="'+esc(c.card_key)+'"><div class="card-top"><span>'+esc(c.chp_code)+'</span><strong>฿'+money(c.cash_cost)+'</strong></div><h3>'+esc(c.title)+'</h3><p>'+esc(c.detail).replace(/\n/g,'<br>')+'</p><footer><span>'+esc(c.role)+'</span>'+(!used.has(c.card_key)?'<button class="card-place-btn" data-place-card="'+esc(c.card_key)+'" '+(paused?'disabled':'')+'>วาง</button>':'<span class="used-label">USED</span>')+'</footer></article>').join('')+'</div>':'<div class="hand-empty-state"><span>0</span><b>Role นี้ไม่มี Action Card สำหรับ '+esc(deck.chp_code)+'</b><small>ไม่ใช่ทุก Role ต้องมี Action ในทุก CHP</small></div>')+'</section>';
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
  return '<aside class="panel team-panel"><div class="panel-head"><div><h3>Team Status</h3><p>'+esc(ROLE_LABEL[state.me.role_key]||(admin?'Admin Console':''))+'</p></div></div><div class="member-list">'+members.map(m=>'<div class="member"><span class="presence '+(m.is_bot?'bot':m.online?'online':'offline')+(m.ready_to_lock?' ready':'')+'"></span><div><b>'+esc(ROLE_LABEL[m.role_key])+'</b><small>'+esc(m.display_name)+(m.is_bot?' · BOT':'')+'</small></div><span class="ready-text">'+(m.ready_to_lock?'READY':m.is_bot?'BOT':m.online?'ONLINE':'OFFLINE')+'</span></div>').join('')+'</div>'+readyControl+adminPanel+'</aside>';
}
function game(){
  const viewLabel=state.me.role_key?ROLE_LABEL[state.me.role_key]:(hasAdminControl()?'ADMIN CONSOLE':'Waiting Role');
  const extra=soloSwitcher()+'<span class="role-pill">'+esc(viewLabel)+'</span><button id="leaveBtn" class="btn small ghost">ออก</button>';
  shell('<main class="page">'+statsHtml()+(state.room.paused_at?'<div class="pause-banner"><b>GAME PAUSED</b><span>Timer และการเปลี่ยน Decision ถูกหยุดชั่วคราว — Admin Resume เพื่อเล่นต่อ</span></div>':'')+'<div class="game-layout"><div class="main-stack">'+storyHtml()+decksHtml()+handHtml()+'</div>'+teamHtml()+'</div></main>',extra);

  $('#leaveBtn').onclick=e=>leave(e.currentTarget);
  if($('#soloRoleSwitcher')) $('#soloRoleSwitcher').onchange=e=>switchSoloRole(e.target.value);
  if($('#readyBtn')) $('#readyBtn').onclick=e=>toggleReady(e.currentTarget);
  if($('#claimAdminBtn')) $('#claimAdminBtn').onclick=e=>claimAdmin(e.currentTarget);
  if($('#pauseBtn')) $('#pauseBtn').onclick=e=>togglePause(e.currentTarget);
  if($('#extendBtn')) $('#extendBtn').onclick=e=>extendRound(e.currentTarget);
  if($('#lateJoinBtn')) $('#lateJoinBtn').onclick=e=>openLateJoin(e.currentTarget);
  if($('#closeRoomBtn')) $('#closeRoomBtn').onclick=e=>closeRoomNow(e.currentTarget);
  if($('#recoverRoleBtn')) $('#recoverRoleBtn').onclick=e=>recoverRole(e.currentTarget);
  if($('#clearDeckSelection')) $('#clearDeckSelection').onclick=()=>{selectedDeck=null;selectedCard=null;game();};

  $$('[data-add-deck]').forEach(b=>b.onclick=e=>addDeck(b.dataset.addDeck,e.currentTarget));
  $$('[data-remove-deck]').forEach(b=>b.onclick=e=>{e.stopPropagation();removeDeck(b.dataset.removeDeck,e.currentTarget);});
  $$('[data-remove-action]').forEach(b=>b.onclick=e=>{e.stopPropagation();removeAction(b.dataset.removeAction,e.currentTarget);});
  $$('[data-move]').forEach(b=>b.onclick=e=>{e.stopPropagation();movePlacement(b.dataset.deck,b.dataset.place,+b.dataset.move,e.currentTarget);});

  $$('[data-deck]').forEach(d=>{
    const choose=()=>{
      selectedDeck=d.dataset.deck;
      selectedCard=null;
      game();
      requestAnimationFrame(()=>document.querySelector('.hand')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    };
    d.onclick=e=>{if(e.target.closest('button'))return;choose();};
    d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};
  });

  $$('[data-card]').forEach(c=>{
    c.onclick=e=>{
      if(e.target.closest('button')||state.room.paused_at||c.classList.contains('used'))return;
      selectedCard=c.dataset.card;
      $$('.action-card').forEach(x=>x.classList.toggle('selected',x===c));
    };
    c.oncontextmenu=e=>{
      e.preventDefault();
      if(state.room.paused_at||c.classList.contains('used'))return;
      placeCard(c.dataset.card,selectedDeck,null);
    };
    c.ondragstart=e=>{
      if(!selectedDeck||state.room.paused_at||c.classList.contains('used')){e.preventDefault();return;}
      selectedCard=c.dataset.card;
      e.dataTransfer.effectAllowed='copy';
      e.dataTransfer.setData('application/x-bcp-card',c.dataset.card);
    };
  });

  $$('[data-place-card]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    placeCard(b.dataset.placeCard,selectedDeck,e.currentTarget);
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

  $$('[data-drop]').forEach(z=>{
    z.ondragover=e=>{
      const types=[...e.dataTransfer.types];
      const card=types.includes('application/x-bcp-card');
      const placement=types.includes('application/x-bcp-placement');
      if(card&&z.dataset.drop!==selectedDeck)return;
      if(!card&&!placement)return;
      e.preventDefault();
      z.classList.add('dragover');
    };
    z.ondragleave=()=>z.classList.remove('dragover');
    z.ondrop=e=>{
      e.preventDefault();
      z.classList.remove('dragover');
      const placement=e.dataTransfer.getData('application/x-bcp-placement');
      if(placement)return;
      const card=e.dataTransfer.getData('application/x-bcp-card')||selectedCard;
      if(z.dataset.drop!==selectedDeck){
        toast('เลือก CHP Deck นี้ก่อน จึงจะวาง Action ได้','error');
        return;
      }
      if(card)placeCard(card,z.dataset.drop,null);
    };
  });

  startClock();
  showLatestResult();
}
function addDeck(site,triggerBtn){
  pulseButton(triggerBtn);
  const overlay=document.createElement('div');
  overlay.className='modal-backdrop';
  let selectedChp=null;
  let selectedLevel=1;
  const chps=Array.from({length:14},(_,i)=>'CHP-'+(i+1));

  overlay.innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-label="เพิ่ม CHP Deck"><div class="modal-head"><div><span class="eyebrow">STEP 1 · '+esc(site)+'</span><h2>เลือก CHP ก่อน</h2><p>เลือก CHP ที่ทีมประเมินว่าเกี่ยวข้อง แล้วจึงสร้าง Deck เพื่อเปิด Action Cards</p></div><button class="icon-btn" data-modal-close>×</button></div><div class="picker-label">CHP · ต้องเลือกก่อน</div><div class="chp-picker">'+chps.map(chp=>'<button class="chp-chip" data-chp="'+chp+'">'+chp+'</button>').join('')+'</div><div class="picker-label">ระดับที่ทีมประเมิน</div><div class="level-picker">'+[1,2,3].map(n=>'<button class="level-chip '+(n===selectedLevel?'active':'')+'" data-level="'+n+'">Level '+n+'</button>').join('')+'</div><div class="modal-actions"><button class="btn ghost" data-modal-cancel>ยกเลิก</button><button class="btn primary" data-modal-confirm disabled>เลือก CHP ก่อน</button></div></div>';

  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.onclick=e=>{if(e.target===overlay)close();};
  $('[data-modal-close]',overlay).onclick=close;
  $('[data-modal-cancel]',overlay).onclick=close;

  $$('[data-chp]',overlay).forEach(b=>b.onclick=()=>{
    selectedChp=b.dataset.chp;
    $$('[data-chp]',overlay).forEach(x=>x.classList.toggle('active',x===b));
    const confirmBtn=$('[data-modal-confirm]',overlay);
    confirmBtn.disabled=false;
    confirmBtn.textContent='สร้าง '+selectedChp+' Deck';
  });
  $$('[data-level]',overlay).forEach(b=>b.onclick=()=>{
    selectedLevel=+b.dataset.level;
    $$('[data-level]',overlay).forEach(x=>x.classList.toggle('active',x===b));
  });
  $('[data-modal-confirm]',overlay).onclick=e=>{
    if(!selectedChp)return;
    commitDeck(site,selectedChp,selectedLevel,e.currentTarget,close);
  };
}

async function commitDeck(site,chp,level,btn,close){
  return withButtonBusy(btn,'กำลังสร้าง Deck…',async()=>{
    try{
      const d=await rpc('bcp_web_add_deck',{p_room_id:state.room.id,p_session_token:session.token,p_site:site,p_chp_code:chp,p_level:level});
      selectedDeck=d.id;
      selectedCard=null;
      close();
      toast(chp+' ถูกเพิ่มแล้ว — เลือก Action Card ต่อได้เลย','success');
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}

async function removeDeck(id,btn){
  if(!confirm('ลบ CHP Deck นี้?'))return;
  return withButtonBusy(btn,'…',async()=>{
    try{
      await rpc('bcp_web_remove_deck',{p_room_id:state.room.id,p_session_token:session.token,p_deck_id:id});
      if(selectedDeck===id){selectedDeck=null;selectedCard=null;}
      await refresh();
    }catch(e){toast(errText(e),'error');}
  });
}

async function placeCard(cardKey,deckId,btn){
  if(!cardKey||!deckId)return toast('เลือก CHP Deck ก่อน','error');
  const deckEl=document.querySelector('[data-deck="'+CSS.escape(deckId)+'"]');
  deckEl?.classList.add('is-working');

  return withButtonBusy(btn,'กำลังวาง…',async()=>{
    try{
      await rpc('bcp_web_play_action',{p_room_id:state.room.id,p_session_token:session.token,p_deck_id:deckId,p_card_key:cardKey});
      selectedCard=null;
      await refresh();
      requestAnimationFrame(()=>{
        const el=document.querySelector('[data-deck="'+CSS.escape(deckId)+'"]');
        el?.classList.add('just-updated');
        setTimeout(()=>el?.classList.remove('just-updated'),650);
      });
    }catch(e){toast(errText(e),'error');}
    finally{deckEl?.classList.remove('is-working');}
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
  const cards=(state.placements||[]).filter(p=>p.deck_id===deckId).sort((a,b)=>a.position-b.position);
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
  const cards=(state.placements||[]).filter(p=>p.deck_id===deckId).sort((a,b)=>a.position-b.position);
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

function startClock(){
  clearInterval(clockTimer);
  const tick=async()=>{
    if(!state||state.room.status!=='playing')return;
    const el=$('#clock');
    if(state.room.paused_at){
      if(el){el.textContent='PAUSED';el.classList.add('warning');}
      return;
    }
    const now=Date.now()+serverOffsetMs, end=new Date(state.room.round_ends_at).getTime(), reveal=state.room.twist_reveal_at?new Date(state.room.twist_reveal_at).getTime():null;
    const sec=Math.max(0,Math.ceil((end-now)/1000)); if(el){el.textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');el.classList.toggle('danger',sec<=60);}
    if(!busy&&!state.room.twist_revealed&&reveal&&now>=reveal&&sec>0){ try{busy=true;const r=await rpc('bcp_web_reveal_twist',{p_room_id:state.room.id,p_session_token:session.token});if(r?.revealed){toast('⚠ CRISIS UPDATE — Twist ถูกเปิดแล้ว','error');await refresh();}}catch{}finally{busy=false;} }
    if(!busy&&sec<=0){ try{busy=true;await rpc('bcp_web_expire_round',{p_room_id:state.room.id,p_session_token:session.token});toast('หมดเวลา — ระบบ Lock Round แล้ว','error');await refresh();}catch{}finally{busy=false;} }
  };
  tick(); clockTimer=setInterval(tick,500);
}
function showLatestResult(){
  const r=(state.round_results||[]).at(-1); if(!r)return;
  const key='seen_'+state.room.id+'_'+r.round_no; if(sessionStorage.getItem(key))return; sessionStorage.setItem(key,'1');
  toast('Round '+r.round_no+' · BC -'+r.bc_loss+' · Cash Used ฿'+money(r.cash_used_round),'success');
}

async function debrief(){
  stopRealtime();
  shell('<main class="page"><section class="panel"><span class="eyebrow">SIMULATION COMPLETE</span><h1>Debrief</h1><p>กำลังโหลดผลสรุปและ Answer Key…</p></section></main>','<button id="leaveBtn" class="btn small ghost">ออก</button>');
  $('#leaveBtn').onclick=e=>leave(e.currentTarget);
  try{
    const d=await rpc('bcp_web_get_debrief',{p_room_id:state.room.id,p_session_token:session.token});
    const rounds=d.rounds.map(r=>'<div class="result-card"><small>ROUND '+r.round_no+'</small><b>BC '+r.summary.bc_after+'</b><span>−'+r.summary.bc_loss+' BC · Cash ฿'+money(r.summary.cash_used_round)+'</span><p>'+esc(r.summary.outcome)+'</p></div>').join('');
    const grouped={}; d.answer_key.forEach(a=>{const k='R'+a.round_no+' · '+a.site+' · '+a.chp_code+' · L'+a.level;(grouped[k]??=[]).push(a);});
    const answer=Object.entries(grouped).map(([k,rows])=>'<div class="answer-group"><div class="answer-head">'+esc(k)+'</div>'+rows.map(x=>'<div class="answer-row"><span>#'+x.seq+'</span><span>'+esc(x.role)+'</span><b>'+esc(x.title)+'</b><span>฿'+money(x.cash_cost)+'</span></div>').join('')+'</div>').join('');
    shell('<main class="page"><section class="panel"><span class="eyebrow">SIMULATION COMPLETE</span><h1>Debrief</h1><div class="debrief-summary"><div><small>FINAL BC</small><b>'+d.room.business_continuity+'</b></div><div><small>CASH REMAINING</small><b>฿'+money(d.room.cash_remaining)+'</b></div></div><div class="result-grid">'+rounds+'</div></section><section class="panel"><div class="panel-head"><div><h2>Answer Key</h2><p>เปิดหลังจบ Round 4 เท่านั้น</p></div></div>'+answer+'</section></main>','<button id="leaveBtn" class="btn small ghost">ออก</button>');
    $('#leaveBtn').onclick=e=>leave(e.currentTarget);
  }catch(e){toast(errText(e),'error');}
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
