const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const a=source.indexOf('function storyHtml(){'),b=source.indexOf('function statsHtml(){',a);
assert.ok(a>=0&&b>a,'story component exists');
const factory=new Function('state','esc',source.slice(a,b)+'\nreturn storyHtml;');
const esc=v=>String(v??'');
const data={room:{current_round:1,twist_revealed:true},
 story:{big_story:'SHARED CONTEXT',site_story:'PRIVATE FIELD ONLY',twist_story:'GENERAL TWIST',site_twist_story:'PRIVATE TWIST'}};
for(const role of ['CMD_HO','CMD_PPD','CMD_NKL','CMC',null]){
 const html=factory({...data,me:{role_key:role}},esc)();
 assert.ok(html.includes('SHARED CONTEXT'));
 assert.ok(!html.includes('PRIVATE FIELD ONLY'),role+' leaked field Brief');
 assert.ok(!html.includes('PRIVATE TWIST'),role+' leaked field Twist');
}
for(const role of ['CMT_HO','CMT_PPD','CMT_NKL']){
 const html=factory({...data,me:{role_key:role}},esc)();
 assert.ok(html.includes('MY SITE BRIEF'),role+' misses brief title');
 assert.ok(html.includes('PRIVATE FIELD ONLY'));
 assert.ok(html.includes('PRIVATE TWIST'));
}
console.log('PASS: all three CMT/LRTs field brief views, no CMC/CMD field brief or Site Twist.');
