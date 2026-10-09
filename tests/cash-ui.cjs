const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('function statsHtml(){');
const end=source.indexOf('function workflowHtml(){',start);
assert.ok(start>=0&&end>start,'Could not isolate actual Stats component');
const statsFactory=new Function('state','esc','money',source.slice(start,end)+'\nreturn statsHtml;');
const state={
  room:{id:'x',code:'SAMPLE',current_round:2,cash_remaining:10000,cash_committed:10000,cash_reserved:1500,cash_available:8500,business_continuity:92},
  members:[{role_key:'CMT_HO',ready_to_lock:false}]
};
const html=statsFactory(state,x=>String(x),x=>Number(x||0).toLocaleString('en-US'))();
assert.ok(html.includes('CASH AVAILABLE'),'Available label must be present');
assert.ok(html.includes('฿8,500'),'Spendable must exclude reservations');
assert.ok(html.includes('RESERVED ฿1,500'),'Provisional cash is visible');
assert.ok(html.includes('COMMITTED ฿10,000'),'Committed amount stays intact');
assert.ok(!html.includes('CASH AVAILABLE</small><b>฿10,000'),'Avoid showing committed Cash as available');
console.log('PASS: Cash UI displays available 8,500, reserved 1,500, committed 10,000 from real stat component.');
