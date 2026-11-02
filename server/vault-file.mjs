import {createHash} from 'node:crypto';
import {MAX_PDF_BYTES,FILE_CHUNK_BYTES,MAX_FILE_CHUNKS,matchesFileType} from '../file-limits.mjs';

export class VaultFileError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const check=(ok,status,code,message)=>{if(!ok)throw new VaultFileError(status,code,message);};
const str=(fields,key)=>fields?.[key]?.stringValue;
const integer=(fields,key)=>{const value=fields?.[key]?.integerValue;return typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;};

export function createVaultFileLoader({fetchImpl=fetch,projectId='nualananerp-1',appId='default-app-id',origin='https://firestore.googleapis.com'}={}){
 return async({uid,token,fileId})=>{
  check(typeof uid==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(uid)&&/^[a-f0-9]{64}$/.test(fileId),400,'invalid_file_reference','รหัสไฟล์ไม่ถูกต้อง');
  const base=origin+'/v1/projects/'+encodeURIComponent(projectId)+'/databases/(default)/documents/artifacts/'+encodeURIComponent(appId)+'/users/'+encodeURIComponent(uid)+'/',signal=AbortSignal.timeout(30000);
  async function get(path,mask){
   let response;try{response=await fetchImpl(base+path+'?'+new URLSearchParams(mask.map(x=>['mask.fieldPaths',x])),{headers:{Authorization:'Bearer '+token},signal});}catch{throw new VaultFileError(503,'source_connection','โหลด PDF จากคลังยังไม่สำเร็จ กรุณาลองอีกครั้ง');}
   check(response.ok,422,'source_unavailable','ไม่พบ PDF ต้นฉบับในบัญชีนี้ กรุณาเปิดเอกสารแล้วลองอีกครั้ง');
   try{return await response.json();}catch{throw new VaultFileError(422,'invalid_source','ข้อมูลต้นฉบับไม่สมบูรณ์');}
  }
  const manifest=await get('accounting_vault/'+fileId,['source']),fields=manifest.fields?.source?.mapValue?.fields;
  const size=integer(fields,'size'),chunks=integer(fields,'chunks'),filename=str(fields,'filename');
  check(str(fields,'mimeType')==='application/pdf'&&str(fields,'hash')===fileId,415,'source_type','ต้นฉบับนี้ไม่ใช่ PDF ที่เลือก');
  check(Number.isSafeInteger(size)&&size>8&&size<=MAX_PDF_BYTES,413,'file_limit','PDF ต้องมีขนาดไม่เกิน 10 MB');
  check(Number.isInteger(chunks)&&chunks>0&&chunks<=MAX_FILE_CHUNKS&&chunks===Math.ceil(size/FILE_CHUNK_BYTES),422,'invalid_source','ข้อมูล PDF ต้นฉบับไม่สมบูรณ์');
  const bytes=Buffer.alloc(size);
  for(let start=0;start<chunks;start+=4){
   const docs=await Promise.all(Array.from({length:Math.min(4,chunks-start)},(_,j)=>get('accounting_file_chunks/'+fileId+'_'+(start+j),['fileId','index','bytes'])));
   for(let j=0;j<docs.length;j++){
    const f=docs[j].fields,index=start+j,data=f?.bytes?.bytesValue;
    check(str(f,'fileId')===fileId&&integer(f,'index')===index&&typeof data==='string'&&data.length<=Math.ceil(FILE_CHUNK_BYTES/3)*4,422,'invalid_source','ส่วนประกอบของ PDF ไม่สมบูรณ์');
    const part=Buffer.from(data,'base64'),expected=Math.min(FILE_CHUNK_BYTES,size-index*FILE_CHUNK_BYTES);
    check(part.length===expected&&part.toString('base64')===data,422,'invalid_source','ขนาดไฟล์ PDF ต้นฉบับไม่ตรง');part.copy(bytes,index*FILE_CHUNK_BYTES);
   }
  }
  check(matchesFileType(bytes,'application/pdf')&&createHash('sha256').update(bytes).digest('hex')===fileId,422,'source_hash','ไฟล์ PDF ต้นฉบับไม่ตรง กรุณาแนบใหม่');
  return {filename:typeof filename==='string'?filename:'document.pdf',mimeType:'application/pdf',data:bytes.toString('base64')};
 };
}
