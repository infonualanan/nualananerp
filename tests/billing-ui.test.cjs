const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom'),{fixture}=require('./billing-fixture.cjs');
const ui=import(pathToFileURL(path.join(__dirname,'..','billing-ui.mjs')).href);
const wait=async check=>{for(let n=0;n<1500;n++){await new Promise(r=>setTimeout(r,1));if(check())return;}throw new Error('Accounting UI did not finish');};
async function setup(t,{seed=true}={}){
 const f=await fixture();if(seed)f.seed();const dom=new JSDOM('<div id="billing-workspace"></div>',{url:'https://offline.test/',pretendToBeVisual:true});
 t.after(()=>dom.window.close());const w=dom.window,d=w.document,$=id=>d.getElementById(id);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let opened='';f.api.openPayments=no=>opened=no;f.api.onSaved=()=>{};
 const controller=(await ui).createBillingController($('billing-workspace'),f.api);t.after(()=>controller.destroy());await controller.ready;
 function click(selector){const el=d.querySelector(selector);assert.ok(el,selector);el.click();return el;}
 function value(id,v,event='input'){const el=$(id);assert.ok(el,id);el.value=v;el.dispatchEvent(new w.Event(event,{bubbles:true}));}
 function select(root,kind='bill'){const el=d.querySelector('[data-bl-pick="'+kind+'"][data-root="'+root+'"]');assert.ok(el,root);el.checked=true;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
 function verify(){const el=$('bl-verified');el.checked=true;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
 async function issue(){select('INV-2026-001');select('INV-2026-002');value('bl-bill-due','2026-11-10');click('[data-bl-action="review-bill"]');assert.equal(controller.pending,true,$('bl-message').textContent);click('[data-bl-action="confirm"]');await wait(()=>!controller.busy);assert.equal(controller.pending,false,$('bl-message').textContent);}
 return {...f,w,d,$,controller,click,value,select,verify,issue,getOpened:()=>opened};
}
test('empty workspace does not seed data; real eligible and unreviewed sources stay separate',async t=>{
 const f=await setup(t,{seed:false});assert.equal(f.records.size,0);assert.match(f.$('bl-page').textContent,/เลือกลูกค้า/);
 const r=f.root('INV-REVIEW',100);delete r.paymentLedger;f.put('documents',r.docNo,r);await f.controller.reload();assert.match(f.$('bl-page').textContent,/รอตรวจยอด/);
 f.click('[data-bl-root="INV-REVIEW"]');assert.equal(f.getOpened(),'INV-REVIEW');assert.equal(f.records.size,1);
});
test('real UI issues a bill, allocates one payment across two invoices and opens saved documents',async t=>{
 const f=await setup(t);await f.issue();assert.equal(f.$('bl-dialog').open,true);assert.match(f.$('bl-dialog').textContent,/39,000.00/);
 f.click('[data-bl-action="pay-bill"]');assert.equal(f.$('bl-dialog').open,false);assert.equal(f.$('bl-amount').value,'39000');
 f.value('bl-amount','30000');f.click('[data-bl-action="allocate"]');f.value('bl-reference','UI-BANK-1');f.value('bl-proof-note','ตรวจรายการธนาคารแล้ว');f.verify();
 f.click('[data-bl-action="review-payment"]');assert.equal(f.controller.pending,true,f.$('bl-message').textContent);assert.match(f.$('bl-dialog').textContent,/30,000.00/);
 assert.equal(f.d.querySelector('[data-bl-page="history"]').disabled,true);
 f.click('[data-bl-action="confirm"]');await wait(()=>!f.controller.busy);
 assert.equal(f.payments.ledgerSummary(f.get('documents','INV-2026-002')).balance,900000);assert.match(f.$('bl-dialog').textContent,/ใบเสร็จรับเงิน/);
 f.click('[data-bl-action="close"]');f.click('[data-bl-action="proof"]');assert.match(f.$('bl-dialog').textContent,/ตรวจรายการธนาคารแล้ว/);
});
test('failed and uncertain writes retain the original pending request for an idempotent retry',async t=>{
 const f=await setup(t);f.select('INV-2026-001');f.value('bl-bill-due','2026-11-10');f.click('[data-bl-action="review-bill"]');f.setDeny(true);
 f.click('[data-bl-action="confirm"]');await wait(()=>!f.controller.busy);assert.equal(f.controller.pending,true);assert.match(f.$('bl-message').textContent,/ไม่มีสิทธิ์/);
 f.setDeny(false);f.setAckLoss(true);f.click('[data-bl-action="confirm"]');await wait(()=>!f.controller.busy);assert.equal(f.controller.pending,true);
 f.click('[data-bl-action="confirm"]');await wait(()=>!f.controller.busy);assert.equal(f.controller.pending,false);assert.equal((await f.api.readServerDocuments()).filter(d=>d.billingManaged).length,1);
});
test('mixed VAT states expose both draft documents before confirmation',async t=>{
 const f=await setup(t);f.click('[data-bl-page="payments"]');f.select('INV-2026-001','pay');f.select('INV-2026-003','pay');f.value('bl-amount','25000');
 f.click('[data-bl-action="allocate"]');f.value('bl-reference','MIXED-REF');f.value('bl-next-due','2026-11-15');f.value('bl-proof-note','หลักฐานโอนจริง');f.verify();f.click('[data-bl-action="review-payment"]');
 assert.equal(f.controller.pending,true,f.$('bl-message').textContent);assert.equal(f.$('bl-draft-document').disabled,false);assert.equal(f.$('bl-draft-document').options.length,2);
 f.value('bl-draft-document','1','change');assert.match(f.$('bl-dialog').textContent,/ใบเสร็จรับเงิน/);assert.match(f.d.querySelector('.bl-paper-preview').textContent,/1,000.00/);
});
test('replace and cancel retain history while preserving all cash balances',async t=>{
 const f=await setup(t);await f.issue();f.click('[data-bl-action="close"]');f.click('[data-bl-action="replace"]');f.value('bl-reason','แก้ไขหมายเหตุบริษัท');f.click('[data-bl-action="confirm-reason"]');
 f.value('bl-bill-note','ข้อความ <ตัวอย่าง>');f.click('[data-bl-action="review-bill"]');assert.match(f.$('bl-dialog').textContent,/<ตัวอย่าง>/);
 f.click('[data-bl-action="confirm"]');await wait(()=>!f.controller.busy);f.click('[data-bl-action="close"]');f.click('[data-bl-action="cancel"]');f.value('bl-reason','ยกเลิกใบวางบิลฉบับใหม่');f.click('[data-bl-action="confirm-reason"]');await wait(()=>!f.controller.busy);
 assert.equal((await f.api.readServerDocuments()).filter(d=>d.billingManaged?.state==='cancelled').length,1);
 assert.equal(f.payments.ledgerSummary(f.get('documents','INV-2026-001')).paid,3600000);
});
test('stale data blocks new previews, native drafts survive navigation and destroyed sessions clear paper copies',async t=>{
 const f=await setup(t);f.value('bl-bill-note','บันทึกร่าง');f.click('[data-bl-page="receivables"]');f.click('[data-bl-page="billing"]');assert.equal(f.$('bl-bill-note').value,'บันทึกร่าง');
 f.controller.notifyDocuments([]);f.select('INV-2026-001');f.value('bl-bill-due','2026-11-10');f.click('[data-bl-action="review-bill"]');assert.equal(f.controller.pending,false);assert.match(f.$('bl-message').textContent,/อัปเดตข้อมูล/);
 await f.controller.reload();f.click('[data-bl-page="receivables"]');f.click('[data-bl-action="statement"]');f.w.print=()=>{};f.click('[data-bl-action="print"]');assert.ok(f.d.getElementById('billing-print-area'));
 f.controller.destroy();assert.equal(f.d.getElementById('billing-print-area'),null);assert.equal(f.$('billing-workspace').textContent,'');
});
