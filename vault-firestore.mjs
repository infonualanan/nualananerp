import {MAX_FILE_BYTES,ensure,normalizeDraft,validation,sha256,naturalKey} from './vault-core.mjs';
const CHUNK=450000;
export function createVaultStore(api){
 function scope(){const uid=api.getUserId();ensure(uid,'กรุณาเข้าสู่ระบบ');const check=()=>ensure(api.getUserId()===uid,'บัญชีผู้ใช้เปลี่ยน กรุณาเปิดคลังใหม่');return {uid,check,ref:(c,id)=>{check();ensure(/^[a-zA-Z0-9_-]{1,180}$/.test(id),'รหัสไฟล์ไม่ถูกต้อง');return api.userDoc(c,id);}};}
 async function save(input){
  const s=scope(),data=normalizeDraft(input.data),id=input.id;ensure(/^[a-f0-9]{64}$/.test(id),'รหัสไฟล์ไม่ถูกต้อง');
  ensure(['draft','reviewed'].includes(input.status),'สถานะไม่ถูกต้อง');data.status=input.status;if(input.status==='reviewed'){const v=validation(data,{company:api.getCompany(),today:api.today()});ensure(v.errors.length===0,v.errors.join('\n'));}else{data.reviewed=false;data.taxEligible=false;}
  const bytes=input.bytes;let chunks=[];if(bytes){ensure(bytes instanceof Uint8Array&&bytes.byteLength>8&&bytes.byteLength<=MAX_FILE_BYTES,'ไฟล์ต้องไม่เกิน 2.5 MB');ensure(await sha256(bytes)===id,'ไฟล์ต้นฉบับไม่ตรงกับรหัส');s.check();for(let i=0;i<bytes.length;i+=CHUNK)chunks.push(bytes.slice(i,i+CHUNK));}
  const key=await naturalKey(data);s.check();const content={data,status:input.status,expectedRevision:input.expectedRevision||0,key,sourceAI:input.sourceAI||null};ensure(new TextEncoder().encode(JSON.stringify(content)).length<600000,'ข้อมูลเอกสารใหญ่เกินไป');
  const fingerprint=await sha256(new TextEncoder().encode(JSON.stringify(content)));s.check();const ref=s.ref('accounting_vault',id),old=await api.getDocFromServer(ref);s.check();
  const existing=old.exists()?old.data():null;if(!existing)ensure(chunks.length,'ต้องแนบไฟล์ต้นฉบับก่อนบันทึก');
  return api.runTransaction(api.db,async tx=>{
   const snap=await tx.get(ref);s.check();const prev=snap.exists()?snap.data():null;
   if(prev?.fingerprint===fingerprint)return {id,revision:prev.revision,replayed:true};
   ensure((prev?.revision||0)===(input.expectedRevision||0),'เอกสารเปลี่ยนจากอีกเครื่อง กรุณาเปิดฉบับล่าสุด');
   const newLock=key?s.ref('accounting_vault_keys',key):null,oldLock=prev?.key&&prev.key!==key?s.ref('accounting_vault_keys',prev.key):null;
   if(newLock){const lock=await tx.get(newLock);s.check();ensure(!lock.exists()||lock.data().fileId===id,'พบเลขเอกสารนี้ของผู้ขาย/สาขาเดียวกันในคลังแล้ว กรุณาตรวจรายการซ้ำ');}
   let oldLockOwned=false;if(oldLock){const lock=await tx.get(oldLock);s.check();oldLockOwned=lock.exists()&&lock.data().fileId===id;}
   const revision=(prev?.revision||0)+1,source=prev?.source||{filename:String(input.filename||'document').slice(0,160),mimeType:input.mimeType,size:bytes.byteLength,chunks:chunks.length,hash:id};
   ensure(['image/jpeg','image/png','image/webp','application/pdf'].includes(source.mimeType),'ชนิดไฟล์ไม่รองรับ');
   const c=api.getCompany(),companySnapshot={name:cleanCompany(c.nameTh||c.nameEn),taxId:cleanCompany(c.taxId),branch:cleanCompany(c.branch),address:cleanCompany(c.addressTh||c.addressEn)};
   const value={id,data,status:input.status,key,source,revision,fingerprint,sourceAI:prev?.sourceAI||input.sourceAI||null,companySnapshot,actor:{uid:s.uid,name:api.getActor?.().name||s.uid},updatedOn:new Date().toISOString(),updatedAt:api.serverTimestamp()};
   ensure(new TextEncoder().encode(JSON.stringify(value)).length<750000,'รายละเอียดรวมใหญ่เกินไป');s.check();
   if(prev)tx.set(s.ref('accounting_vault_history',id+'_'+prev.revision),prev);
   if(!prev)for(let i=0;i<chunks.length;i++)tx.set(s.ref('accounting_file_chunks',id+'_'+i),{fileId:id,index:i,bytes:api.toBytes(chunks[i])});
   if(newLock)tx.set(newLock,{fileId:id});if(oldLockOwned)tx.delete(oldLock);
   tx.set(ref,{...value,createdAt:prev?.createdAt||api.serverTimestamp()});return {id,revision};
  });
 }
 async function original(record){const s=scope(),latest=await api.getDocFromServer(s.ref('accounting_vault',record.id));s.check();ensure(latest.exists(),'ไม่พบต้นฉบับ');const source=latest.data().source;ensure(Number.isInteger(source.chunks)&&source.chunks>0&&source.chunks<=6,'ข้อมูลไฟล์ไม่สมบูรณ์');const parts=await Promise.all(Array.from({length:source.chunks},(_,i)=>api.getDocFromServer(s.ref('accounting_file_chunks',record.id+'_'+i))));s.check();ensure(parts.every(p=>p.exists()),'ส่วนหนึ่งของไฟล์ยังโหลดไม่สำเร็จ กรุณาลองใหม่');const bytes=new Uint8Array(source.size);let offset=0;for(let i=0;i<parts.length;i++){const p=parts[i].data();ensure(p.fileId===record.id&&p.index===i,'ลำดับไฟล์ไม่ถูกต้อง');const chunk=p.bytes.toUint8Array();ensure(offset+chunk.length<=bytes.length,'ขนาดไฟล์ไม่ตรง');bytes.set(chunk,offset);offset+=chunk.length;}ensure(offset===bytes.length&&await sha256(bytes)===record.id,'ไฟล์ต้นฉบับไม่สมบูรณ์');s.check();return {bytes,...source};}
 return {save,original};
}
const cleanCompany=x=>String(x||'').slice(0,1500);
