const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const screenshots=path.join(__dirname,'screenshots','central');
fs.mkdirSync(screenshots,{recursive:true});
const mock={
  server_now:new Date().toISOString(),
  room:{id:'00000000-0000-4000-8000-000000000001',code:'ABC123',title:'BCP Workshop Test',status:'playing',
    scenario_set:1,current_round:2,business_continuity:84,starting_cash:11000000,cash_remaining:9450000,
    round_ends_at:new Date(Date.now()+8*60*1000).toISOString(),paused_at:null,twist_revealed:true,revision:7},
  story:{big_story:'ช่วงเวลาจำลอง: วันที่ 2 — เกิดแนวฝนชุดใหม่และการประเมินภายหลังเหตุการณ์ สำนักงานใหญ่และโรงงานทั้งสองแห่งต้องประสานข้อมูลเพื่อรักษาความต่อเนื่องทางธุรกิจ',
    twist_story:'เวลา 14.05 น. เกิดฟ้าผ่าบริเวณสายส่ง ทำให้ระบบไฟฟ้าสะดุดและต้องประเมินการฟื้นฟูการผลิต'},
  players:['CMC','CMD_HO','CMD_PPD','CMD_NKL','CMT_HO','CMT_PPD','CMT_NKL'].map((role,i)=>({role,ready:i<4,online:true,virtual:i>1})),
  actions:Array.from({length:16},(_,i)=>({site:['HO','PPD','NKL'][i%3],chp_code:'CHP-'+(i%3+4),title:'ตรวจสอบมาตรการอาคารและความพร้อมงานทางไกล ตามสถานการณ์ที่เกิดขึ้นในพื้นที่',position:i+1,cash_cost:85000,role:'CMT'})),
  results:[{round:1,bc_loss:12,bc_after:88,cash_used:1200000,cash_after:9800000,outcome:'ควบคุมเหตุการณ์ได้ แต่มีช่องว่างบางส่วนในการตอบสนอง'}],
  events:Array.from({length:12},(_,i)=>({id:i+1,at:new Date(Date.now()-i*10000).toISOString(),round:2,type:i===0?'twist_revealed':'action_played',site:'HO',chp:'CHP-4',title:'ประเมินความพร้อมทางไกล',role:'CMD_HO'}))
};
const mimetypes={'.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.js':'text/javascript;charset=utf-8','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+p);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(e,data)=>{
    if(e){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',mimetypes[path.extname(file)]||'application/octet-stream');
    res.end(data);
  });
});
const run=async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const browser=await chromium.launch({headless:true});
  try{
    for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[390,844]]){
      const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
      const errors=[];
      page.on('pageerror',e=>errors.push(String(e)));
      await page.addInitScript(payload=>{window.__mockBcpDisplay=payload;},mock);
      await page.route('https://esm.sh/**',route=>route.fulfill({
        status:200,contentType:'text/javascript',
        body:'export const createClient=()=>({rpc:async()=>({data:window.__mockBcpDisplay,error:null})});'
      }));
      const url='http://127.0.0.1:'+port+'/display.html#room='+mock.room.id+'&token='+'a'.repeat(64);
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.locator('.kpi-grid .kpi').first().waitFor({timeout:10000});
      await page.locator('.site-board').first().waitFor();
      const values=await page.evaluate(()=>({
        documentWidth:document.documentElement.scrollWidth,
        viewportWidth:innerWidth,
        siteCount:document.querySelectorAll('.site-board').length,
        eventCount:document.querySelectorAll('.event-row').length,
        kpiCount:document.querySelectorAll('.kpi').length,
        privateDataVisible:document.body.textContent.includes('PRIVATE ACTION HAND'),
        accessInHash:location.hash.includes('token='),
        fullscreenButton:!!document.querySelector('#fullscreenBtn'),
        badge:document.querySelector('.round-badge')?.textContent,
        cash:document.querySelector('.kpi-cash strong')?.textContent
      }));
      assert.equal(errors.length,0,'No JS errors: '+errors.join(';'));
      assert.equal(values.siteCount,3);
      assert.equal(values.kpiCount,4);
      assert.ok(values.eventCount>0);
      assert.ok(values.documentWidth<=width+2,'No horizontal overflow at '+width+'px');
      assert.ok(!values.privateDataVisible,'No private role hands');
      assert.ok(!values.accessInHash,'Viewer bearer token scrubbed from address bar');
      assert.ok(values.fullscreenButton);
      assert.ok(values.cash.includes('9,450,000'));
      await page.screenshot({path:path.join(screenshots,'display-'+width+'.png'),fullPage:true});
      console.log('PASS central display',width+'x'+height,'3 sites / 4 KPIs / events / token hidden / no overflow');
      await page.close();
    }
    console.log('CENTRAL DISPLAY REGRESSION PASS');
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
};
run().catch(error=>{console.error(error);server.close();process.exitCode=1});
