const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./billing-fixture.cjs');
test('receivables count each source once, include historical cash and flag unreviewed documents',async()=>{
 const f=await fixture();f.seed();f.put('documents','INV-OLD',{docNo:'INV-OLD',prefix:'INV',inputDate:'2026-10-01',currency:'THB',grandTotal:100,customerName:'ลูกค้าเก่า'});
 let data=await f.store.load(),r=f.core.receivables(data.documents,f.api.today(),f.api.today());
 assert.equal(r.rows.length,3);assert.equal(r.review.length,1);assert.equal(f.core.aging(r.rows,f.api.today()).balanceCents,4400000);
 r=f.core.receivables(data.documents,'2026-10-04',f.api.today());assert.equal(f.core.aging(r.rows,'2026-10-04').paidCents,0);assert.equal(r.rows.length,2);
});
test('SO invoice notices are aliases and never add a second receivable',async()=>{
 const f=await fixture();let root=f.root('SO-ROOT',60000);root.prefix='SO';
 const a={kind:'invoice',requestId:'notice-request-0001',now:f.api.now()};
 const out=f.payments.applyOperation(root,a,'INV-2026-P000001',f.api.today());root.paymentLedger=out.ledger;
 f.put('documents',root.docNo,root);f.put('documents',out.document.docNo,out.document);
 let data=await f.store.load(),rows=f.core.receivables(data.documents,f.api.today(),f.api.today()).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].rootNo,'SO-ROOT');assert.equal(rows[0].invoiceNo,'INV-2026-P000001');assert.equal(rows[0].balanceCents,6000000);
});
test('bill issue reserves its source references without changing cash, balance, VAT or income',async()=>{
 const f=await fixture();f.seed();const before=f.get('documents','INV-2026-001').paymentLedger;
 const result=await f.issueBill(),b=f.get('documents',result.docNos[0]);
 assert.equal(b.prefix,'BL');assert.equal(b.grandTotal,39000);assert.equal(b.vat,0);assert.equal(b.isRevenue,false);
 assert.equal(b.billingRows[0].balanceCents,2400000);assert.deepEqual(f.get('documents','INV-2026-001').paymentLedger,before);
 assert.equal(f.get('documents','INV-2026-001').billingLock.billNo,b.docNo);
 await assert.rejects(f.issueBill(),/ใบวางบิลอื่น/);
});
test('one bank receipt atomically settles two roots and creates one combined VAT document',async()=>{
 const f=await fixture();f.seed();const result=await f.store.commit(await f.batch());
 assert.equal(result.docNos.length,1);const doc=f.get('documents',result.docNos[0]);
 assert.equal(doc.prefix,'RETAX');assert.equal(doc.grandTotal,30000);assert.equal(doc.items.length,2);assert.equal(doc.paymentManaged.rootNos.length,2);
 assert.equal(f.payments.ledgerSummary(f.get('documents','INV-2026-001')).balance,0);
 assert.equal(f.payments.ledgerSummary(f.get('documents','INV-2026-002')).balance,900000);
 const batch=f.get('accounting_batches',result.batchId);assert.equal(batch.amountCents,3000000);assert.equal(batch.rows.length,2);
 assert.equal(Math.round((doc.subtotal+doc.vat)*100),3000000);
 const first=f.get('documents','INV-2026-001');assert.equal(first.paymentLedger.documents.filter(d=>['tax','advance'].includes(d.kind)).reduce((s,d)=>s+d.vatCents,0),392523);
});
test('mixed tax states issue separate documents for one actual bank event and never add tax to a receipt',async()=>{
 const f=await fixture();f.seed();const result=await f.store.commit(await f.batch({'INV-2026-001':'1000','INV-2026-003':'1000'}));
 assert.equal(result.docNos.length,2);const docs=result.docNos.map(n=>f.get('documents',n));
 assert.deepEqual(docs.map(d=>d.prefix).sort(),['RE','RETAX']);assert.equal(docs.find(d=>d.prefix==='RE').vat,0);
 assert.equal(docs.reduce((s,d)=>s+d.grandTotal,0),2000);assert.equal((await f.store.load()).batches.length,1);
});
test('batch and single-order payment channels share duplicate-reference protection',async()=>{
 const f=await fixture();f.seed();await f.store.commit(await f.batch({'INV-2026-001':'1000'}));
 const root=f.get('documents','INV-2026-002');
 await assert.rejects(f.singleStore.commit(root.docNo,{kind:'payment',requestId:'single-after-batch',expectedRevision:root.paymentLedger.revision||0,now:f.api.now(),input:{amount:'1000',date:f.api.today(),reference:'bank-new',method:'โอนธนาคาร',dueDate:'2026-11-15',verified:true,proofNote:'หลักฐาน'}}),/เลขอ้างอิงรับเงินนี้ใช้แล้ว/);
 await assert.rejects(f.store.commit(await f.batch({'INV-2026-002':'1000'},{reference:'INITIAL-1'})),/เลขอ้างอิงรับเงินนี้ใช้แล้ว/);
});
test('uncertain retry is idempotent and changing a reused request payload is rejected',async()=>{
 const f=await fixture();f.seed();const action=await f.batch();f.setAckLoss(true);
 await assert.rejects(f.store.commit(action),/response lost/);const retry=await f.store.commit(action);assert.equal(retry.replayed,true);assert.equal((await f.store.load()).batches.length,1);
 await assert.rejects(f.store.commit({...action,input:{...action.input,reference:'DIFFERENT'}}),/เลขรายการถูกใช้/);
});
test('denied writes and account switching preserve all balances and pending bill records',async()=>{
 const f=await fixture();f.seed();const action=await f.batch(),before=structuredClone([...f.records]);
 f.setDeny(true);await assert.rejects(f.store.commit(action),/permission/);assert.deepEqual([...f.records],before);
 f.setDeny(false);f.setReadHook(()=>f.setUser('other'));await assert.rejects(f.store.commit(action),/บัญชีผู้ใช้เปลี่ยน/);assert.deepEqual([...f.records],before);
});
test('concurrent devices cannot over-collect or bill the same source twice',async()=>{
 const f=await fixture();f.seed();const a=await f.batch({'INV-2026-001':'20000'}),b=await f.batch({'INV-2026-001':'20000'},{reference:'OTHER-REF'});
 const result=await Promise.allSettled([f.store.commit(a),f.store.commit(b)]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 const g=await fixture();g.seed();const x=await g.action('bill',{ids:['INV-2026-001'],dueDate:'2026-11-15'}),y=await g.action('bill',{ids:['INV-2026-001'],dueDate:'2026-11-15'});
 assert.equal((await Promise.allSettled([g.store.commit(x),g.store.commit(y)])).filter(x=>x.status==='fulfilled').length,1);
});
test('cancellation and atomic replacement preserve original snapshots and never change payments',async()=>{
 const f=await fixture();f.seed();let result=await f.issueBill(),old=result.docNos[0],before=f.get('documents','INV-2026-001').paymentLedger;
 result=await f.issueBill(['INV-2026-001'],{replaces:old,reason:'แก้ข้อมูลใบวางบิล'});
 assert.equal(f.get('documents',old).billingManaged.state,'superseded');assert.equal(f.get('documents',old).grandTotal,39000);
 assert.equal(f.get('documents',result.docNos[0]).billingManaged.replaces,old);assert.equal(f.get('documents','INV-2026-002').billingLock,null);
 const cancel=await f.action('cancel',{billNo:result.docNos[0],reason:'ยกเลิกเอกสารทดสอบ',billRevision:0});await f.store.commit(cancel);
 assert.equal(f.get('documents',result.docNos[0]).billingManaged.state,'cancelled');assert.equal(f.get('documents','INV-2026-001').billingLock,null);
 assert.deepEqual(f.get('documents','INV-2026-001').paymentLedger,before);
});
test('cross-customer allocation, stale roots, overpayment and untracked credit notes cannot post',async()=>{
 const f=await fixture();f.seed();let r=f.get('documents','INV-2026-002');r.customerTaxId='0105550000009';f.put('documents',r.docNo,r);
 await assert.rejects(f.store.commit(await f.batch()),/ลูกค้าและสาขาเดียวกัน/);
 r.customerTaxId='0105550000002';f.put('documents',r.docNo,r);
 await assert.rejects(f.store.commit(await f.batch({'INV-2026-001':'25000'})),/เกินยอดค้าง/);
 const action=await f.batch();r=f.get('documents','INV-2026-001');r.paymentLedger.revision++;f.put('documents',r.docNo,r);await assert.rejects(f.store.commit(action),/เปลี่ยน/);
 f.put('documents','CN-OLD',{docNo:'CN-OLD',prefix:'CN',inputDate:'2026-10-30',refDocManual:'INV-2026-001',grandTotal:100});
 const loaded=await f.store.load();assert.ok(f.core.receivables(loaded.documents,f.api.today(),f.api.today()).review.some(x=>x.rootNo==='INV-2026-001'));
});
test('concurrent single and batch channels cannot record the same bank transfer on different invoices',async()=>{
 const f=await fixture();f.seed();const batch=await f.batch({'INV-2026-002':'1000'},{reference:'SAME-BANK'});
 const root=f.get('documents','INV-2026-001'),single={kind:'payment',requestId:'single-race-request',expectedRevision:root.paymentLedger.revision||0,now:f.api.now(),input:{amount:'1000',date:f.api.today(),reference:'same-bank',method:'โอนธนาคาร',dueDate:'2026-11-15',verified:true,proofNote:'หลักฐาน'}};
 const results=await Promise.allSettled([f.store.commit(batch),f.singleStore.commit(root.docNo,single)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const total=(await f.api.readServerDocuments()).filter(d=>d.paymentLedger).reduce((s,d)=>s+f.payments.ledgerSummary(d).paid,0);assert.equal(total,4200000);
});
test('concurrent activation of linked SO and INV sources selects exactly one receivable owner',async()=>{
 const f=await fixture();let so=f.root('SO-SHARED',1000),inv=f.root('INV-SHARED',1000);so.prefix='SO';inv.refDocManual=so.docNo;delete so.paymentLedger;delete inv.paymentLedger;
 f.put('documents',so.docNo,so);f.put('documents',inv.docNo,inv);
 const r=await Promise.allSettled([f.singleStore.activate(so.docNo,'receipt','2026-11-15'),f.singleStore.activate(inv.docNo,'receipt','2026-11-15')]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await f.api.readServerDocuments()).filter(d=>d.paymentLedger).length,1);
});
test('post-delivery receipts across orders do not issue a second VAT charge',async()=>{
 const f=await fixture();f.seed();
 for(const no of ['INV-2026-001','INV-2026-002']){let root=f.get('documents',no);const result=f.payments.applyOperation(root,{kind:'delivery',requestId:'delivery-'+no,now:f.api.now()},'TINV-'+no,f.api.today());root.paymentLedger=result.ledger;f.put('documents',no,root);if(result.document)f.put('documents',result.document.docNo,result.document);}
 const before=(await f.api.readServerDocuments()).reduce((s,d)=>s+(d.paymentManaged&&['advance','tax'].includes(d.paymentManaged.kind)?Math.round(d.vat*100):0),0);
 const result=await f.store.commit(await f.batch());assert.equal(result.docNos.length,1);const d=f.get('documents',result.docNos[0]);assert.equal(d.prefix,'RE');assert.equal(d.vat,0);
 const after=(await f.api.readServerDocuments()).reduce((s,d)=>s+(d.paymentManaged&&['advance','tax'].includes(d.paymentManaged.kind)?Math.round(d.vat*100):0),0);assert.equal(after,before);
});
test('explicit head-office labels and formatted tax IDs group together without assuming an empty branch',async()=>{
 const f=await fixture();f.seed();const first=f.get('documents','INV-2026-001'),second=f.get('documents','INV-2026-002');
 second.customerBranch='สำนักงานใหญ่';second.customerTaxId='010-555-0000002';f.put('documents',second.docNo,second);
 assert.equal(f.core.partyKey(first),f.core.partyKey(second));assert.notEqual(f.core.partyKey(first),f.core.partyKey({...first,customerBranch:''}));
 const r=await f.issueBill();assert.equal(f.get('documents',r.docNos[0]).grandTotal,39000);
});
