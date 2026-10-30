const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {fixture}=require('./factory-fixture.cjs');
const wait=()=>new Promise(r=>setImmediate(r));
async function setup(t,seeded=false){
 const f=await fixture();const seed=seeded?await f.bootstrap():null;
 const dom=new JSDOM('<main id="factory-workspace"></main>',{url:'https://offline.test',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const w=dom.window,d=w.document,$=id=>d.getElementById('fx-'+id);let prints=0;w.print=()=>prints++;
 const controller=f.ui.createFactoryController(d.getElementById('factory-workspace'),f.api);
 const ready=async()=>{for(let n=0;n<1500;n++){await new Promise(r=>setTimeout(r,1));if(controller.ready&&!controller.busy)return;}throw new Error('UI load timed out: '+$('message').textContent);};
 const open=async view=>{controller.open(view);await ready();};
 const set=(id,value,event='input')=>{assert($(id),'Missing '+id);$(id).value=String(value);$(id).dispatchEvent(new w.Event(event,{bubbles:true}));};
 const tick=id=>{$(id).checked=true;};
 const submit=id=>{$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 const confirm=async()=>{$('review-confirm').click();await ready();};
 await open('setup');
 t.after(()=>controller.destroy());
 return{f,seed,w,d,$,controller,ready,open,set,tick,submit,confirm,prints:()=>prints};
}
test('new workspace is empty, imports catalogue labels and saves only after explicit review',async t=>{
 const e=await setup(t);assert.match(e.$('page').textContent,/ยังไม่มีข้อมูล/);assert.equal(e.f.records.size,0);
 e.set('catalog','p1','change');assert.equal(e.$('item-code').value,'P001');assert.equal(e.$('item-unit').value,'ซอง');assert.equal(e.$('item-kind').value,'FG');
 e.submit('item-form');assert.equal(e.$('review').hidden,false);assert.equal(e.f.records.size,0);
 await e.confirm();assert.equal((await e.f.store.load()).data.items.length,1);assert.equal(e.$('item-code').value,'');
});
test('real UI connects order, issue, actual production, QA, transport and company reports',async t=>{
 const e=await setup(t,true),{seed}=e;
 await e.open('order');e.set('order-source','SO-TEST','change');assert.equal(e.$('order-customer').value,'ลูกค้าทดสอบ');
 e.set('order-recipe',seed.recipe);e.set('order-qty','1000');e.set('order-due','2026-11-02');e.submit('order-form');assert.equal(e.$('review').hidden,false);await e.confirm();const jobId=e.controller.lastResult.id;
 assert.match(e.$('job-summary').textContent,/1,000/);
 await e.open('issue');e.submit('issue-form');await e.confirm();assert.equal(e.f.record('lots',seed.rawLot).qtyMills,30000);
 await e.open('actual');e.set('produce-lot','FG-UI');e.set('produce-qty','980');e.set('produce-mfg','2026-10-01');e.set('produce-exp','2027-10-01');e.tick('produce-verified');e.submit('produce-form');await e.confirm();const lotId=e.controller.lastResult.id;
 await e.open('shipping');e.set('ship-ref','DO-UI');e.set('ship-time','13:00');e.set('ship-destination','ปลายทาง');e.set('ship-vehicle','TEST');e.set('ship-driver','คนขับ');e.set('ship-line-'+lotId,'400');for(const id of['oil','water','tires','clean','pests','stack','dress'])e.set('ship-check-'+id,'pass');e.tick('ship-verified');e.submit('ship-form');assert.match(e.$('message').textContent,/QA/);assert.equal(e.f.record('lots',lotId).qtyMills,980000);
 await e.open('quality');e.set('inspect-lot',lotId,'change');for(const id of['package','label','code','verified'])e.tick('inspect-'+id);e.set('inspect-seal','pass');e.set('inspect-sample','3');e.set('inspect-plan','QA-PLAN');e.set('inspect-note','ตรวจครบแล้ว');e.set('inspect-decision','released');e.submit('inspect-form');await e.confirm();
 await e.open('shipping');e.submit('ship-form');assert.equal(e.$('review').hidden,false,e.$('message').textContent);await e.confirm();assert.equal(e.f.record('lots',lotId).qtyMills,580000);
 await e.open('forms');e.set('form-type','PC02','change');e.set('form-item',seed.fg);e.$('generate-form').click();
 const rows=[...e.d.querySelectorAll('#fx-paper-host .fx-paper:first-child tbody tr')].map(r=>[...r.cells].map(c=>c.textContent));
 assert.equal(rows.length,3);assert.equal(rows[1][0],'30/10/2569');assert.equal(rows[1][1],'980');assert.equal(rows[2][4],'580');
 e.$('print-form').click();assert.equal(e.prints(),1);assert(e.d.getElementById('factory-print-area'));e.w.dispatchEvent(new e.w.Event('afterprint'));assert.equal(e.d.getElementById('factory-print-area'),null);
 assert.equal(e.f.record('jobs',jobId).shippedMills,400000);
});
test('failed and uncertain writes retain the pending request and retry never duplicates a record',async t=>{
 const e=await setup(t);e.set('item-code','R1');e.set('item-name','ชื่อทดสอบ');e.set('item-unit','กก.');e.set('item-precision','3');e.submit('item-form');e.f.setDeny(true);
 await e.confirm();assert.equal(e.$('review').hidden,false);assert.equal(e.$('item-code').value,'R1');assert.match(e.$('message').textContent,/ไม่มีสิทธิ์/);assert.equal(e.f.records.size,0);
 e.f.setDeny(false);e.f.setAckLoss(true);await e.confirm();assert.equal(e.$('review').hidden,false);assert.equal((await e.f.store.load()).data.items.length,1);
 await e.confirm();assert.equal(e.$('review').hidden,true);assert.equal((await e.f.store.load()).data.items.length,1);assert.match(e.$('message').textContent,/ไม่บันทึกซ้ำ/);
});
test('switching process forms retains drafts and production steps print captured observations',async t=>{
 const e=await setup(t,true);const p=await e.f.plan(e.seed);await e.f.run('issue',{jobId:p.id,date:'2026-10-30',lines:[{lotId:e.seed.rawLot,qty:'20'},{lotId:e.seed.bagLot,qty:'1000'}]});await e.controller.reload();e.set('job',p.id,'change');await e.open('actual');
 e.set('process-form-type','PC10','change');assert(e.$('process-temperature'));e.set('process-temperature','65');e.set('process-start','09:00');e.set('process-end','10:00');e.tick('process-verified');e.submit('process-form');await e.confirm();
 await e.open('forms');e.set('form-type','PC10','change');e.$('generate-form').click();assert.match(e.$('paper-host').textContent,/65/);
});
test('user text stays literal, destroyed sessions remove print snapshots and listeners',async t=>{
 const e=await setup(t);e.set('item-code','X');e.set('item-name','<img src=x onerror=alert(1)>');e.set('item-unit','ใบ');e.submit('item-form');await e.confirm();assert.equal(e.d.querySelectorAll('img[onerror]').length,0);
 await e.open('forms');e.$('print-form').click();assert(e.d.getElementById('factory-print-area'));e.controller.destroy();assert.equal(e.d.getElementById('factory-print-area'),null);assert.equal(e.d.getElementById('factory-workspace').children.length,0);
});
test('report filters disable stale printing and restored periods match the regenerated report',async t=>{
 const e=await setup(t,true);await e.open('forms');e.set('form-type','RM03','change');e.set('form-item',e.seed.raw,'change');e.$('generate-form').click();assert.equal(e.$('print-form').disabled,false);
 e.set('form-start','2026-10-30');assert.equal(e.$('print-form').disabled,true);e.$('generate-form').click();
 let rows=[...e.d.querySelectorAll('#fx-paper-host tbody tr')].map(r=>[...r.cells].map(c=>c.textContent));assert.equal(rows.length,1);assert.equal(rows[0][4],'50');
 await e.open('stock');await e.open('forms');assert.equal(e.$('form-start').value,'2026-10-30');rows=[...e.d.querySelectorAll('#fx-paper-host tbody tr')].map(r=>[...r.cells].map(c=>c.textContent));assert.equal(rows.length,1);assert.equal(rows[0][4],'50');
 e.set('form-type','PC02','change');assert.equal(e.$('form-item').querySelectorAll('option').length,2);assert.equal(e.$('form-item').querySelector('option[value="'+e.seed.fg+'"]').textContent.includes('P001'),true);
});
