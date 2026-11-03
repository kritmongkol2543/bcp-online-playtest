const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function game(){');
const end = source.indexOf('function availableSitesForCard(', start);
assert.ok(start >= 0 && end > start, 'game() source must exist');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(html.includes('app.js?v=20261103.2'), 'HTML must invalidate stale gameplay JavaScript');


let clockStarts = 0;
let openedGuide = null;
let stopped = false;
const info = {dataset:{chpInfo:'CHP-2'}, onclick:null};
const leave = {onclick:null};
const context = {
  state:{room:{paused_at:null,current_round:1},me:{role_key:'CMT_HO'}},
  session:{}, ROLE_LABEL:{CMT_HO:'CMT / LRTs HO'}, selectedChp:null, selectedCard:null,
  esc:value=>String(value ?? ''),
  hasAdminControl:()=>false,
  soloSwitcher:()=>'', consequenceHtml:()=>'', statsHtml:()=>'',
  workflowHtml:()=>'', storyHtml:()=>'', handHtml:()=>'', decksHtml:()=>'',
  teamHtml:()=>'', shell:()=>{},
  $:selector=>selector==='#leaveBtn'?leave:selector==='[data-chp-info]'?info:null,
  $$:selector=>selector==='[data-chp-info]'?[info]:[],
  document:{getElementById:()=>null,querySelector:()=>null},
  requestAnimationFrame:()=>{},
  showChpGuide:(chp,button)=>{openedGuide={chp,button};},
  startClock:()=>{clockStarts++;},
};
vm.runInNewContext(source.slice(start,end)+'\ngame();',context,{timeout:2500});
assert.equal(clockStarts,1,'game initialization reaches startClock');
assert.equal(typeof info.onclick,'function','private CHP guide click handler is bound');
info.onclick({stopPropagation(){stopped=true;}});
assert.ok(stopped,'CHP information click must not select its underlying deck');
assert.equal(openedGuide.chp,'CHP-2');
assert.equal(openedGuide.button,info);
assert.equal(typeof leave.onclick,'function','leave handler is bound');
console.log('PASS: player game initializes, CHP info click works, clock starts and Leave is bound.');
