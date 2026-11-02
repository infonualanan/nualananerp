export const MAX_IMAGE_BYTES=2500000;
export const MAX_PDF_BYTES=10000000;
export const MAX_INLINE_BYTES=MAX_IMAGE_BYTES;
export const FILE_CHUNK_BYTES=450000;
export const MAX_FILE_CHUNKS=Math.ceil(MAX_PDF_BYTES/FILE_CHUNK_BYTES);
export const fileLimit=mime=>mime==='application/pdf'?MAX_PDF_BYTES:['image/jpeg','image/png','image/webp'].includes(mime)?MAX_IMAGE_BYTES:0;
export const fileLimitMessage=mime=>mime==='application/pdf'?'PDF ต้องมีขนาดไม่เกิน 10 MB':'รูปภาพต้องมีขนาดไม่เกิน 2.5 MB';
export function matchesFileType(bytes,mime){
 if(!(bytes instanceof Uint8Array)||bytes.length<=8)return false;
 const starts=list=>list.every((x,i)=>bytes[i]===x);
 if(mime==='application/pdf')return starts([37,80,68,70,45]);
 if(mime==='image/png')return starts([137,80,78,71,13,10,26,10]);
 if(mime==='image/jpeg')return starts([255,216,255]);
 return mime==='image/webp'&&starts([82,73,70,70])&&[87,69,66,80].every((x,i)=>bytes[i+8]===x);
}
