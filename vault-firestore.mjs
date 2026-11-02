import {ensure,normalizeDraft,validation,sha256,naturalKey} from './vault-core.mjs';
import {MAX_INLINE_BYTES,FILE_CHUNK_BYTES as CHUNK,MAX_FILE_CHUNKS,fileLimit,fileLimitMessage,matchesFileType} from './file-limits.mjs';
export function createVaultStore(api){
 function scope(){const uid=api.getUserId();ensure(uid,'กรุณาเข้าสู่ระบบ');const check=()=>ensure(api.getUserId()===uid,'บัญชีผู้ใช้เปลี่ยน กรุณาเปิดคลังใหม่');return {uid,check,ref:(c,id)=>{check();ensure(/^[a-zA-Z0-9_-]{1,180}$/.test(id),'รหัสไฟล์ไม่ถูกต้อง');return api.userDoc(c,id);}};}
 async function save(input){
  const s=scope(),data=normalizeDraft(input.data),id=input.id;ensure(/^[a-f0-9]{64}$/.test(id),'รหัสไฟล์ไม่ถูกต้อง');
  ensure(['draft','reviewed'].includes(input.status),'สถานะไม่ถูกต้อง');data.status=input.status;if(input.status==='reviewed'){const v=validation(data,{company:api.getCompany(),today:api.today()});ensure(v.errors.length===0,v.errors.join('\n'));}else{data.reviewed=false;data.taxEligible=false;}
  const bytes=input.bytes;let chunks=[];if(bytes){ensure(bytes instanceof Uint8Array&&bytes.byteLength>8&&bytes.byteLength<=fileLimit(input.mimeType),fileLimitMessage(input.mimeType));ensure(matchesFileType(bytes,input.mimeType),'ชนิดไฟล์ไม่ตรงกับต้นฉบับ');ensure(await sha256(bytes)===id,'ไฟล์ต้นฉบับไม่ตรงกับรหัส');s.check();for(let i=0;i<bytes.length;i+=CHUNK)chunks.push(bytes.slice(i,i+CHUNK));}
  const key=await naturalKey(data);s.check();const content={data,status:input.status,expectedRevision:input.expectedRevision||0,key,sourceAI:input.sourceAI||null};ensure(new TextEncoder().encode(JSON.stringify(content)).length<600000,'ข้อมูลเอกสารใหญ่เกินไป');
  const fingerprint=await sha256(new TextEncoder().encode(JSON.stringify(content)));s.check();const ref=s.ref('accounting_vault',id),old=await api.getDocFromServer(ref);s.check();
  const existing=old.exists()?old.data():null;if(!existing)ensure(chunks.length,'ต้องแนบไฟล์ต้นฉบับก่อนบันทึก');
  if(existing?.fingerprint===fingerprint)return {id,revision:existing.revision,replayed:true};
  const separateUpload=!existing&&bytes?.byteLength>MAX_INLINE_BYTES;
  if(separateUpload){
   ensure(typeof api.writeFileChunkBatch==='function','กรุณารีเฟรชเว็บก่อนแนบ PDF ขนาดใหญ่');
   for(let start=0;start<chunks.length;start+=4){
    s.check();const group=chunks.slice(start,start+4).map((part,j)=>({ref:s.ref('accounting_file_chunks',id+'_'+(start+j)),data:{fileId:id,index:start+j,bytes:api.toBytes(part)}}));
    await api.writeFileChunkBatch(group);s.check();input.onProgress?.('กำลังอัปโหลด PDF '+Math.round(Math.min(start+4,chunks.length)/chunks.length*100)+'%');
   }
  }
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
   if(!prev&&!separateUpload)for(let i=0;i<chunks.length;i++)tx.set(s.ref('accounting_file_chunks',id+'_'+i),{fileId:id,index:i,bytes:api.toBytes(chunks[i])});
   if(newLock)tx.set(newLock,{fileId:id});if(oldLockOwned)tx.delete(oldLock);
   tx.set(ref,{...value,createdAt:prev?.createdAt||api.serverTimestamp()});return {id,revision};
  });
 }
 async function original(record){
  const s=scope(),latest=await api.getDocFromServer(s.ref('accounting_vault',record.id));s.check();ensure(latest.exists(),'ไม่พบต้นฉบับ');const source=latest.data().source;
  ensure(source&&Number.isSafeInteger(source.size)&&source.size>8&&source.size<=fileLimit(source.mimeType)&&source.hash===record.id&&Number.isInteger(source.chunks)&&source.chunks>0&&source.chunks<=MAX_FILE_CHUNKS&&source.chunks===Math.ceil(source.size/CHUNK),'ข้อมูลไฟล์ไม่สมบูรณ์');
  const bytes=new Uint8Array(source.size);
  for(let start=0;start<source.chunks;start+=4){const parts=await Promise.all(Array.from({length:Math.min(4,source.chunks-start)},(_,j)=>api.getDocFromServer(s.ref('accounting_file_chunks',record.id+'_'+(start+j)))));s.check();
   for(let j=0;j<parts.length;j++){const snap=parts[j],index=start+j;ensure(snap.exists(),'ส่วนหนึ่งของไฟล์ยังโหลดไม่สำเร็จ กรุณาลองใหม่');const p=snap.data();ensure(p.fileId===record.id&&p.index===index,'ลำดับไฟล์ไม่ถูกต้อง');const chunk=p.bytes.toUint8Array(),expected=Math.min(CHUNK,source.size-index*CHUNK);ensure(chunk.length===expected,'ขนาดไฟล์ไม่ตรง');bytes.set(chunk,index*CHUNK);}
  }
  ensure(await sha256(bytes)===record.id&&matchesFileType(bytes,source.mimeType),'ไฟล์ต้นฉบับไม่สมบูรณ์');s.check();return {bytes,...source};
 }
 return {save,original};
}
const cleanCompany=x=>String(x||'').slice(0,1500);
