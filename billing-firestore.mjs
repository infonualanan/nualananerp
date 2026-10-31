import {buildBill,prepareBatch,clone,ensure,text,sourceDate} from './billing-core.mjs';
import {operationFingerprint,referenceKey,referenceAlreadyUsed} from './accounting-common.mjs';
import {validDate} from './payments-core.mjs';
const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length;
export function createBillingStore(api){
 const scope=()=>{
  const uid=api.getUserId();ensure(uid,'กรุณาเข้าสู่ระบบก่อน');const check=()=>ensure(api.getUserId()===uid,'บัญชีผู้ใช้เปลี่ยน กรุณาเปิดงานบัญชีใหม่');
  return {uid,check,ref:(c,id)=>{check();ensure(typeof id==='string'&&id&&!id.includes('/')&&id.length<=200,'รหัสเอกสารไม่ถูกต้อง');return api.userDoc(c,id);}};
 };
 async function load(){
  const s=scope(),ref=s.ref('settings','accounting-revision');
  for(let attempt=0;attempt<3;attempt++){
   const first=await api.getDocFromServer(ref);s.check();const revision=first.exists()?first.data().revision||0:0;
   const [documents,batches,events]=await Promise.all([api.readServerDocuments(),api.readCollection('accounting_batches'),api.readCollection('accounting_events')]);s.check();
   const last=await api.getDocFromServer(ref);s.check();
   if((last.exists()?last.data().revision||0:0)===revision)return {documents,batches,events,revision};
  }throw new Error('ข้อมูลบัญชีเปลี่ยนระหว่างโหลด กรุณาอัปเดตข้อมูลอีกครั้ง');
 }
 async function commit(originalAction){
  const s=scope(),today=api.today(),action={...originalAction,actor:{uid:s.uid,name:api.getActor?.().name||s.uid}};
  ensure(/^[a-zA-Z0-9-]{12,70}$/.test(action.requestId||''),'เลขรายการไม่ถูกต้อง');
  ensure(['bill','cancel','payment'].includes(action.kind),'ประเภทงานบัญชีไม่ถูกต้อง');
  if(action.kind==='payment')ensure(validDate(action.input?.date)&&action.input.date<=today,'วันที่รับเงินไม่ถูกต้อง');
  ensure(bytes(action.input||{})<150000,'มีรายการมากเกินไป กรุณาแบ่งเอกสาร');
  const fingerprint=await operationFingerprint(action);s.check();
  const preflight=await api.readServerDocuments();s.check();
  const refId=action.kind==='payment'?await referenceKey(action.input.reference):null;s.check();
  const requestRef=s.ref('accounting_requests',action.requestId),metaRef=s.ref('settings','accounting-revision');
  return api.runTransaction(api.db,async tx=>{
   const req=await tx.get(requestRef);s.check();
   if(req.exists()){ensure(req.data().fingerprint===fingerprint,'เลขรายการถูกใช้กับข้อมูลอื่นแล้ว กรุณาเปิดรายการใหม่');return {...req.data().result,replayed:true};}
   const metaSnap=await tx.get(metaRef);s.check();const revision=metaSnap.exists()?metaSnap.data().revision||0:0;
   ensure(action.expectedRevision===revision,'ข้อมูลบัญชีเปลี่ยน กรุณาอัปเดตและตรวจรายการใหม่');
   const counterRef=s.ref('settings','accounting-sequence-'+(action.kind==='payment'?action.input.date:today).slice(0,4)),counterSnap=await tx.get(counterRef);s.check();
   const counter=counterSnap.exists()?counterSnap.data():{},updatedCounter={...counter},numbers={};
   let old=null;
   const oldNo=action.kind==='cancel'?action.input.billNo:action.input.replaces;
   if(oldNo){const snap=await tx.get(s.ref('documents',oldNo));s.check();ensure(snap.exists(),'ไม่พบใบวางบิลต้นฉบับ');old={...snap.data()};ensure(old.billingManaged?.kind==='bill'&&old.billingManaged.state==='issued','ใบวางบิลเปลี่ยนสถานะแล้ว');}
   const requested=action.kind==='cancel'?[]:action.input.rows||[];
   ensure(requested.length<=30,'เลือกได้ไม่เกิน 30 ใบ');
   const ids=[...new Set([...requested.flatMap(r=>[r.rootNo,r.invoiceNo]),...(old?.billingManaged.rootNos||[])])];
   const latest=[];
   for(const id of ids){const snap=await tx.get(s.ref('documents',id));s.check();ensure(snap.exists(),'ไม่พบเอกสาร '+id);const d=snap.data();ensure(d.docNo===id,'รหัสต้นทางไม่ตรง');latest.push(d);}
   const documents=preflight.filter(d=>!latest.some(r=>r.docNo===d.docNo)&&d.docNo!==oldNo).concat(latest,old?[old]:[]);
   let receivingRef=null;
   if(action.kind==='payment'){
    receivingRef=s.ref('settings',refId);const refSnap=await tx.get(receivingRef);s.check();
    ensure(!refSnap.exists()&&!referenceAlreadyUsed(documents,action.input.reference),'เลขอ้างอิงรับเงินนี้ใช้แล้ว กรุณาตรวจรายการซ้ำ');
   }
   async function next(prefix,collection,series='B',externalCounter=null){
    const current=externalCounter||updatedCounter;let n=Number(current[prefix]||0);
    ensure(Number.isSafeInteger(n)&&n>=0,'เลขลำดับเอกสารไม่ถูกต้อง');
    for(let attempt=0;attempt<6;attempt++){
     n++;const no=prefix+'-'+(action.kind==='payment'?action.input.date:today).slice(0,4)+'-'+series+String(n).padStart(6,'0');
     const snap=await tx.get(s.ref(collection,no));s.check();
     if(!snap.exists()){current[prefix]=n;return no;}
    }throw new Error('เลขเอกสารซ้ำ กรุณาตรวจเลขลำดับ');
   }
   const rootsToUpdate=new Map(),out=[],writes=[],result={docNos:[],revision:revision+1};
   let event,financialCounterRef=null,financialCounter=null,batch=null;
   if(action.kind==='bill'){
    const no=await next('BL','documents'),issued=buildBill(action,documents,today,no);
    if(old){
     old={...old,status:'superseded',billingManaged:{...old.billingManaged,state:'superseded',replacedBy:no,reason:issued.billingManaged.reason,changedBy:action.actor,changedOn:today}};
     out.push(old);
     for(const rootNo of old.billingManaged.rootNos){const r=latest.find(d=>d.docNo===rootNo);ensure(r?.billingLock?.billNo===old.docNo,'ยอดจองใบวางบิลต้นฉบับไม่ตรง');rootsToUpdate.set(rootNo,{billingLock:null,billingRevision:(r.billingRevision||0)+1});}
    }
    for(const row of issued.billingRows){const r=latest.find(d=>d.docNo===row.rootNo);rootsToUpdate.set(row.rootNo,{billingLock:{billNo:no,invoiceNo:row.invoiceNo},billingRevision:(r.billingRevision||0)+1});}
    out.push(issued);result.docNos=[no];
    event={kind:old?'replace-bill':'issue-bill',documentNo:no,previousNo:old?.docNo||'',partyKey:issued.billingManaged.partyKey,customerName:issued.customerName,amountCents:Math.round(issued.grandTotal*100),reason:issued.billingManaged.reason,rootNos:issued.billingManaged.rootNos};
   }else if(action.kind==='cancel'){
    const reason=text(action.input.reason,'เหตุผลยกเลิก',240);ensure(reason.length>=3,'ระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
    ensure((old.billingManaged.revision||0)===(action.input.billRevision||0),'ใบวางบิลเปลี่ยนแปลงแล้ว');
    for(const rootNo of old.billingManaged.rootNos){const r=latest.find(d=>d.docNo===rootNo);ensure(r?.billingLock?.billNo===old.docNo,'ยอดจองใบวางบิลไม่ตรง');rootsToUpdate.set(rootNo,{billingLock:null,billingRevision:(r.billingRevision||0)+1});}
    old={...old,status:'cancelled',billingManaged:{...old.billingManaged,state:'cancelled',reason,changedBy:action.actor,changedOn:today,revision:(old.billingManaged.revision||0)+1}};
    out.push(old);result.docNos=[old.docNo];
    event={kind:'cancel-bill',documentNo:old.docNo,partyKey:old.billingManaged.partyKey,customerName:old.customerName,amountCents:0,reason,rootNos:old.billingManaged.rootNos};
   }else{
    ensure(/^\d{4}-\d{2}-\d{2}$/.test(action.input.date||''),'วันที่รับเงินไม่ถูกต้อง');
    const preview=prepareBatch(action,documents,today),year=action.input.date.slice(0,4);
    financialCounterRef=s.ref('settings','payment-sequence-'+year);const snap=await tx.get(financialCounterRef);s.check();financialCounter=snap.exists()?{...snap.data()}:{};
    numbers.batchId=await next('RCB','accounting_batches');
    for(const prefix of new Set(preview.documents.map(d=>d.prefix)))numbers[prefix]=await next(prefix,'documents','P',financialCounter);
    const prepared=prepareBatch(action,documents,today,numbers);batch=prepared.batch;out.push(...prepared.documents);
    for(const r of prepared.roots)rootsToUpdate.set(r.docNo,{paymentLedger:r.paymentLedger,isRevenue:r.isRevenue,status:r.status,paymentUpdatedAt:api.serverTimestamp()});
    writes.push(['accounting_batches',batch.id,batch]);result.docNos=prepared.documents.map(d=>d.docNo);result.batchId=batch.id;
    event={kind:'receive-batch',documentNo:batch.id,partyKey:batch.partyKey,customerName:batch.customerName,amountCents:batch.amountCents,rootNos:batch.rows.map(r=>r.rootNo),reference:batch.reference,documentNos:batch.documentNos};
   }
   for(const d of out){ensure(bytes(d)<900000,'เอกสารใหญ่เกินไป กรุณาลดขนาดหลักฐานหรือแบ่งรายการ');writes.push(['documents',d.docNo,{...d,recordedBy:d.recordedBy||s.uid}]);}
   for(const [id,change]of rootsToUpdate){const original=latest.find(d=>d.docNo===id);ensure(bytes({...original,...change})<850000,'ประวัติต้นทางใหญ่เกินไป กรุณาติดต่อบัญชีเพื่อแยกงวด');}
   s.check();
   for(const [id,change]of rootsToUpdate)tx.update(s.ref('documents',id),{...change,billingUpdatedAt:api.serverTimestamp()});
   for(const [collection,id,data]of writes)tx.set(s.ref(collection,id),{...data,createdAt:out.some(d=>d.docNo===id&&d.createdAt)?data.createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()});
   if(batch)tx.set(receivingRef,{requestId:action.requestId,batchId:batch.id,fingerprint,rootNos:batch.rows.map(r=>r.rootNo),docNos:result.docNos,reference:batch.reference,date:batch.date,amountCents:batch.amountCents,recordedBy:s.uid});
   if(financialCounterRef)tx.set(financialCounterRef,financialCounter,{merge:true});
   tx.set(counterRef,updatedCounter,{merge:true});
   tx.set(s.ref('accounting_events',action.requestId),{...event,actor:action.actor,date:today,createdAt:api.serverTimestamp(),sequence:revision+1});
   tx.set(metaRef,{revision:revision+1,updatedAt:api.serverTimestamp()});
   tx.set(requestRef,{fingerprint,result,createdAt:api.serverTimestamp(),recordedBy:s.uid});
   return {...result,documents:out,rootChanges:[...rootsToUpdate].map(([docNo,change])=>({docNo,...change}))};
  });
 }
 return {load,commit};
}
