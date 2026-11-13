// Synthetic images and records only; all reads/writes use an in-memory Firestore adapter.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=readFileSync(path.join(__dirname,'../index.html'),'utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR2oAAAAASUVORK5CYII=';
const uid='test-signature-owner';
const profile={version:1,revision:'c4777347-5a44-4691-8f57-2a697fdaace5',image:png,name:'ผู้เซ็นตัวอย่าง',position:'ฝ่ายบริษัท'};
const replacement={...profile,revision:'aff1f772-2767-46f0-b301-41bf35e79d55',name:'ผู้เซ็นใหม่'};
const ref=(owner,collection,key)=>`artifacts/test/users/${owner}/${collection}/${key}`;
const setting=owner=>ref(owner,'settings','documentSignature');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t,records=new Map()){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'});
 t.after(()=>dom.window.close());const w=dom.window,$=id=>w.document.getElementById(id);
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 const watches=[],writes=[],pdfs=[];let notify,failWrite=false,imageReader=async()=>png;
 const snap=(key,metadata={})=>({exists:()=>records.has(key),data:()=>structuredClone(records.get(key)),metadata});
 w.__firebase_config=JSON.stringify({apiKey:'synthetic',authDomain:'offline.test',projectId:'synthetic',appId:'synthetic'});w.__app_id='test';
 w.initializeApp=()=>({});w.getAuth=()=>({});w.getFirestore=()=>({});w.onAuthStateChanged=(_auth,callback)=>{notify=callback;};
 w.doc=(...args)=>args.slice(1).join('/');w.collection=w.doc;
 w.getDoc=async key=>key.endsWith('/settings/companyProfile')?{exists:()=>true,data:()=>({})}:snap(key);
 w.getDocsFromServer=async()=>({docs:[]});w.getDocFromServer=async key=>snap(key);
 w.onSnapshot=(key,options,next,error)=>{
  if(typeof options==='function'){error=next;next=options;}
  const watch={key,next,error,stopped:false};watches.push(watch);
  if(key.endsWith('/settings/documentSignature'))queueMicrotask(()=>{if(!watch.stopped)next(snap(key));});
  return()=>{watch.stopped=true;};
 };
 const deliver=(key,metadata={})=>{for(const watch of watches)if(watch.key===key&&!watch.stopped)watch.next(snap(key,metadata));};
 w.runTransaction=async(_db,fn)=>{
  const pending=[];const result=await fn({get:async key=>snap(key),set:(key,data)=>pending.push({key,data:structuredClone(data)}),delete:key=>pending.push({key})});
  if(failWrite)throw new Error('permission-denied');
  for(const write of pending){if(write.data)records.set(write.key,write.data);else records.delete(write.key);writes.push(write);deliver(write.key);}
  return result;
 };
 w.setDoc=async()=>{throw new Error('Unexpected unprotected write');};w.serverTimestamp=()=> 'synthetic-server-time';
 w.prepareSignatureForTest=file=>imageReader(file);
 w.html2pdf=()=>({set(){return this;},from(node){pdfs.push(node);return this;},async save(){}});
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 source=source.replace("await import('./document-signature-image.mjs')","{prepareDocumentSignature:window.prepareSignatureForTest}");
 w.eval(source+`\nwindow.signatureTest={setDocs:docs=>database=docs,seed:()=>{customers=[{id:'customer',name:'คู่ค้าตัวอย่าง',code:'C001',address:'',taxId:'',branch:'',email:''}];employees=[];savedRemarks=[];remarksLoaded=true;remarksDataUserId=currentUser.uid;},choice:()=>selectedDocumentSignature};`);
 const account=async owner=>{notify(owner?{uid:owner}:null);await tick();await tick();if(owner)w.signatureTest.seed();};
 await account(uid);
 const change=(id,value,event='change')=>{const el=$(id);el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));};
 const submit=async id=>{$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();};
 const upload=async()=>{const input=$('signature-settings-file');Object.defineProperty(input,'files',{value:[new w.File(['fake image'],'synthetic.png',{type:'image/png'})],configurable:true});input.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();};
 const draft=prefix=>{w.handleMenuClick(prefix,'create');$('customer-select').value='customer';$('doc-date').value='2026-01-01';const row=$('items-container').firstElementChild;row.querySelector('.item-name').value='รายการทดสอบ';row.querySelector('.item-price').value='100';w.calculateLiveTotal();};
 const docs=()=>[...records].filter(([key])=>key.includes('/documents/')).map(([,data])=>data);
 return {w,$,account,change,submit,upload,draft,docs,writes,watches,pdfs,records,deliver,setFailure:value=>failWrite=value,setReader:reader=>imageReader=reader};
}

test('settings saves a selected image only after clicking save; a new session remembers it and documents still default to no signature',async t=>{
 const a=await setup(t);a.w.switchTab('settings');assert.equal(a.$('signature-settings-file').disabled,false);assert.equal(a.$('signature-settings-preview').hidden,true);
 await a.upload();assert.equal(a.$('signature-settings-preview').hidden,false);assert.equal(a.writes.length,0);assert.equal(a.$('document-signature-include').disabled,true);
 a.change('signature-settings-name',' ผู้เซ็นตัวอย่าง ','input');a.change('signature-settings-position','ฝ่ายบริษัท','input');await a.submit('signature-settings-form');
 assert.equal(a.writes.length,1);assert.equal(a.writes[0].key,setting(uid));assert.equal(a.records.get(setting(uid)).image,png);assert.match(a.$('signature-settings-status').textContent,/บันทึกลายเซ็นแล้ว/);
 const b=await setup(t,a.records);b.w.switchTab('settings');assert.equal(b.$('signature-settings-name').value,profile.name);assert.equal(b.$('signature-settings-preview').src,png);
 b.draft('QT');assert.equal(b.$('document-signature-choice').value,'none');assert.equal(b.$('document-signature-include').disabled,false);
 await b.submit('create-doc-form');assert.equal(Object.hasOwn(b.docs()[0],'documentSignature'),false);
});

test('signed documents save an issuance snapshot and place it on the company side of quotations, purchase orders, and deliveries',async t=>{
 const a=await setup(t,new Map([[setting(uid),profile]]));
 for(const [prefix,slot,label] of [['QT','auth','ผู้เสนอราคา'],['PO','maker','ผู้สั่งซื้อ'],['DO','auth','ผู้ส่งของ']]){
  a.draft(prefix);assert.equal(a.$('document-signature-choice').value,'none');a.change('document-signature-choice','include');
  assert.equal(a.$('document-signature-thumb').src,png);assert.match(a.$('document-signature-help').textContent,new RegExp(label));
  await a.submit('create-doc-form');const record=a.docs().find(d=>d.prefix===prefix);assert.ok(record);
  assert.equal(record.documentSignature.docNo,record.docNo);assert.equal(record.documentSignature.appliedByUid,uid);assert.equal(record.documentSignature.appliedAt,'synthetic-server-time');
  a.w.signatureTest.setDocs(a.docs());a.w.previewDocument(record.docNo);
  assert.equal(a.$('preview-signature-'+slot).src,png);assert.equal(a.$('preview-signature-'+(slot==='auth'?'maker':'auth')).hidden,true);
  assert.equal(a.$('preview-lbl-'+slot).textContent,label);assert.equal(a.$('preview-lbl-stamp-'+slot).textContent,profile.name+'\n'+profile.position);
  a.w.closePreview();assert.equal(a.$('preview-signature-'+slot).hasAttribute('src'),false);
 }
 const doc=a.docs().find(d=>d.prefix==='QT');a.w.updateDocumentTable();a.w.document.querySelector('[data-download-pdf="'+doc.docNo+'"]').click();await tick();
 assert.equal(a.pdfs.length,1);assert.equal(a.pdfs[0].querySelector('#preview-signature-auth').src,png);
});

test('replacing or removing the settings image does not change issued documents, and loading one to issue a new number clears the selection',async t=>{
 const a=await setup(t,new Map([[setting(uid),profile]]));a.draft('QT');a.change('document-signature-choice','include');await a.submit('create-doc-form');const issued=a.docs()[0];
 a.records.set(setting(uid),replacement);a.deliver(setting(uid));a.w.signatureTest.setDocs([issued]);a.w.previewDocument(issued.docNo);
 assert.equal(a.$('preview-lbl-stamp-auth').textContent,profile.name+'\n'+profile.position);a.w.closePreview();
 a.w.switchTab('settings');a.$('signature-settings-remove').click();a.$('custom-confirm-ok').click();await tick();assert.equal(a.records.has(setting(uid)),false);
 a.w.previewDocument(issued.docNo);assert.equal(a.$('preview-signature-auth').src,png);a.w.closePreview();
 a.w.editDocument(issued.docNo);a.$('custom-confirm-ok').click();assert.equal(a.$('document-signature-choice').value,'none');assert.equal(a.$('document-signature-include').disabled,true);
 a.$('customer-select').value='customer';await a.submit('create-doc-form');const newDoc=a.docs().find(d=>d.docNo!==issued.docNo);assert.ok(newDoc);assert.equal(newDoc.documentSignature,undefined);
});

test('changes from another tab invalidate a selected signature both before save and at the transaction',async t=>{
 const a=await setup(t,new Map([[setting(uid),profile]]));a.draft('QT');a.change('document-signature-choice','include');
 a.records.set(setting(uid),replacement);a.deliver(setting(uid),{hasPendingWrites:true});assert.equal(a.$('document-signature-choice').value,'include');
 await a.submit('create-doc-form');assert.equal(a.docs().length,0);assert.match(a.$('custom-alert-msg').textContent,/เลือกใหม่/);
 a.deliver(setting(uid));a.change('document-signature-choice','include');a.records.set(setting(uid),profile);a.deliver(setting(uid));
 assert.equal(a.$('document-signature-choice').value,'none');await a.submit('create-doc-form');assert.equal(a.docs().length,0);assert.match(a.$('custom-alert-msg').textContent,/รูปที่เลือกเปลี่ยนแล้ว/);
 assert.equal(a.w.document.querySelector('.item-name').value,'รายการทดสอบ');
 a.change('document-signature-choice','include');await a.submit('create-doc-form');assert.equal(a.docs()[0].documentSignature.revision,profile.revision);
});

test('an unsigned issue from a stale tab cannot overwrite an existing signed document number',async t=>{
 const number='QT-2026-001';const old={docNo:number,prefix:'QT',documentSignature:{...profile,docNo:number,prefix:'QT',appliedByUid:uid}};
 const key=ref(uid,'documents',number),a=await setup(t,new Map([[key,old],[setting(uid),profile]]));
 a.draft('QT');assert.equal(a.$('document-signature-choice').value,'none');await a.submit('create-doc-form');
 assert.deepEqual(a.records.get(key),old);assert.equal(a.records.has(ref(uid,'documents','QT-2026-002')),true);assert.equal(a.records.get(ref(uid,'documents','QT-2026-002')).documentSignature,undefined);
});

test('failed settings writes preserve the draft, and a stale tab must review before replacing newer settings',async t=>{
 const a=await setup(t,new Map([[setting(uid),profile]]));a.w.switchTab('settings');a.change('signature-settings-name','แก้ชื่อไว้','input');
 a.setFailure(true);await a.submit('signature-settings-form');assert.equal(a.records.get(setting(uid)).name,profile.name);assert.equal(a.$('signature-settings-name').value,'แก้ชื่อไว้');assert.equal(a.$('signature-settings-save').disabled,false);
 a.setFailure(false);a.records.set(setting(uid),replacement);await a.submit('signature-settings-form');assert.equal(a.writes.length,0);assert.equal(a.records.get(setting(uid)).name,replacement.name);assert.match(a.$('signature-settings-status').textContent,/อีกหน้าต่าง/);
 await a.submit('signature-settings-form');assert.equal(a.records.get(setting(uid)).name,'แก้ชื่อไว้');
});

test('switching accounts clears the saved image and rejects late upload results and old listeners',async t=>{
 const a=await setup(t,new Map([[setting(uid),profile]]));a.w.switchTab('settings');const oldWatch=a.watches.find(w=>w.key===setting(uid));
 let finish;const pending=new Promise(resolve=>finish=resolve);a.setReader(()=>pending);await a.upload();await a.account('another-test-account');finish(png);await tick();
 oldWatch.next({exists:()=>true,data:()=>profile,metadata:{}});oldWatch.error(new Error('old listener failed'));
 assert.equal(oldWatch.stopped,true);assert.equal(a.$('signature-settings-preview').hasAttribute('src'),false);assert.equal(a.$('signature-settings-name').value,'');assert.equal(a.writes.length,0);
 a.draft('QT');assert.equal(a.$('document-signature-include').disabled,true);assert.equal(a.$('document-signature-choice').value,'none');
});

test('a stored non-raster URL is never loaded as a signature',async t=>{
 const a=await setup(t,new Map([[setting(uid),{...profile,image:'https://example.invalid/signature.svg'}]]));a.draft('QT');assert.equal(a.$('document-signature-include').disabled,true);
 const record={docNo:'QT-invalid',prefix:'QT',docName:'Quotation',items:[],documentSignature:{...profile,docNo:'QT-invalid',prefix:'QT',appliedByUid:uid,image:'data:image/svg+xml,<svg/>'}};
 a.w.signatureTest.setDocs([record]);a.w.previewDocument(record.docNo);assert.equal(a.$('preview-signature-auth').hasAttribute('src'),false);
});
