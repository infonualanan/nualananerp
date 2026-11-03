const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,collection,getDocFromServer,getDocs,setDoc,runTransaction,writeBatch,serverTimestamp,Bytes,onSnapshot}=require('firebase/firestore');
let env;
before(async()=>{assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Run through Firebase emulator only');env=await initializeTestEnvironment({projectId:'demo-erp-vault',firestore:{rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});
after(async()=>{await env?.cleanup();});
test('database enforces account isolation for vault, original chunks and existing ERP collections',async()=>{
 const own=env.authenticatedContext('owner').firestore(),other=env.authenticatedContext('other').firestore(),guest=env.unauthenticatedContext().firestore();
 const p='artifacts/default-app-id/users/owner/';
 for(const c of ['accounting_vault','accounting_file_chunks','accounting_vault_history','accounting_vault_keys','documents','settings','factory_meta']){
  await assertSucceeds(setDoc(doc(own,p+c+'/isolation-test'),{sample:true}));
  await assertSucceeds(getDocFromServer(doc(own,p+c+'/isolation-test')));
  await assertFails(getDocFromServer(doc(other,p+c+'/isolation-test')));
  await assertFails(setDoc(doc(other,p+c+'/isolation-test'),{overwritten:true}));
  await assertFails(getDocFromServer(doc(guest,p+c+'/isolation-test')));
 }
 await assertSucceeds(getDocs(collection(own,p+'accounting_vault')));
 await assertFails(getDocs(collection(other,p+'accounting_vault')));
 await assertFails(setDoc(doc(own,'unscoped/secret'),{sample:true}));
});

test('10 MB PDF uploads in bounded batches, retries interruption and reads through an owner-scoped server reference',async()=>{
 const {JSDOM}=require('jsdom'),{createMockUserToken}=require('@firebase/util');
 const {createVaultController}=await import('../vault-ui.mjs'),{createVaultStore}=await import('../vault-firestore.mjs'),{sha256}=await import('../vault-core.mjs');
 const {createVaultFileLoader}=await import('../server/vault-file.mjs'),{createDocumentReader}=await import('../server/document-reader.mjs'),{draft}=require('./vault-fixture.cjs');
 const uid='large-pdf-owner',bytes=new Uint8Array(10000000);bytes.fill(32);bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
 const id=await sha256(bytes),token=createMockUserToken({sub:uid,iat:Math.floor(Date.now()/1000)},'demo-erp-vault');
 const dom=new JSDOM('<main id="vault"></main>',{url:'https://erp.example'}),previous={window:global.window,document:global.document,fetch:global.fetch,setTimeout:global.setTimeout,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
 global.window=dom.window;global.document=dom.window.document;URL.createObjectURL=()=> 'blob:large-pdf-test';URL.revokeObjectURL=()=>{};
 global.setTimeout=(fn,ms,...args)=>{const timer=previous.setTimeout(fn,ms,...args);if(ms>=60000)timer.unref?.();return timer;};
 let controller,batches=0,interrupted=false,requests=0,bills=0;const batchSizes=[];
 const company={nameTh:'บริษัทผู้ซื้อทดสอบ',taxId:'0105550000001',branch:'00000'};
 function api(){const db=env.authenticatedContext(uid).firestore();return {db,runTransaction,serverTimestamp,getDocFromServer,toBytes:Bytes.fromUint8Array,getUserId:()=>uid,getIdToken:async()=>token,userDoc:(c,i)=>doc(db,'artifacts','default-app-id','users',uid,c,i),getCompany:()=>company,getActor:()=>({name:'ทดสอบ PDF 10 MB'}),today:()=> '2026-11-02',watchRecords:(next,error)=>onSnapshot(collection(db,'artifacts','default-app-id','users',uid,'accounting_vault'),s=>next(s.docs.map(d=>({...d.data(),id:d.id}))),error),writeFileChunkBatch:async entries=>{batches++;batchSizes.push(entries.length);if(batches===2&&!interrupted){interrupted=true;throw new Error('จำลองอินเทอร์เน็ตขาดช่วง');}const batch=writeBatch(db);for(const e of entries)batch.set(e.ref,e.data);await batch.commit();}};}
 const check=api(),load=createVaultFileLoader({origin:'http://'+process.env.FIRESTORE_EMULATOR_HOST,projectId:'demo-erp-vault',fetchImpl:previous.fetch});
 const handler=createDocumentReader({verifyToken:async t=>{assert.equal(t,token);return {uid};},allowedUids:()=>[uid],getGatewayToken:async()=> 'test-oidc',loadVaultFile:load,fetchImpl:async(url,options)=>{bills++;assert.equal(url,'https://ai-gateway.vercel.sh/v1/responses');const input=JSON.parse(options.body).input[1].content[1];assert.equal(input.type,'input_file');assert.equal(await sha256(Buffer.from(input.file_data.split(',')[1],'base64')),id);return {ok:true,json:async()=>({output_text:JSON.stringify({...draft(),documentNo:'LARGE-PDF-001',readable:true})})};}});
 global.fetch=async(url,options)=>{
  if(url!=='/api/accounting-read')return previous.fetch(url,options);
  requests++;assert.ok(options.body.length<200);const body=JSON.parse(options.body);assert.equal(body.fileId,id);assert.equal(body.data,undefined);
  const persisted=(await getDocFromServer(check.userDoc('accounting_vault',id))).data();assert.equal(persisted.status,'draft');assert.equal(persisted.source.size,10000000);assert.equal(persisted.source.chunks,23);assert.equal(persisted.data.documentNo,'');
  let status,result;await handler({method:'POST',headers:{authorization:options.headers.Authorization},body},{setHeader(){},status(n){status=n;return this;},json(x){result=x;}});return {ok:status===200,json:async()=>result};
 };
 const root=dom.window.document.querySelector('#vault'),event=type=>new dom.window.Event(type,{bubbles:true});
 const wait=async condition=>{const deadline=Date.now()+25000;while(Date.now()<deadline){if(condition())return;await new Promise(r=>previous.setTimeout(r,10));}throw new Error('Large PDF flow did not settle');};
 const click=async action=>{root.querySelector('[data-action="'+action+'"]').click();await wait(()=>!controller.busy);};
 try{
  controller=createVaultController(root,api());controller.open();assert.match(root.textContent,/PDF ไม่เกิน 10 MB/);
  const input=root.querySelector('[data-upload]');Object.defineProperty(input,'files',{configurable:true,value:[{name:'large.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});input.dispatchEvent(event('change'));await wait(()=>!controller.busy);
  await click('read');assert.match(root.querySelector('[data-message]').textContent,/อินเทอร์เน็ตขาดช่วง/);assert.equal(requests,0);assert.equal((await getDocFromServer(check.userDoc('accounting_vault',id))).exists(),false);
  assert.equal((await getDocs(collection(check.db,'artifacts','default-app-id','users',uid,'accounting_file_chunks'))).size,4);
  await click('read');assert.equal(requests,1);assert.equal(bills,1);assert.ok(batchSizes.every(n=>n<=4));assert.equal(root.querySelector('[data-field=documentNo]').value,'LARGE-PDF-001');assert.equal(root.querySelector('[data-check=reviewed]').checked,false);
  let saved=(await getDocFromServer(check.userDoc('accounting_vault',id))).data();assert.equal(saved.status,'draft');assert.equal(saved.revision,1);assert.equal(saved.data.taxEligible,false);assert.equal(saved.data.documentNo,'');
  assert.equal((await getDocs(collection(check.db,'artifacts','default-app-id','users',uid,'accounting_file_chunks'))).size,23);
  const readOriginal=await createVaultStore(api()).original({id});assert.deepEqual(readOriginal.bytes,bytes);
  const otherToken=createMockUserToken({sub:'other',iat:Math.floor(Date.now()/1000)},'demo-erp-vault');await assert.rejects(load({uid,token:otherToken,fileId:id}),e=>e.code==='source_unavailable');
  for(const name of ['taxEligible','reviewed']){const el=root.querySelector('[data-check='+name+']');el.checked=true;el.dispatchEvent(event('input'));}
  await click('save');saved=(await getDocFromServer(check.userDoc('accounting_vault',id))).data();assert.equal(saved.status,'reviewed');assert.equal(saved.revision,2);assert.equal(saved.data.documentNo,'LARGE-PDF-001');
  // Oversized selections fail before loading bytes and keep the current draft/source.
  for(const [type,size,limit]of [['application/pdf',10000001,'10 MB'],['image/png',2500001,'2.5 MB']]){const chosen=root.querySelector('[data-upload]');Object.defineProperty(chosen,'files',{value:[{name:'too-large',type,size,arrayBuffer:async()=>{throw new Error('oversized file bytes must never load');}}]});chosen.dispatchEvent(event('change'));await wait(()=>!controller.busy);assert.ok(root.querySelector('[data-message]').textContent.includes(limit));assert.equal(root.querySelector('[data-field=documentNo]').value,'LARGE-PDF-001');}
  assert.equal(requests,1);assert.equal(bills,1);
 }finally{controller?.destroy();global.window=previous.window;global.document=previous.document;global.fetch=previous.fetch;global.setTimeout=previous.setTimeout;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;dom.window.close();}
});
test('actual SDK persists original bytes atomically and a second authenticated device restores them',async()=>{
 const {createVaultStore}=await import('../vault-firestore.mjs'),{sha256}=await import('../vault-core.mjs'),{draft}=require('./vault-fixture.cjs');
 const bytes=new Uint8Array(fs.readFileSync(path.join(__dirname,'../assets/ocr-connection-test.png'))),id=await sha256(bytes);
 const adapter=uid=>{const db=env.authenticatedContext(uid).firestore();return createVaultStore({db,runTransaction,serverTimestamp,getDocFromServer,toBytes:Bytes.fromUint8Array,getUserId:()=>uid,userDoc:(c,i)=>doc(db,'artifacts','default-app-id','users',uid,c,i),getCompany:()=>({nameTh:'ตัวอย่าง',taxId:'0105550000001',branch:'00000'}),getActor:()=>({name:'ทดสอบ'}),today:()=> '2026-11-01'});};
 const first=adapter('owner'),second=adapter('owner');await first.save({id,bytes,mimeType:'image/png',filename:'original.png',status:'reviewed',data:draft(),expectedRevision:0});
 const restored=await second.original({id});assert.deepEqual(restored.bytes,bytes);assert.equal(restored.filename,'original.png');
 const other=env.authenticatedContext('other').firestore();await assertFails(getDocFromServer(doc(other,'artifacts','default-app-id','users','owner','accounting_vault',id)));
 const legacy=doc(env.authenticatedContext('owner').firestore(),'artifacts','default-app-id','users','owner','documents','old-document');await assertSucceeds(setDoc(legacy,{docNo:'old-document',grandTotal:60000}));assert.equal((await getDocFromServer(legacy)).data().grandTotal,60000);
});

test('upload, OCR review, real database save, second session and monthly/yearly exports stay connected',async()=>{
 const {JSDOM}=require('jsdom'),{createVaultController}=await import('../vault-ui.mjs'),{sha256}=await import('../vault-core.mjs'),{draft}=require('./vault-fixture.cjs');
 const bytes=new Uint8Array(fs.readFileSync(path.join(__dirname,'../assets/ocr-connection-test.png'))),id=await sha256(bytes),uid='full-flow-owner';
 const dom=new JSDOM('<main id="vault"></main>',{url:'https://erp.example'}),previous={window:global.window,document:global.document,fetch:global.fetch,setTimeout:global.setTimeout,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
 global.window=dom.window;global.document=dom.window.document;
 global.setTimeout=(fn,ms,...args)=>{const timer=previous.setTimeout(fn,ms,...args);if(ms>=60000)timer.unref?.();return timer;};
 const blobs=[];let printed='',controller;
 URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:fixture-'+blobs.length;};URL.revokeObjectURL=()=>{};
 dom.window.HTMLAnchorElement.prototype.click=()=>{};
 dom.window.open=()=>({document:{write:html=>printed=html,close(){}},opener:null});
 global.fetch=(url,options)=>{
  if(url!=='/api/accounting-read')return previous.fetch(url,options);
  const body=JSON.parse(options.body);assert.equal(body.data,Buffer.from(bytes).toString('base64'));assert.equal(body.mimeType,'image/png');
  return Promise.resolve({ok:true,json:async()=>({fileHash:id,requestId:body.requestId,readAt:'2026-11-02T00:00:00Z',model:'openai/gpt-4.1-mini',extraction:{...draft(),documentNo:'FULL-FLOW-001',readable:true}})});
 };
 const company={nameTh:'บริษัทผู้ซื้อทดสอบ',taxId:'0105550000001',branch:'00000'};
 function api(){const db=env.authenticatedContext(uid).firestore();return {db,runTransaction,serverTimestamp,getDocFromServer,toBytes:Bytes.fromUint8Array,getUserId:()=>uid,getIdToken:async()=> 'emulator-ui-token',userDoc:(c,i)=>doc(db,'artifacts','default-app-id','users',uid,c,i),getCompany:()=>company,getActor:()=>({name:'ทดสอบครบขั้นตอน'}),today:()=> '2026-11-02',watchRecords:(next,error)=>onSnapshot(collection(db,'artifacts','default-app-id','users',uid,'accounting_vault'),s=>next(s.docs.map(d=>({...d.data(),id:d.id}))),error)};}
 const root=dom.window.document.querySelector('#vault'),event=(type)=>new dom.window.Event(type,{bubbles:true});
 const wait=async condition=>{const deadline=Date.now()+8000;while(Date.now()<deadline){if(condition())return;await new Promise(r=>previous.setTimeout(r,10));}throw new Error('Full document flow did not settle');};
 const click=async action=>{root.querySelector('[data-action="'+action+'"]').click();await wait(()=>!controller.busy);};
 try{
  controller=createVaultController(root,api());controller.open();
  const input=root.querySelector('[data-upload]');Object.defineProperty(input,'files',{value:[{name:'full-flow.png',type:'image/png',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});input.dispatchEvent(event('change'));await wait(()=>!controller.busy);
  await click('read');assert.equal(root.querySelector('[data-field=documentNo]').value,'FULL-FLOW-001');assert.equal(root.querySelector('[data-row="0"][data-key=quantity]').value,'265');assert.equal(root.querySelector('[data-field=grandTotal]').value,'7088.75');
  assert.equal(root.querySelector('[data-check=reviewed]').checked,false);assert.equal(root.querySelector('[data-check=taxEligible]').checked,false);
  await click('save');assert.match(root.querySelector('[data-message]').textContent,/ยืนยันตรวจต้นฉบับ/);
  const check=api();assert.equal((await getDocFromServer(check.userDoc('accounting_vault',id))).exists(),false);
  for(const name of ['taxEligible','reviewed']){const el=root.querySelector('[data-check='+name+']');el.checked=true;el.dispatchEvent(event('input'));}
  await click('save');assert.match(root.querySelector('[data-message]').textContent,/บันทึกข้อมูลที่ตรวจแล้วบนคลาวด์สำเร็จ/);assert.equal((await getDocFromServer(check.userDoc('accounting_vault',id))).data().status,'reviewed');
  controller.destroy();controller=createVaultController(root,api());controller.open();root.querySelector('[data-action=view][data-view=library]').click();await wait(()=>!controller.busy&&root.textContent.includes('FULL-FLOW-001'));
  await click('open');assert.equal(root.querySelector('[data-field=documentNo]').value,'FULL-FLOW-001');assert.ok(root.querySelector('img[alt="ต้นฉบับ full-flow.png"]'));assert.deepEqual(new Uint8Array(await blobs.at(-1).arrayBuffer()),bytes);
  root.querySelector('[data-action=view][data-view=reports]').click();await wait(()=>!controller.busy);assert.match(root.querySelector('tbody').textContent,/FULL-FLOW-001/);assert.match(root.textContent,/7,088\.75/);
  await click('csv');let csv=await blobs.at(-1).text();assert.match(csv,/FULL-FLOW-001/);assert.match(csv,/"6625\.00","463\.75","7088\.75"/);
  await click('print');assert.match(printed,/FULL-FLOW-001/);assert.match(printed,/7,088\.75/);assert.match(printed,/size:A4 landscape/);
  const period=root.querySelector('[data-period-type]');period.value='year';period.dispatchEvent(event('change'));await click('csv');csv=await blobs.at(-1).text();assert.match(csv,/สรุปรายปีปฏิทิน/);assert.match(csv,/FULL-FLOW-001/);
  await click('print');assert.match(printed,/สรุปรายปีปฏิทิน/);
 }finally{controller?.destroy();global.window=previous.window;global.document=previous.document;global.fetch=previous.fetch;global.setTimeout=previous.setTimeout;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;dom.window.close();}
});

test('salary letters persist snapshots across devices, allocate unique numbers and remain private to their account',async()=>{
 const {createSalaryIssuer}=await import('../salary-certificate-firestore.mjs');
 const {createContent,sourceStamp}=await import('../salary-certificate-core.mjs');
 const {demoCompany,demoEmployees,demoDraft}=await import('../salary-certificate-demo-data.mjs');
 const uid='salary-owner',db=env.authenticatedContext(uid).firestore(),root='artifacts/default-app-id/users/'+uid+'/';
 const company=structuredClone(demoCompany),employees=structuredClone(demoEmployees),draft={...demoDraft('2026-11-02'),reviewed:true};
 await setDoc(doc(db,root+'settings/companyProfile'),company);
 for(const e of employees)await setDoc(doc(db,root+'employees/'+e.id),e);
 const adapter={db,runTransaction,serverTimestamp,getUserId:()=>uid,userDoc:(c,i)=>doc(db,root+c+'/'+i),today:()=> '2026-11-02',getActor:()=>({name:'ผู้ทดสอบ'})};
 const issue=createSalaryIssuer(adapter),sources={company,employees,today:'2026-11-02'};
 const request=id=>({id,uid,draft,content:createContent(draft,sources),sourceStamp:sourceStamp(sources,draft)});
 const [one,two]=await Promise.all([issue(request('salary-test-0001')),issue(request('salary-test-0002'))]);
 assert.deepEqual([one.number,two.number].sort(),['NASC-2569-0001','NASC-2569-0002']);
 assert.equal((await issue(request('salary-test-0001'))).number,one.number);
 const second=env.authenticatedContext(uid).firestore(),other=env.authenticatedContext('salary-other').firestore();
 const ref=doc(second,root+'hr_salary_certificates/salary-test-0001');
 await setDoc(doc(db,root+'employees/'+employees[0].id),{...employees[0],salary:99999,name:'ข้อมูลใหม่'});
 const saved=(await getDocFromServer(ref)).data();assert.equal(saved.content.baseSatang,3000000);assert.equal(saved.content.employee.name,'พนักงานตัวอย่าง A');
 await assertFails(getDocFromServer(doc(other,ref.path)));await assertFails(setDoc(doc(other,ref.path),{changed:true}));
 await assertFails(getDocFromServer(doc(env.unauthenticatedContext().firestore(),ref.path)));
 await assert.rejects(issue(request('salary-test-0003')),/เปลี่ยนแล้ว/);
 assert.equal((await getDocs(collection(db,root+'hr_salary_certificates'))).size,2);
});
