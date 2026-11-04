import {FACTORY_COLLECTIONS,factoryUsedItems,readRefs,applyFactoryAction,ensure} from './factory-core.mjs';
const encoder=new TextEncoder();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export async function actionFingerprint(action){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(canonical({kind:action.kind,input:action.input||{}}))));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createFactoryStore(api){
 const scope=()=>{const uid=api.getUserId();ensure(uid,'กรุณาเข้าสู่ระบบก่อน');
  const check=()=>ensure(api.getUserId()===uid,'บัญชีผู้ใช้เปลี่ยน กรุณาเปิดระบบโรงงานใหม่');
  return {uid,check,ref:(c,id)=>{check();return api.userDoc('factory_'+c,id);}};
 };
 async function readSnapshot(session,collections){
  const metaRef=session.ref('meta','current');
  for(let attempt=0;attempt<3;attempt++){
   const before=await api.getDocFromServer(metaRef);session.check();
   const meta=before.exists()?before.data():{revision:0,sequence:0};
   const records=await Promise.all(collections.map(async c=>{const docs=await api.readCollection('factory_'+c);session.check();return [c,docs];}));
   const after=await api.getDocFromServer(metaRef);session.check();
   if((after.exists()?after.data().revision:0)===(meta.revision||0)){
    return {data:Object.fromEntries(records),meta};
   }
  }
  throw new Error('ข้อมูลโรงงานเปลี่ยนระหว่างโหลด กรุณากดอัปเดตข้อมูลอีกครั้ง');
 }
 const load=()=>readSnapshot(scope(),FACTORY_COLLECTIONS);
 async function commit(action){
  const session=scope();ensure(/^[a-zA-Z0-9-]{8,100}$/.test(action.requestId||''),'เลขรายการไม่ถูกต้อง');
  ensure(encoder.encode(JSON.stringify(action.input||{})).length<100000,'ข้อมูลรายการมีขนาดใหญ่เกินไป');
  const fingerprint=await (api.fingerprint||actionFingerprint)(action);session.check();
  const user=api.getActor(),actor={uid:session.uid,name:user.name||session.uid,now:api.now()},today=api.today();
  const requestRef=session.ref('requests',action.requestId),metaRef=session.ref('meta','current');
  // LOTs and recipes are never removed. Every factory action advances the same revision,
  // so a matching revision inside the transaction proves this usage snapshot is still current.
  const usage=['itemEdit','itemDelete'].includes(action.kind)?await readSnapshot(session,['lots','recipes']):null;
  return api.runTransaction(api.db,async tx=>{
   const request=await tx.get(requestRef);session.check();
   if(request.exists()){const saved=request.data();ensure(saved.fingerprint===fingerprint,'เลขรายการถูกใช้กับข้อมูลอื่นแล้ว กรุณาเปิดรายการใหม่');return {replayed:true,...saved.result};}
   const metaSnap=await tx.get(metaRef);session.check();const meta=metaSnap.exists()?metaSnap.data():{revision:0,sequence:0};
   ensure((action.expectedRevision||0)===(meta.revision||0),'มีข้อมูลเปลี่ยนจากอีกเครื่อง กรุณาอัปเดตข้อมูลและตรวจจำนวนก่อนยืนยัน');
   const ctx={},read=new Set();
   if(usage){
    ensure((usage.meta.revision||0)===(meta.revision||0),'มีข้อมูลเปลี่ยนจากอีกเครื่อง กรุณาอัปเดตข้อมูลก่อนแก้ไขรายการคลัง');
    ctx.itemInUse=factoryUsedItems(usage.data).has(action.input?.itemId);
   }
   for(const phase of [0,1]){
    const refs=readRefs(action,ctx,phase);ensure(refs.length<=160,'มีรายการอ้างอิงมากเกินไป กรุณาแบ่งงาน');
    for(const [c,id]of refs){ensure(typeof id==='string'&&id&&!id.includes('/')&&encoder.encode(id).length<1500,'รหัสเอกสารไม่ถูกต้อง');const key=c+'/'+id;if(read.has(key))continue;read.add(key);const snap=await tx.get(session.ref(c,id));session.check();ctx[c]??={};ctx[c][id]=snap.exists()?{...snap.data(),id}:null;}
   }
   const result=applyFactoryAction(action,ctx,meta,actor,today);
   ensure(result.writes.length<400,'รายการเขียนมากเกินไป กรุณาแบ่งงาน');
   session.check();
   for(const write of result.writes){
    const ref=session.ref(write.collection,write.id);
    if(write.delete)tx.delete(ref);else tx.set(ref,{...write.data,updatedAt:api.serverTimestamp()});
   }
   tx.set(metaRef,{...result.meta,updatedAt:api.serverTimestamp()});
   const saved={...result.result,eventId:result.event.id,revision:result.meta.revision};
   tx.set(requestRef,{fingerprint,result:saved,recordedBy:session.uid,createdAt:api.serverTimestamp()});
   return saved;
  });
 }
 return {load,commit};
}
