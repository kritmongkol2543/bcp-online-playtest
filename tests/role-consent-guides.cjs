const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const js=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=js.indexOf('function lobby(){'),end=js.indexOf('function syncRoleInvitation(){',start);
assert.ok(start>=0&&end>start);
let rendered='', synced=false;
const roles=['CMC','CMD_HO','CMD_PPD','CMD_NKL','CMT_HO','CMT_PPD','CMT_NKL'];
const ROLE_LABEL=Object.fromEntries(roles.map(k=>[k,k]));
const m1={id:'memberA',role_key:null,pending_role_key:'CMD_HO',display_name:'Tester A',is_admin:false,is_bot:false,online:true};
const admin={id:'admin',role_key:null,pending_role_key:null,display_name:'Host',is_admin:true,is_bot:false,online:true};
const state={room:{id:'room',code:'TEST01',title:'Role acceptance test'},me:{is_admin:true},members:[admin,m1]};
const script=js.slice(start,end)+'\nreturn lobby;';
const fn=new Function('state','session','ROLES','ROLE_LABEL','esc','shell','$','$$','syncRoleInvitation',
  'leave','closeRoomNow','claimAdmin','toggleSoloTest','startGame','rpc','refresh','toast','errText',
  script)(
  state,{soloSessions:null},roles,ROLE_LABEL,s=>String(s??''),
  html=>{rendered=html;},
  ()=>({}),()=>[],()=>{synced=true;},
  ()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},()=>{},()=>{}
);
fn();
assert.ok(synced,'Pending Role popup hook executed');
assert.ok(rendered.includes('WAITING FOR CONFIRMATION'),'Admin sees pending status');
assert.ok(rendered.includes('Tester A'),'Admin can identify invitee');
assert.ok(rendered.includes('0/7'),'Pending invitation not counted as confirmed');
assert.ok(rendered.includes('id="startBtn"')&&rendered.includes('id="startBtn" class="btn primary full" disabled'),'Cannot start until 7 confirmations');
state.members[1]={...m1,role_key:'CMD_HO',pending_role_key:null};
fn();
assert.ok(rendered.includes('CONFIRMED · Tester A'),'Shows accepted Role owner only after confirmation');
assert.ok(rendered.includes('1/7'),'Confirmed Role increases count');
assert.ok(js.includes("rpc('bcp_web_confirm_role'"),'Recipient accepts via server RPC');
assert.ok(js.includes('data-chp-info='),'Each CHP Deck has an i button');
assert.ok(js.includes('bcp_web_get_chp_guide'),'CHP guidance is fetched from Supabase, not shipped as document');
assert.ok(js.includes("e.stopPropagation();showChpGuide"),'CHP info does not select the underlying Deck');
console.log('PASS Role confirmation Wait -> Confirmed, 0/7 -> 1/7, start gated, CHP i guides private.');
