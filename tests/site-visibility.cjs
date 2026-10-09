const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('function decksHtml(){');
const end=source.indexOf('function handHtml(){',start);
assert.ok(start>=0 && end>start,'Timeline component missing');
const factory=new Function('state','roleSite','esc','money','chpSort',source.slice(start,end)+'\nreturn decksHtml;');
const roleSite=r=>r?.endsWith('_HO')?'HO':r?.endsWith('_PPD')?'PPD':r?.endsWith('_NKL')?'NKL':null;
const common={
  room:{paused_at:null},
  placements:[
    {id:'h',site:'HO',chp_code:'CHP-4',deck_id:'d1',title:'SECRET HO placement',role:'CMT',position:1,cash_cost:15000,placed_by_member_id:'m1'},
    {id:'p',site:'PPD',chp_code:'CHP-8',deck_id:'d2',title:'SECRET PPD placement',role:'CMD',position:1,cash_cost:21000,placed_by_member_id:'m2'},
    {id:'n',site:'NKL',chp_code:'CHP-1',deck_id:'d3',title:'SECRET NKL placement',role:'CMD',position:1,cash_cost:30000,placed_by_member_id:'m3'}
  ]
};
const render=(role)=>factory(
  {...common,me:{id:'m1',role_key:role}},
  roleSite,x=>String(x??''),n=>Number(n||0).toLocaleString('en-US'),
  (a,b)=>parseInt(a.split('-')[1])-parseInt(b.split('-')[1])
)();
const check=(role,site)=>{
  const html=render(role);
  assert.equal((html.match(/data-site-drop=/g)||[]).length,1,role+' must have one drop zone');
  assert.ok(html.includes('data-site-drop="'+site+'"'),role+' missing own zone');
  for(const foreign of ['HO','PPD','NKL'].filter(x=>x!==site)){
    assert.ok(!html.includes('data-site-drop="'+foreign+'"'),role+' sees foreign zone '+foreign);
    assert.ok(!html.includes('SECRET '+foreign+' placement'),role+' rendered a foreign Action');
  }
};
check('CMD_HO','HO');
check('CMT_HO','HO');
check('CMD_PPD','PPD');
check('CMT_PPD','PPD');
check('CMD_NKL','NKL');
check('CMT_NKL','NKL');
const cmc=render('CMC');
assert.equal((cmc.match(/data-site-drop=/g)||[]).length,3,'CMC must coordinate all sites');
console.log('PASS six CMD/CMT role views are Site-private; CMC retains all three zones.');
