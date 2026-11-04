const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,modules}=require('./factory-fixture.cjs');
test('inventory edits cannot collide with another code or delete a LOT or recipe item',async()=>{
 const f=await fixture(),seed=await f.bootstrap();
 const original={code:'PK002',name:'บรรจุภัณฑ์',kind:'PACK',unit:'ชิ้น',precision:0};
 const id=(await f.run('item',original)).id;
 await assert.rejects(f.run('itemEdit',{...original,itemId:id,code:'P001'}),/รหัสรายการคลังนี้มีอยู่แล้ว/);
 assert.equal(f.record('items',id).code,original.code);
 await assert.rejects(f.run('itemDelete',{itemId:seed.fg}),/ใช้ในสูตรผลิตแล้ว/);
 await assert.rejects(f.run('itemEdit',{...original,itemId:seed.raw}),/แก้ไขได้เฉพาะชื่อ/);
 const {meta}=await f.store.load();
 const action={kind:'itemDelete',input:{itemId:id},requestId:f.api.newId(),expectedRevision:meta.revision};
 f.setAckLoss(true);await assert.rejects(f.store.commit(action),/response lost/);
 const replay=await f.store.commit(action);assert.equal(replay.replayed,true);
 assert.equal(f.record('items',id),undefined);assert.equal(f.record('events',replay.eventId).kind,'itemDelete');
});
test('a concurrent receipt and item deletion cannot leave a LOT without its item',async()=>{
 const f=await fixture(),itemId=(await f.run('item',{code:'NEW',name:'ของใหม่',kind:'PACK',unit:'ชิ้น',precision:0})).id;
 const {meta}=await f.store.load(),expectedRevision=meta.revision;
 const actions=[
  {kind:'itemDelete',input:{itemId}},
  {kind:'receive',input:{itemId,qty:'3',date:'2026-10-30',supplier:'ผู้ขายทดสอบ',verified:true}}
 ];
 const outcomes=await Promise.allSettled(actions.map(a=>f.store.commit({...a,requestId:f.api.newId(),expectedRevision})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const {data}=await f.store.load();
 assert.equal(data.lots.length,data.items.length);
 if(data.lots.length)assert.equal(data.lots[0].itemId,data.items[0].id);
});
const date='2026-10-30';
async function issued(f,seed){const j=await f.plan(seed);await f.run('issue',{jobId:j.id,date,lines:[{lotId:seed.rawLot,qty:'20'},{lotId:seed.bagLot,qty:'1000'}]});return j.id;}
async function produced(f,id){return (await f.run('produce',{jobId:id,lotCode:'FG-A',qty:'980',date,mfg:'2026-10-01',exp:'2027-10-01',verified:true})).id;}
const inspection=id=>({lotId:id,date,decision:'released',values:{package:true,label:true,code:true,seal:'pass'},sampleQty:'3',samplingPlan:'QA-SAMPLING-01',note:'ตรวจตามเกณฑ์ทดสอบผ่าน',verified:true});
const shipment=(jobId,lotId,qty,ref='DO-1')=>({jobId,reference:ref,date,time:'13:00',destination:'สถานที่ทดสอบ',vehicle:'TEST-01',driver:'ผู้ขนส่งทดสอบ',invoice:'INV-REF',checks:Object.fromEntries(['oil','water','tires','clean','pests','stack','dress'].map(k=>[k,'pass'])),verified:true,lines:[{lotId,qty}]});
test('factory quantities, recipe precision and FEFO exclude held, expired and late lots',async()=>{
 const [core]=await modules;assert.equal(core.mills('1.025',3),1025);assert.throws(()=>core.mills('1.1',0));assert.throws(()=>core.mills('-1'));assert.throws(()=>core.mills('0.0001'));
 const item={id:'a',name:'A',unit:'กก.',precision:3},recipe={outputMills:1000,materials:[{itemId:'a',item,qtyMills:125}]};
 const mk=(id,exp,qa='released')=>({id,itemId:'a',qtyMills:100,reservedMills:0,qa,exp,received:'2026-10-01'});
 const plan=core.allocateMaterials({lots:[mk('held','2027-01-01','held'),mk('expired','2026-10-01'),mk('b','2027-03-01'),mk('a','2027-01-01')]},recipe,1000,'2026-11-01',date);
 assert.deepEqual(plan.map(x=>[x.lotId,x.qtyMills]),[['a',100],['b',25]]);
 assert.throws(()=>core.allocateMaterials({lots:[mk('late','2026-10-31')]},recipe,1000,'2026-11-01',date),/ขาด/);
});
test('receipt and review keep physical stock separate from available and preserve evidence',async()=>{
 const f=await fixture();const id=(await f.run('item',{code:'R',name:'ขิง',kind:'RAW',unit:'กก.',precision:3,inspection:'fresh',needsAnalysis:true})).id;
 const receipt=await f.run('receive',{itemId:id,reference:'REC-1',lotCode:'LOT-1',supplier:'ผู้ขาย',date,qty:'10.5',verified:true});
 let l=f.record('lots',receipt.id);assert.equal(l.qtyMills,10500);assert.equal(f.core.available(l,date),0);
 await assert.rejects(f.run('inspect',{lotId:l.id,date,decision:'released',values:{clean:true,foreign:true,spec:true,avl:true},note:'ผ่าน',verified:true}),/ผลวิเคราะห์/);
 await f.run('inspect',{lotId:l.id,date,decision:'released',values:{clean:true,foreign:true,spec:true,avl:true},analysisRef:'COA-1',note:'ผ่าน',verified:true});
 l=f.record('lots',l.id);assert.equal(l.qtyMills,10500);assert.equal(f.core.available(l,date),10500);
 assert.equal(f.record('events',receipt.eventId).actor.uid,'owner');
 await assert.rejects(f.run('receive',{itemId:id,reference:'rec-1',lotCode:'LOT-2',supplier:'ผู้ขาย',date,qty:'10.5',verified:true}),/มีอยู่แล้ว/);
});
test('planning reserves without reducing physical stock, issue atomically releases reservations',async()=>{
 const f=await fixture(),seed=await f.bootstrap(),j=await f.plan(seed);
 assert.equal(f.record('lots',seed.rawLot).qtyMills,50000);assert.equal(f.record('lots',seed.rawLot).reservedMills,20000);
 await assert.rejects(f.run('issue',{jobId:j.id,date,varianceNote:'เพิ่มเบิก',lines:[{lotId:seed.rawLot,qty:'21'},{lotId:seed.bagLot,qty:'2001'}]}),/เกิน/);
 assert.equal(f.record('lots',seed.rawLot).qtyMills,50000);assert.equal(f.record('lots',seed.rawLot).reservedMills,20000);
 await f.run('issue',{jobId:j.id,date,lines:[{lotId:seed.rawLot,qty:'20'},{lotId:seed.bagLot,qty:'1000'}]});
 assert.equal(f.record('lots',seed.rawLot).qtyMills,30000);assert.equal(f.record('lots',seed.rawLot).reservedMills,0);
 await assert.rejects(f.run('issue',{jobId:j.id,date,lines:[]}),/ยังไม่พร้อม|เบิกแล้ว/);
});
test('concurrent devices cannot reserve the same balance twice and uncertain retry is idempotent',async()=>{
 const f=await fixture(),seed=await f.bootstrap({rawQty:'30'}),loaded=await f.store.load();
 const input={recipeId:seed.recipe,qty:'1000',dueDate:'2026-11-02',customer:'ทดสอบ',candidateLotIds:[seed.rawLot,seed.bagLot]};
 const a={kind:'plan',input,requestId:f.api.newId(),expectedRevision:loaded.meta.revision};
 const b={...a,requestId:f.api.newId()};
 const results=await Promise.allSettled([f.store.commit(a),f.store.commit(b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.record('lots',seed.rawLot).reservedMills,20000);
 const done=results[0].status==='fulfilled'?a:b;const before=f.records.size;
 const replay=await f.store.commit(done);assert.equal(replay.replayed,true);assert.equal(f.records.size,before);
 await assert.rejects(f.store.commit({...done,input:{...input,qty:'500'}}),/ข้อมูลอื่น/);
});
test('failed writes and account switches do not mutate the ledger',async()=>{
 const f=await fixture(),seed=await f.bootstrap(),before=JSON.stringify([...f.records]);
 f.setDeny(true);await assert.rejects(f.plan(seed),/permission/);assert.equal(JSON.stringify([...f.records]),before);f.setDeny(false);
 const meta=await f.store.load();const action={kind:'plan',input:{recipeId:seed.recipe,qty:'1000',dueDate:'2026-11-02',customer:'ทดสอบ',candidateLotIds:[seed.rawLot,seed.bagLot]},requestId:f.api.newId(),expectedRevision:meta.meta.revision};
 f.setGetHook(()=>f.setUser('another'));await assert.rejects(f.store.commit(action),/บัญชีผู้ใช้เปลี่ยน/);assert.equal(JSON.stringify([...f.records]),before);
});
test('configured production steps and honest timestamps gate multiple output LOTs',async()=>{
 const f=await fixture(),seed=await f.bootstrap({requiredForms:['PC10']}),id=await issued(f,seed);
 await assert.rejects(produced(f,id),/PC10/);
 await assert.rejects(f.run('process',{jobId:id,form:'PC10',date,values:{start:'25:00',temperature:'65',end:'26:00'},verified:true}),/HH:MM/);
 await f.run('process',{jobId:id,form:'PC10',date,values:{start:'09:00',temperature:'65',end:'10:00'},verified:true});
 const a=await produced(f,id);await f.run('produce',{jobId:id,lotCode:'FG-B',qty:'10',date,mfg:date,exp:'2027-01-01',verified:true});
 assert.equal(f.record('jobs',id).batches.length,2);assert.equal(f.record('lots',a).received,date);assert.equal(f.record('lots',a).mfg,'2026-10-01');
 await assert.rejects(f.run('produce',{jobId:id,lotCode:'FG-A',qty:'1',date,mfg:date,exp:'2027-01-01',verified:true}),/มีอยู่แล้ว/);
});
test('QA gates dispatch, release does not duplicate stock, partial dispatch and returns reconcile',async()=>{
 const f=await fixture(),seed=await f.bootstrap(),id=await issued(f,seed),lotId=await produced(f,id);
 await assert.rejects(f.run('ship',shipment(id,lotId,'400')),/QA/);
 await assert.rejects(f.run('inspect',{...inspection(lotId),values:{}}),/ยืนยันผล/);
 await f.run('inspect',inspection(lotId));assert.equal(f.record('lots',lotId).qtyMills,980000);
 const ship=await f.run('ship',shipment(id,lotId,'400'));assert.equal(f.record('lots',lotId).qtyMills,580000);
 await assert.rejects(f.run('ship',shipment(id,lotId,'581','DO-2')),/เกิน/);
 await assert.rejects(f.run('ship',shipment(id,lotId,'100','do-1')),/มีอยู่แล้ว/);
 await assert.rejects(f.run('return',{shipmentId:ship.id,lotId,qty:'401',date,note:'คืน',verified:true}),/เกิน/);
 const ret=await f.run('return',{shipmentId:ship.id,lotId,qty:'20',date,note:'รับคืนจริง',verified:true});
 const returned=f.record('lots',ret.id);assert.equal(returned.qtyMills,20000);assert.equal(returned.qa,'held');assert.equal(returned.exp,'2027-10-01');assert.equal(f.record('shipments',ship.id).lines[0].returnedMills,20000);
 const data=(await f.store.load()).data;const totalInOut=data.events.flatMap(e=>e.physical).filter(p=>p.itemId===seed.fg).reduce((n,p)=>n+p.inMills-p.outMills,0);
 assert.equal(totalInOut,data.lots.filter(l=>l.itemId===seed.fg).reduce((n,l)=>n+l.qtyMills,0));
});
test('count cannot erase reserved stock; cancellation frees only the job reservation',async()=>{
 const f=await fixture(),seed=await f.bootstrap(),j=await f.plan(seed);
 await assert.rejects(f.run('adjust',{lotId:seed.rawLot,qty:'19',note:'ตรวจนับ',verified:true}),/ต่ำกว่า/);
 await f.run('cancel',{jobId:j.id,note:'ลูกค้ายกเลิก'});assert.equal(f.record('lots',seed.rawLot).reservedMills,0);assert.equal(f.record('lots',seed.rawLot).qtyMills,50000);
 await assert.rejects(f.run('cancel',{jobId:j.id,note:'อีกครั้ง'}),/ก่อนเบิก/);
});
test('closing material balances requires reconciliation and returned packaging is quarantined',async()=>{
 const f=await fixture(),seed=await f.bootstrap(),id=await issued(f,seed);await produced(f,id);
 const base={jobId:id,date,note:'ตรวจยอดวัสดุจริง',verified:true,lines:[{lotId:seed.rawLot,used:'20',returned:'0',scrap:'0'},{lotId:seed.bagLot,used:'980',returned:'19',scrap:'0'}]};
 await assert.rejects(f.run('close',base),/ต้องเท่ากับ/);
 const result=await f.run('close',{...base,lines:[base.lines[0],{lotId:seed.bagLot,used:'980',returned:'20',scrap:'0'}]});
 assert.equal(f.record('jobs',id).closed,true);const returned=(await f.store.load()).data.lots.find(l=>l.returnFromJob===id);assert.equal(returned.qtyMills,20000);assert.equal(returned.qa,'held');assert.equal(f.record('lots',seed.bagLot).qtyMills,1000000);
 await assert.rejects(f.run('produce',{jobId:id,lotCode:'FG-C',qty:'1',date,mfg:date,exp:'2027-01-01',verified:true}),/ก่อนรับผลผลิต/);
});
test('expired output cannot be released and corrected transport requires an explanation',async()=>{
 const f=await fixture(),seed=await f.bootstrap(),id=await issued(f,seed);
 const exp=(await f.run('produce',{jobId:id,lotCode:'EXP',qty:'1',date,mfg:'2026-01-01',exp:'2026-01-02',verified:true})).id;
 await assert.rejects(f.run('inspect',inspection(exp)),/หมดอายุ/);
 const l=await produced(f,id);await f.run('inspect',inspection(l));
 const input=shipment(id,l,'1');input.checks.clean='fixed';await assert.rejects(f.run('ship',input),/รายละเอียดการแก้ไข/);
 await f.run('ship',{...input,note:'ทำความสะอาดและตรวจซ้ำผ่าน'});
});
test('make-to-stock jobs require the actual shipment customer and released LOTs can be held immediately',async()=>{
 const f=await fixture(),seed=await f.bootstrap();
 const job=(await f.run('plan',{recipeId:seed.recipe,qty:'1000',dueDate:'2026-11-02',productionType:'stock',candidateLotIds:[seed.rawLot,seed.bagLot]})).id;
 await f.run('quarantine',{lotId:seed.rawLot,note:'ได้รับผลตรวจเพิ่มเติม ต้องกักไว้',verified:true});
 assert.equal(f.record('lots',seed.rawLot).qtyMills,50000);assert.equal(f.record('lots',seed.rawLot).reservedMills,20000);assert.equal(f.core.available(f.record('lots',seed.rawLot),date),0);
 await assert.rejects(f.run('issue',{jobId:job,date,lines:[{lotId:seed.rawLot,qty:'20'},{lotId:seed.bagLot,qty:'1000'}]}),/QA/);
 await f.run('inspect',{lotId:seed.rawLot,date,decision:'released',values:{clean:true,foreign:true,spec:true,avl:true},analysisRef:'ผลตรวจซ้ำ',note:'ตรวจใหม่ผ่านตามสเปก',verified:true});
 await f.run('issue',{jobId:job,date,lines:[{lotId:seed.rawLot,qty:'20'},{lotId:seed.bagLot,qty:'1000'}]});
 const l=await produced(f,job);await f.run('inspect',inspection(l));
 await assert.rejects(f.run('ship',shipment(job,l,'10')),/ลูกค้าที่จัดส่งจริง/);
 const ship=await f.run('ship',{...shipment(job,l,'10'),customer:'ลูกค้าที่ซื้อสินค้าจากสต๊อก'});assert.equal(f.record('shipments',ship.id).customer,'ลูกค้าที่ซื้อสินค้าจากสต๊อก');
});
test('long codes and nonsequential receipts preserve evidence, stock totals, and separate QA lots',async()=>{
 const f=await fixture(),code='RAW-'+('LONG-'.repeat(16)),supplierLot='SUP-'+('BATCH-'.repeat(18));
 const item=(await f.run('item',{code,name:'ขิง',kind:'RAW',unit:'กิโลกรัม',precision:3,productCode:code})).id;
 const input={itemId:item,supplier:'ผู้ขายทดสอบ',supplierLot,verified:true};
 const later=await f.run('receive',{...input,reference:'R-90-'+code,lotCode:'LOT-Z-'+code,date:'2026-10-30',qty:'12.500'});
 const earlier=await f.run('receive',{...input,reference:'R-02-'+code,lotCode:'LOT-A-'+code,date:'2026-10-28',qty:'7.250'});
 const auto=await f.run('receive',{...input,date:'2026-10-29',qty:'0.250'});
 assert.match(auto.reference,/^GRN-/);
 assert.match(f.record('lots',auto.id).code,/^LOT-/);
 assert.equal(f.record('items',item).productCode,code);
 assert.equal(f.record('lots',later.id).supplierLot,supplierLot);
 assert.equal(f.record('lots',earlier.id).received,'2026-10-28');
 const data=(await f.store.load()).data;
 assert.deepEqual(f.core.stockTotals(data.lots,date).get(item),{qtyMills:20000,reservedMills:0,availableMills:0});
 const ledger=data.events.flatMap(e=>e.physical).filter(e=>e.itemId===item);
 assert.equal(ledger.reduce((n,e)=>n+e.inMills-e.outMills,0),20000);
 assert.equal(data.lots.length,3);
 await assert.rejects(f.run('receive',{...input,reference:'R-90-'+code,date,qty:'1'}),/มีอยู่แล้ว/);
 await assert.rejects(f.run('item',{code:'',name:'ขิง',kind:'RAW',unit:'กิโลกรัม',precision:3}),/กรุณากรอกรหัสรายการคลัง/);
});
test('QA records kilograms or whole pieces without changing warehouse balances or releasing held stock',async()=>{
 const f=await fixture(),seed=await f.bootstrap();
 const base={lotId:seed.rawLot,date,decision:'held',note:'ตรวจตัวอย่าง'};
 await f.run('quarantine',{lotId:seed.rawLot,note:'รอตรวจซ้ำ',verified:true});
 await assert.rejects(f.run('inspect',{...base,sampleQty:'1.5',sampleUnit:'ชิ้น'}),/ทศนิยม/);
 const kg=await f.run('inspect',{...base,sampleQty:'0.125',sampleUnit:'กิโลกรัม'});
 const pieces=await f.run('inspect',{...base,sampleQty:'3',sampleUnit:'ชิ้น'});
 assert.equal(f.record('inspections',kg.id).sampleCount,0.125);
 assert.equal(f.record('inspections',kg.id).sampleUnit,'กิโลกรัม');
 assert.equal(f.record('inspections',pieces.id).sampleUnit,'ชิ้น');
 assert.equal(f.record('lots',seed.rawLot).qtyMills,50000);
 assert.equal(f.core.available(f.record('lots',seed.rawLot),date),0);
});
