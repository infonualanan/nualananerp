// Synthetic customer records only; no production account or database is accessed.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),ui=import('../customer-intake-ui.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const extracted={readable:true,candidates:[{name:'บริษัทลูกค้าทดสอบ จำกัด',contactName:'ผู้ติดต่อทดสอบ',email:'contact@example.invalid',phone:'000-000-0000',registrationNo:'0000000000000',taxId:'0000000000000',address:'ที่อยู่ทดสอบตามต้นฉบับ',branch:null,role:'company',warnings:[]}],warnings:[]};
async function setup(t,initial=[]){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://erp.test/'}),w=dom.window,$=id=>w.document.getElementById(id),writes=[],records=new Map(initial.map(row=>[row.id,structuredClone(row)]));
 t.after(()=>dom.window.close());
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 let readerFetch=async()=>({ok:true,json:async()=>({extraction:extracted})}),controller;
 const {createCustomerIntake}=await ui;w.makeCustomerIntake=(root,api)=>controller=createCustomerIntake(root,{...api,fetch:(...args)=>readerFetch(...args)});
 w.fakeAll=async()=>({docs:[...records.values()].map(row=>({id:row.id,data:()=>structuredClone(row)}))});
 w.fakeSet=async(ref,value)=>{const row=JSON.parse(JSON.stringify(value));writes.push({ref,row});records.set(ref.split('/').at(-1),row)};
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'').replace("import('./customer-intake-ui.mjs')","Promise.resolve({createCustomerIntake:window.makeCustomerIntake})");
 const start=source.indexOf('        // --- Firebase Configuration & Initialization ---'),end=source.indexOf('        // Login Feature',start);
 source=source.slice(0,start)+`const auth={},db={},appId='test';let currentUser={uid:'test-owner',getIdToken:async()=> 'test.token'},firebaseUnsubscribers=[];const getUserCol=name=>name,getUserDoc=(name,id)=>name+'/'+id;const setDoc=window.fakeSet,getDocsFromServer=window.fakeAll;`+source.slice(end);
 w.eval(source+`\ncustomers=${JSON.stringify(initial)};customersLoaded=true;window.customerTest={switchAccount:()=>{currentUser={uid:'another-owner'};customers=[];resetCustomerIntakeSession();},state:()=>({saving:customerSaveInProgress})};`);
 w.switchTab('customers');await tick();
 t.after(()=>controller?.destroy());
 const q=selector=>$('customer-ai-intake').querySelector(selector);
 async function read(){q('[data-ai-text]').value='บริษัทลูกค้าทดสอบ จำกัด ที่อยู่ทดสอบ';q('[data-ai-read]').click();for(let i=0;i<100&&controller.busy;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(controller.busy,false)}
 async function submit(){ $('add-customer-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick() }
 return {w,$,q,records,writes,read,submit,setReader:fetcher=>readerFetch=fetcher};
}
test('AI fills the real new-customer form without writes; manual save persists phone and registration and reopens them for editing',async t=>{
 const e=await setup(t),{$,w}=e;
 await e.read();assert.equal(e.writes.length,0);assert.equal($('new-cust-name').value,extracted.candidates[0].name);assert.equal($('new-cust-branch').value,'');
 $('new-cust-phone').value='000-111-2222';await e.submit();assert.equal(e.writes.length,1);const saved=e.writes[0].row;
 assert.match(e.writes[0].ref,/^customers\//);assert.equal(saved.phone,'000-111-2222');assert.equal(saved.registrationNo,'0000000000000');assert.equal(saved.taxId,'0000000000000');assert.equal(saved.address,extracted.candidates[0].address);assert.equal(saved.code,'C-0001');
 assert.equal(e.q('[data-ai-text]').value,'');assert.equal($('new-cust-name').value,'');
 w.editCustomer(saved.id);assert.equal($('new-cust-phone').value,saved.phone);assert.equal($('new-cust-registration').value,saved.registrationNo);assert.equal($('customer-ai-intake').hidden,true);assert.equal(e.writes.length,1);
});
test('an AI-filled duplicate still requires the existing duplicate guard and never creates a record',async t=>{
 const e=await setup(t,[{id:'existing',code:'C-0001',...extracted.candidates[0]}]);await e.read();await e.submit();assert.equal(e.writes.length,0);assert.equal(e.$('customer-duplicate-dialog').open,true);
 e.w.customerTest.switchAccount();assert.equal(e.$('customer-duplicate-dialog').open,false);assert.equal(e.$('customer-duplicate-name').textContent,'');assert.equal(e.$('new-cust-name').value,'');
});
test('server-side duplicate recheck prevents AI-filled form from duplicating a record added from another device',async t=>{
 const e=await setup(t);await e.read();e.records.set('another-device',{id:'another-device',code:'C-0001',...extracted.candidates[0]});await e.submit();assert.equal(e.writes.length,0);assert.equal(e.$('customer-duplicate-dialog').open,true);assert.equal(e.$('new-cust-name').value,extracted.candidates[0].name);assert.equal(e.$('btn-save-cust').disabled,false);
});
