const assert=require('node:assert/strict');
const fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const a=src.indexOf('function teamHtml(){');
const b=src.indexOf('function game(){',a);
assert.ok(a>=0&&b>a);
const render=new Function('state','session','hasAdminControl','ROLE_LABEL','ROLES','esc',
  src.slice(a,b)+'\nreturn teamHtml;');
const roles=['CMC','CMD_HO','CMD_PPD','CMD_NKL','CMT_HO','CMT_PPD','CMT_NKL'];
const make=(isAdmin,isTest)=>render(
  {room:{is_test_mode:isTest,current_round:2,twist_revealed:false,paused_at:null},me:{role_key:null,is_admin:isAdmin,ready_to_lock:false},
    members:roles.map((x,i)=>({role_key:x,id:'p'+i,is_bot:isTest,online:true,display_name:'Tester '+i,ready_to_lock:i<2}))},
  {adminToken:'adminToken',soloSessions:[]},
  ()=>isAdmin,
  Object.fromEntries(roles.map(r=>[r,r])),roles,(v)=>String(v??'')
)();
for(const isTest of [true,false]){
 const html=make(true,isTest);
 for(const id of ['adminTwistBtn','adminReadyAllBtn','adminFinishBtn'])
  assert.ok(html.includes('id="'+id+'"'),'Admin must see '+id+' in '+(isTest?'Solo':'Human')+' room');
 assert.ok(html.includes('ADMIN OVERRIDE'));
}
const other=make(false,false);
for(const id of ['adminTwistBtn','adminReadyAllBtn','adminFinishBtn'])
 assert.ok(!other.includes('id="'+id+'"'),'Non-admin must not see '+id);
for(const [label,call] of [['reveal',"p_action:'reveal_twist'"],['end',"p_action:finishGame?'finish_game':'end_round'"]])
 assert.ok(src.includes(call),'Missing actual override RPC for '+label);
assert.ok(src.includes('withButtonBusy(btn'), 'Must show loading during RPC');
assert.ok(src.includes("prompt('พิมพ์ FINISH"),'Force game finish requires deliberate typed confirmation');
console.log('PASS: Human and Solo admins show all 3 overrides; non-admin sees none; actions confirm and load.');
