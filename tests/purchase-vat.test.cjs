const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {draft} = require('./vault-fixture.cjs');

const modules = Promise.all([import('../purchase-vat.mjs'), import('../vault-core.mjs'), import('../vault-ui.mjs')]);
const company = {nameTh:'บริษัทผู้ซื้อทดสอบ',nameEn:'Buyer Test',taxId:'0105550000001',branch:'สำนักงานใหญ่'};
const options = {company, period:'2026-11', today:'2026-11-26'};
const attached = (data = {}, record = {}) => ({id:'vault-file',status:'reviewed',revision:1,data:{...draft(),...data},...record});
const purchase = (doc = {}) => ({docNo:'PINV-TEST-001',vendorInvNo:'TEST-001',inputDate:'2026-11-01',rawDate:'2026-11-01T00:00:00Z',dateStr:'01/11/2026',
    prefix:'PINV',docName:'ใบกำกับภาษีซื้อ',customerTaxId:'0105550000002',customerBranch:'สำนักงานใหญ่',customerName:'บริษัทตัวอย่าง',
    subtotal:6625,vat:463.75,grandTotal:7088.75,currency:'THB',isInputTax:true,status:'completed',items:[],...doc});

test('reports the reviewed attachment in its selected tax month alongside an independent ERP purchase', async () => {
    const [{buildPurchaseVatReport}, {report}] = await modules;
    const item = attached({documentDate:'2026-10-23'});
    const erp = purchase({vendorInvNo:'SECOND',subtotal:100,vat:7,grandTotal:107});
    const unrelated = purchase({docNo:'PO-TEST-001',prefix:'PO',isInputTax:false});
    const r = buildPurchaseVatReport([erp,unrelated], [item], options);
    assert.equal(r.rows.length,2);
    assert.deepEqual(r.rows.map(row => [row.number,row.source]),[['TEST-001','vault'],['SECOND','erp']]);
    assert.deepEqual([r.netCents,r.vatCents],[672500,47075]);
    assert.equal(r.issues.length,0);
    assert.equal(buildPurchaseVatReport([], [item], {...options,period:'2026-10'}).rows.length,0);
    assert.equal(report([item], options).vat,46375,'vault detail uses the same eligibility');
});

test('deduplicates only the same supplier, branch and original invoice number when dates and amounts agree', async () => {
    const [{buildPurchaseVatReport}] = await modules;
    const duplicate = purchase({vendorInvNo:' test-００１ ',customerTaxId:'0-1055-50000-00-2',customerBranch:'Head Office'});
    const otherSupplier = purchase({docNo:'PINV-ANOTHER-SUPPLIER',customerTaxId:'0105550000003'});
    const otherBranch = purchase({docNo:'PINV-BRANCH-01',customerBranch:'สาขาที่ 1'});
    const cancelled = purchase({docNo:'PINV-CANCELLED',status:'cancelled',subtotal:111,vat:7.77});
    const r = buildPurchaseVatReport([duplicate, otherSupplier, otherBranch, cancelled], [attached()], options);
    assert.equal(r.duplicates,1);
    assert.equal(r.rows.length,3);
    assert.equal(r.vatCents,139125);
    assert.equal(r.issues.length,0);
    const kept = r.rows.find(row => row.source==='vault');
    assert.deepEqual(kept.sources,['erp','vault']);
    assert.ok(r.rows.some(row => row.branch==='00001'));
});

test('reports inconsistent amount or period once for review and excludes it from both month totals', async () => {
    const [{buildPurchaseVatReport}] = await modules;
    const a = purchase({subtotal:7500,vat:525,grandTotal:8025});
    const differentAmount = buildPurchaseVatReport([a],[attached()],options);
    assert.equal(differentAmount.rows.length,0);
    assert.match(differentAmount.issues[0].reason,/ยอด.*ไม่ตรงกัน/);
    const old = purchase({inputDate:'',rawDate:'2026-10-31T18:30:00Z'});
    assert.equal(buildPurchaseVatReport([old], [], options).rows[0].date,'2026-11-01','legacy timestamp uses Bangkok dates');
    for (const period of ['2026-10','2026-11']) {
        const r = buildPurchaseVatReport([purchase({inputDate:'2026-10-31'})],[attached({documentDate:'2026-10-31'})],{...options,period});
        assert.equal(r.rows.length,0);
        assert.equal(r.vatCents,0);
        assert.deepEqual(r.issues[0].entries.map(row=>row.month),['2026-10','2026-11']);
    }
});

test('missing supplier identity needs review rather than silently merging records with the same name', async () => {
    const [{buildPurchaseVatReport}] = await modules;
    const r = buildPurchaseVatReport([purchase({customerTaxId:'',customerBranch:''})], [attached()], options);
    assert.equal(r.rows.length,0);
    assert.match(r.issues[0].reason,/ข้อมูลเลขภาษีหรือสาขาผู้ขายไม่ครบ/);
    const otherNumber = buildPurchaseVatReport([purchase({vendorInvNo:'TEST-002',refDocManual:'SAME-PO'})],[attached({referenceNo:'SAME-PO'})],options);
    assert.equal(otherNumber.rows.length,2,'equal VAT and same PO do not identify an invoice');
});

test('drafts and unchecked attachments do not affect manual purchases; only the reviewed tax documents for this buyer qualify', async () => {
    const [{buildPurchaseVatReport}] = await modules;
    const r = buildPurchaseVatReport([purchase()], [
        attached({}, {status:'draft'}), attached({taxEligible:false}),
        attached({buyerTaxId:'0105550000009',documentNo:'WRONG-BUYER'}),
        attached({reviewed:false,documentNo:'NOT-VERIFIED'}),
        attached({documentType:'receipt',documentNo:'RECEIPT-ONLY'}),
        attached({buyerBranch:'00001',documentNo:'WRONG-BRANCH'}),
    ], options);
    assert.deepEqual(r.rows.map(row=>row.source),['erp']);
    assert.equal(r.vatCents,46375);
    assert.equal(r.issues.length,4);
    assert.ok(r.issues.some(i=>i.reason.includes('สาขาผู้ซื้อไม่ตรง')));
});

const html = readFileSync(path.join(__dirname,'../index.html'),'utf8');
const main = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'')
    .replace("vaultLoading=import('./vault-ui.mjs');", 'vaultLoading=Promise.resolve(window.vaultModule);');
async function setup(t) {
    const [report, vault, vaultUI] = await modules;
    const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''), {url:'https://offline.test/',runScripts:'outside-only'});
    const w=dom.window, $=id=>w.document.getElementById(id);
    const originalWindow=global.window; global.window=w;
    t.after(()=>{global.window=originalWindow;dom.window.close();});
    let auth, writes=0, printed=0, file;
    const subscriptions=[];
    const snapshot = (docs,metadata={})=>({metadata,docs:docs.map(value=>({id:value.id||value.docNo,data:()=>structuredClone(value)}))});
    const emit = (suffix, snap, userId='tester')=>subscriptions.filter(s=>!s.stopped&&s.ref.endsWith(`/${userId}/${suffix}`)).forEach(s=>s.next(snap));
    const profile = {exists:()=>true,data:()=>structuredClone(company)};
    const DateOriginal=w.Date; w.Date=class extends DateOriginal{constructor(...args){super(...(args.length?args:['2026-11-26T02:00:00Z']));}};
    Object.assign(w, {buildPurchaseVatReport:report.buildPurchaseVatReport,vatCSVCell:vault.csvCell,vaultModule:vaultUI,
        closeErpMenu(){},erpSetStartupState(){},initializeApp:()=>({}),getAuth:()=>({}),getFirestore:()=>({}),
        doc:(...a)=>a.slice(1).join('/'),collection:(...a)=>a.slice(1).join('/'),onAuthStateChanged:(_auth,cb)=>{auth=cb;},
        getDoc:async()=>profile,getDocFromServer:async()=>profile,getDocsFromServer:async()=>snapshot([]),
        serverTimestamp:()=>null,runTransaction:()=>{writes++;throw new Error('reports must not write');},
        onSnapshot(ref,stateOrNext,nextOrError,error){const opts=typeof stateOrNext!=='function';const s={ref,next:opts?nextOrError:stateOrNext,error:opts?error:nextOrError};subscriptions.push(s);return()=>{s.stopped=true;};},
        setDoc:async()=>{writes++;}, deleteDoc:async()=>{writes++;}, print:()=>{printed++;}, Blob,
        __firebase_config:JSON.stringify({apiKey:'test-only',authDomain:'test.invalid',projectId:'test-project',appId:'test-app'})});
    w.URL.createObjectURL=blob=>{file={blob};return 'blob:test';}; w.URL.revokeObjectURL=()=>{};
    w.HTMLAnchorElement.prototype.click=function(){if(file)file.name=this.download;};
    w.eval(main);
    auth({uid:'tester'}); await new Promise(r=>setTimeout(r,0));
    emit('settings/companyProfile',profile);
    return {w,$,file:()=>file,printed:()=>printed,writes:()=>writes,emit,snapshot,auth,subscriptions};
}

test('the live purchase report follows both snapshots and exports the same rows without writing records', async t=>{
    const {w,$,emit,snapshot,file,writes,printed}=await setup(t);
    w.handleMenuClick('VATIN','report');
    assert.equal($('vat-month-filter').value,'2026-11');
    assert.equal($('vat-export-button').disabled,true);
    assert.equal($('vat-total-vat').textContent,'—');
    emit('documents',snapshot([]));
    emit('accounting_vault',snapshot([attached()],{fromCache:true}));
    assert.equal($('vat-export-button').disabled,true,'offline cache does not masquerade as a complete report');
    emit('accounting_vault',snapshot([attached({documentNo:'=TEST-001'})]));
    assert.match($('vat-table-body').textContent,/คลังแนบ/);
    assert.equal($('vat-total-amt').textContent,'6,625.00');
    assert.equal($('vat-total-vat').textContent,'463.75');
    assert.equal($('vat-table-body').querySelector('[contenteditable]'),null);
    assert.equal($('vat-print-button').disabled,false);
    $('vat-print-button').click(); assert.equal(printed(),1);
    w.exportVatToCSV();
    assert.equal(file().name,'VAT_input_2026-11.csv');
    const csv=await file().blob.text();
    assert.match(csv,/"'=TEST-001"/);
    assert.match(csv,/"6,625\.00","463\.75"/);
    assert.doesNotMatch(csv,/คลังแนบ/);
    emit('documents',snapshot([purchase({vendorInvNo:'=TEST-001'})]));
    assert.equal($('vat-table-body').rows.length,1);
    assert.match($('vat-purchase-summary').textContent,/ตรงกันแล้ว 1/);
    emit('documents',snapshot([purchase({vendorInvNo:'=TEST-001',subtotal:100,vat:7})]));
    assert.equal($('vat-print-button').disabled,true);
    assert.equal($('vat-export-button').disabled,true);
    assert.match($('vat-purchase-issues').textContent,/TEST-001.*ไม่ตรงกัน/);
    assert.equal(writes(),0);
});

test('the links carry the selected month both ways and old-account snapshots cannot reappear', async t=>{
    const {w,$,emit,snapshot,auth,subscriptions,writes}=await setup(t);
    const month='2026-10';
    w.handleMenuClick('VATIN','report'); $('vat-month-filter').value=month;
    $('vat-month-filter').dispatchEvent(new w.Event('change'));
    emit('documents',snapshot([]));
    const records=snapshot([attached({documentDate:'2026-10-23',reportMonth:month})]);
    emit('accounting_vault',records);
    $('vat-open-vault').click();
    await new Promise(r=>setTimeout(r,0));
    emit('accounting_vault',records);
    const vault=$('accounting-vault-workspace');
    assert.equal($('tab-vault').classList.contains('active'),true);
    assert.equal(vault.querySelector('[data-period]').value,month);
    assert.match(vault.querySelector('tbody').textContent,/TEST-001/);
    vault.querySelector('[data-action=open-vat]').click();
    assert.equal($('tab-vat-report').classList.contains('active'),true);
    assert.equal($('vat-month-filter').value,month);
    assert.equal($('vat-type-filter').value,'input');
    assert.equal($('vat-total-vat').textContent,'463.75');
    const previousAccount= subscriptions.find(s=>s.ref.endsWith('/tester/accounting_vault'));
    auth({uid:'next-user'});await new Promise(r=>setTimeout(r,0));
    w.handleMenuClick('VATIN','report');
    emit('settings/companyProfile',{exists:()=>true,data:()=>company},'next-user');
    emit('documents',snapshot([]),'next-user');
    emit('accounting_vault',snapshot([]),'next-user');
    assert.equal(previousAccount.stopped,true);
    previousAccount.next(records);
    assert.doesNotMatch($('vat-table-body').textContent,/TEST-001/);
    assert.equal($('vat-total-vat').textContent,'0.00');
    assert.equal(writes(),0);
});
