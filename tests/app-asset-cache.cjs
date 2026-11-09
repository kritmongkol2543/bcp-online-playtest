const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('app.js','utf8');
assert.match(html,/app\.js\?v=20261109\.1/,'published app.js revision must change after critical fix');
assert.ok(js.includes("$$('[data-chp-info]').forEach"),'CHP guide crash must remain fixed');
assert.ok(js.includes('function startClock()'),'round clock must be available');
assert.ok(js.includes("$$('[data-quick-place]').forEach"),'place-card handlers must be available');
console.log('PASS published app.js URL changed, game handler, clock and place-card code present');
