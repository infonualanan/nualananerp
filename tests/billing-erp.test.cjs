const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{JSDOM}=require('jsdom'),{fixture}=require('./billing-fixture.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],responsive=html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1];
const wait=async check=>{for(let n=0;n<1500;n++){await new Promise(r=>setTimeout(r,1));if(check())return;}throw new Error('ERP accounting UI timeout');};
test('real ERP mounts authenticated billing, guards pending navigation and preserves linked source balances',async t=>{
 const f=await fixture();f.seed();const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'}),w=dom.window,$=id=>w.document.getElementById(id);t.after(()=>dom.window.close());
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.createBillingController=(await import(pathToFileURL(path.join(__dirname,'..','billing-ui.mjs')).href)).createBillingController;w.billingFake=f.api;
 const DateOriginal=w.Date;w.Date=class extends DateOriginal{constructor(...a){super(...(a.length?a:['2026-10-31T10:00:00Z']));}static now(){return DateOriginal.parse('2026-10-31T10:00:00Z');}};
 w.eval(responsive);let code=source.replace(/^\s*import .*?;\s*$/gm,'');const start=code.indexOf('        // --- Firebase Configuration & Initialization ---'),end=code.indexOf('        // Login Feature',start);
 code=code.slice(0,start)+"const auth={},db={},appId='test';let currentUser={uid:'accountant',email:'accountant@example.com'},firebaseUnsubscribers=[];const getUserDoc=(c,id)=>window.billingFake.userDoc(c,id),getUserCol=c=>c,getDocFromServer=window.billingFake.getDocFromServer,runTransaction=window.billingFake.runTransaction,serverTimestamp=window.billingFake.serverTimestamp;const getDocsFromServer=async c=>({docs:(await window.billingFake.readCollection(c)).map(d=>({id:d.id,data:()=>d}))});const onSnapshot=(ref,next)=>{queueMicrotask(async()=>next(await window.billingFake.getDocFromServer(ref)));return()=>{};};const getDoc=getDocFromServer,setDoc=async()=>{},deleteDoc=async()=>{};"+code.slice(end);
 w.eval(code+"\nwindow.erpBillingTest={controller:()=>billingController,reset:resetBillingSession,documents:()=>database,init:(d,c)=>{database=d;companyProfile=c;companyProfileLoaded=true;}};");
 w.erpBillingTest.init(await f.api.readServerDocuments(),f.api.getCompany());$('login-screen').style.display='none';$('main-app').style.display='flex';w.openBillingWorkspace();await w.erpBillingTest.controller().ready;
 const click=selector=>{const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();};
 for(const no of ['INV-2026-001','INV-2026-002']){const el=w.document.querySelector('[data-bl-pick="bill"][data-root="'+no+'"]');el.checked=true;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
 $('bl-bill-due').value='2026-11-10';$('bl-bill-due').dispatchEvent(new w.Event('input',{bubbles:true}));click('[data-bl-action="review-bill"]');assert.equal(w.erpBillingTest.controller().pending,true,$('bl-message').textContent);
 w.switchTab('customers');assert.equal($('tab-billing').classList.contains('active'),true);
 click('[data-bl-action="confirm"]');await wait(()=>!w.erpBillingTest.controller().busy);
 const bill=w.erpBillingTest.documents().find(d=>d.billingManaged);assert.ok(bill);assert.equal(bill.grandTotal,39000);assert.equal(w.erpBillingTest.documents().find(d=>d.docNo==='INV-2026-001').paymentLedger.payments.length,1);
 click('[data-bl-action="close"]');w.previewDocument(bill.docNo);await wait(()=>$('bl-dialog').open);assert.match($('bl-dialog').textContent,/BILLING NOTE/);
 click('[data-bl-action="close"]');click('[data-bl-action="pay-bill"]');
 for(const [id,value]of [['bl-amount','30000'],['bl-reference','ERP-BANK-001'],['bl-proof-note','หลักฐานธนาคารทดสอบ']]){$(id).value=value;$(id).dispatchEvent(new w.Event('input',{bubbles:true}));}
 click('[data-bl-action="allocate"]');$('bl-verified').checked=true;$('bl-verified').dispatchEvent(new w.Event('change',{bubbles:true}));
 click('[data-bl-action="review-payment"]');click('[data-bl-action="confirm"]');await wait(()=>!w.erpBillingTest.controller().busy);
 const posted=w.erpBillingTest.documents().filter(d=>d.paymentManaged?.batchId);
 assert.equal(posted.length,1);assert.equal(posted[0].grandTotal,30000);
 assert.equal(w.erpBillingTest.documents().find(d=>d.docNo==='INV-2026-002').paymentLedger.payments.at(-1).amountCents,600000);
 $('vat-month-filter').value='2026-10';$('vat-type-filter').value='output';w.generateVatReport();assert.equal($('vat-total-vat').textContent,'4,317.75');
 w.erpBillingTest.reset();assert.equal($('billing-workspace').textContent,'');
});
