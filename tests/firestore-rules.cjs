const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,collection,getDocFromServer,getDocs,setDoc,runTransaction,serverTimestamp,Bytes}=require('firebase/firestore');
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
test('actual SDK persists original bytes atomically and a second authenticated device restores them',async()=>{
 const {createVaultStore}=await import('../vault-firestore.mjs'),{sha256}=await import('../vault-core.mjs'),{draft}=require('./vault-fixture.cjs');
 const bytes=new Uint8Array(fs.readFileSync(path.join(__dirname,'../assets/ocr-connection-test.png'))),id=await sha256(bytes);
 const adapter=uid=>{const db=env.authenticatedContext(uid).firestore();return createVaultStore({db,runTransaction,serverTimestamp,getDocFromServer,toBytes:Bytes.fromUint8Array,getUserId:()=>uid,userDoc:(c,i)=>doc(db,'artifacts','default-app-id','users',uid,c,i),getCompany:()=>({nameTh:'ตัวอย่าง',taxId:'0105550000001',branch:'00000'}),getActor:()=>({name:'ทดสอบ'}),today:()=> '2026-11-01'});};
 const first=adapter('owner'),second=adapter('owner');await first.save({id,bytes,mimeType:'image/png',filename:'original.png',status:'reviewed',data:draft(),expectedRevision:0});
 const restored=await second.original({id});assert.deepEqual(restored.bytes,bytes);assert.equal(restored.filename,'original.png');
 const other=env.authenticatedContext('other').firestore();await assertFails(getDocFromServer(doc(other,'artifacts','default-app-id','users','owner','accounting_vault',id)));
 const legacy=doc(env.authenticatedContext('owner').firestore(),'artifacts','default-app-id','users','owner','documents','old-document');await assertSucceeds(setDoc(legacy,{docNo:'old-document',grandTotal:60000}));assert.equal((await getDocFromServer(legacy)).data().grandTotal,60000);
});
