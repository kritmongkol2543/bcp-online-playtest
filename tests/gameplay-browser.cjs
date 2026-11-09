const fs=require('node:fs');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const src=fs.readFileSync('app.js','utf8').replace(/^import .+$/gm,'');
const css=fs.readFileSync('styles.css','utf8');
const script="const SUPABASE_URL='qa';const SUPABASE_PUBLISHABLE_KEY='qa';const createClient=window.__qaCreateClient;\n"+src;
const roles=['CMC','CMD_HO','CMD_PPD','CMD_NKL','CMT_HO','CMT_PPD','CMT_NKL'];
const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><div id="toast-root"></div></body></html>');});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,960,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.addStyleTag({content:css});
   await page.evaluate(()=>{
    window.__qaCalls=[];
    window.__qaCreateClient=()=>({
     rpc:async(name,args)=>{
      window.__qaCalls.push({name,args});
      if(name==='bcp_web_get_state')return {data:structuredClone(window.__qaState),error:null};
      if(name==='bcp_web_heartbeat')return {data:{server_now:new Date().toISOString(),room_status:'playing'},error:null};
      if(name==='bcp_web_play_action_direct'){
       const card=window.__qaState.hand.find(c=>c.card_key===args.p_card_key);
       window.__qaState.placements.push({id:'placed-new',deck_id:'deck-nkl',site:args.p_site,
        card_key:card.card_key,title:card.title,role:card.role,chp_code:card.chp_code,
        position:2,placed_by_member_id:'p6',cash_cost:card.cash_cost});
       window.__qaState.room.cash_reserved+=card.cash_cost;
       window.__qaState.room.cash_available-=card.cash_cost;
       return {data:{ok:true},error:null};
      }
      if(name==='bcp_web_set_ready'){
       window.__qaState.me.ready_to_lock=args.p_ready;
       const me=window.__qaState.members.find(m=>m.id==='p6');
       me.ready_to_lock=args.p_ready;
       return {data:{ready_to_lock:args.p_ready,ready_count:1,round_locked:false},error:null};
      }
      return {data:{},error:null};
     },
     channel:()=>({on(){return this},subscribe(){return this}}),
     removeChannel(){}
    });
   });
   await page.addScriptTag({content:script});
   const fixture={room:{id:'room-qa',code:'TEST01',status:'playing',current_round:1,
     scenario_set:3,round_ends_at:new Date(Date.now()+200000).toISOString(),
     paused_at:null,twist_revealed:false,twist_reveal_at:null,cash_available:10990000,
     cash_remaining:11000000,cash_reserved:10000,cash_committed:11000000,
     business_continuity:100},me:{id:'p6',role_key:'CMT_NKL',is_admin:false,ready_to_lock:false},
     members:[{id:'a0',display_name:'Facilitator',is_admin:true,role_key:null,online:true,is_bot:false,ready_to_lock:false},
      ...roles.map((role_key,i)=>({id:'p'+i,role_key,display_name:'Player '+i,
       is_admin:false,is_bot:false,online:true,ready_to_lock:false}))],
     story:{big_story:'BCP ARV29 exercise',site_story:'NKL local exercise'},
     hand:[2,3].map(n=>({card_key:'Factory:CHP-4:'+n,chp_code:'CHP-4',title:'Card '+n,
       detail:'Exercise action card',role:'CMT',cash_cost:10000})),
     placements:[{id:'placed-1',deck_id:'deck-nkl',site:'NKL',
       card_key:'Factory:CHP-4:2',title:'Card 2',role:'CMT',chp_code:'CHP-4',
       position:1,placed_by_member_id:'p6',cash_cost:10000}],
     round_results:[],server_now:new Date().toISOString()};
   await page.evaluate(data=>{
    window.__qaState=data;
    session={roomId:'room-qa',token:'p6'};
    state=structuredClone(data);
    selectedChp='CHP-4';
    game();
    window.__qaDeck=document.querySelector('#privateDeck');
    window.__qaTimeline=document.querySelector('#sharedTimeline');
    window.scrollTo(0,Math.min(350,document.body.scrollHeight-innerHeight));
    window.__qaScroll=window.scrollY;
   },fixture);
   assert.match((await page.locator('#clock').textContent()).trim(),/^\d{2}:\d{2}$/);
   for(let i=0;i<5;i++)await page.evaluate(async()=>{window.__qaState.server_now=new Date().toISOString();await refresh();});
   const stability=await page.evaluate(()=>({
    sameDeck:window.__qaDeck===document.querySelector('#privateDeck'),
    sameTimeline:window.__qaTimeline===document.querySelector('#sharedTimeline'),
    drift:Math.abs(window.__qaScroll-window.scrollY),
    overflow:document.documentElement.scrollWidth-innerWidth
   }));
   assert.ok(stability.sameDeck&&stability.sameTimeline,'Realtime replaced an unchanged workspace '+width);
   assert.ok(stability.drift<=3,'Realtime jumped page scroll '+width+': '+JSON.stringify(stability));
   assert.ok(stability.overflow<=3,'Horizontal overflow '+width+': '+JSON.stringify(stability));
   await page.evaluate(async()=>{
    const source=document.querySelector('[data-card="Factory:CHP-4:3"]');
    const target=document.querySelector('.placed-card');
    const transfer=new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    await refresh();
    if(!source.isConnected)throw Error('Dragged source disappeared on Realtime');
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
   });
   await page.waitForFunction(()=>window.__qaCalls.some(c=>c.name==='bcp_web_play_action_direct'),{timeout:5000});
   await page.waitForFunction(()=>document.querySelectorAll('.placed-card').length===2,{timeout:5000});
   const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.name==='bcp_web_play_action_direct'));
   assert.equal(calls.length,1,'Must place exactly one card at '+width);
   assert.equal(calls[0].args.p_site,'NKL','Wrong destination');
   await page.evaluate(async()=>{
    window.__qaState.me={id:'a0',role_key:null,is_admin:true,ready_to_lock:false};
    window.__qaState.hand=[];
    session={roomId:'room-qa',token:'admin'};
    selectedChp=null;
    await refresh();
   });
   await page.getByText('Admin เข้าสู่ Simulation แล้ว').waitFor({timeout:5000});
   assert.ok(await page.locator('.admin-member').count(),'Admin not in live roster '+width);
   assert.ok(await page.getByText('Admin เข้าสู่ Simulation แล้ว').count(),'Admin spectator view missing '+width);
   assert.deepEqual(errors,[],width+'px browser script errors');
   console.log('PASS '+width+'px: stable DOM/scroll, nested placement, Admin eighth role, no JS errors');
   await page.close();
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});