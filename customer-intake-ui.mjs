import {CUSTOMER_FIELDS,MAX_CUSTOMER_TEXT,normalizeCustomerExtraction,customerFillPlan} from './customer-intake-core.mjs';
import {MAX_IMAGE_BYTES,matchesFileType} from './file-limits.mjs';
const F=Object.keys(CUSTOMER_FIELDS);
const pictureTypes=['image/jpeg','image/png','image/webp'];
export async function prepareCustomerImage(file){
 if(!pictureTypes.includes(file.type))throw new Error('ใช้ภาพ JPG PNG หรือ WEBP เท่านั้น');
 if(!file.size||file.size>10000000)throw new Error('ภาพต้นฉบับต้องไม่เกิน 10 MB');
 const bytes=new Uint8Array(await file.arrayBuffer());if(!matchesFileType(bytes,file.type))throw new Error('ชนิดภาพไม่ตรงกับไฟล์ที่แนบ');
 let blob=file,resized=false;
 if(file.size>MAX_IMAGE_BYTES){
  const url=URL.createObjectURL(file),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('เปิดภาพนี้ไม่สำเร็จ'));img.src=url;});
   if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>60000000)throw new Error('ภาพมีความละเอียดสูงเกินไป กรุณาครอปเฉพาะข้อมูลบริษัท');
   const canvas=document.createElement('canvas'),scale=Math.min(1,2600/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const context=canvas.getContext('2d');if(!context)throw new Error('อุปกรณ์นี้ย่อภาพไม่ได้ กรุณาใช้ภาพไม่เกิน 2.5 MB');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
   for(const quality of [.9,.8,.68]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=MAX_IMAGE_BYTES)break;}
   if(!blob||blob.size>MAX_IMAGE_BYTES)throw new Error('ภาพยังใหญ่เกิน 2.5 MB กรุณาครอปเฉพาะข้อมูลบริษัท');resized=true;
  }finally{URL.revokeObjectURL(url);}
 }
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('อ่านไฟล์ภาพไม่สำเร็จ'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});
 return {mimeType:blob.type,data,resized};
}
export function createCustomerIntake(root,api){
 const doc=root.ownerDocument,owner=api.getUser()?.uid,fetcher=api.fetch||fetch;
 let alive=true,epoch=0,busy=false,preparing=false,image=null,previewURL=null,extraction=null,selected=-1,abort=null,lastHash='',lastRequest='';
 root.classList.add('customer-intake');
 root.innerHTML=`<div class="customer-ai-heading"><div><strong data-ai-title>อ่านข้อมูลลูกค้าด้วย AI</strong><p data-ai-intro>แนบภาพ หรือวางข้อความ แล้วตรวจข้อมูลก่อนบันทึก</p></div><span class="customer-ai-badge">AI</span></div><label class="customer-ai-label"><span data-ai-source-label>วางข้อความ / กด Ctrl+V เพื่อวางภาพ</span><textarea data-ai-text rows="4" maxlength="${MAX_CUSTOMER_TEXT}" placeholder="ชื่อบริษัท ที่อยู่ เลขผู้เสียภาษี โทรศัพท์…"></textarea></label><div class="customer-ai-tools"><label class="customer-ai-file"><span data-ai-attach>แนบภาพ</span><input data-ai-file type="file" accept="image/jpeg,image/png,image/webp" aria-label="แนบภาพข้อมูลบริษัท"></label><button type="button" data-ai-clear>ล้างต้นฉบับ</button><button type="button" data-ai-read class="customer-ai-primary">อ่านและกรอกด้วย AI</button></div><div data-ai-preview hidden><img data-ai-image alt="ต้นฉบับข้อมูลลูกค้า"><div class="customer-ai-file-info"><span data-ai-filename></span><button type="button" data-ai-remove>เอาภาพออก</button></div></div><p class="customer-ai-help" data-ai-privacy>JPG / PNG / WEBP ไม่เกิน 10 MB · ส่งเฉพาะภาพ/ข้อความที่เลือกให้ AI ของระบบอ่าน ไฟล์ใช้ชั่วคราวในหน้านี้</p><p class="customer-ai-status" data-ai-status role="status" aria-live="polite"></p><div data-ai-result hidden><label class="customer-ai-label" data-ai-choice-label><span data-ai-choice-text>เลือกบริษัทที่ต้องการ</span><select data-ai-choice></select></label><dl data-ai-fields></dl><p class="customer-ai-help" data-ai-warnings></p><div class="customer-ai-tools"><button type="button" data-ai-fill>เติมเฉพาะช่องว่าง</button><button type="button" data-ai-replace>แทนที่ด้วยข้อมูลที่อ่านได้</button></div><p class="customer-ai-review" data-ai-review>AI ยังไม่บันทึกฐานข้อมูล ตรวจต้นฉบับและแก้ช่องต่าง ๆ ก่อนกด “บันทึก” เอง</p></div>`;
 const q=s=>root.querySelector(s),status=q('[data-ai-status]'),text=q('[data-ai-text]'),fileInput=q('[data-ai-file]');
 const active=()=>alive&&api.getUser()?.uid===owner;
 const snapshot=()=>JSON.stringify(api.getForm());
 const pristine=()=>F.every(key=>!String(api.getForm()[key]||'').trim()||(key==='branch'&&api.getForm()[key]==='สำนักงานใหญ่'));
 function notice(value,isError=false){status.textContent=value;status.classList.toggle('is-error',isError);}
 function controls(){const blocked=busy||preparing||api.isSaving?.()||api.isEditing?.();q('[data-ai-read]').disabled=!!blocked;q('[data-ai-read]').textContent=busy?'กำลังอ่าน…':'อ่านและกรอกด้วย AI';q('[data-ai-fill]').disabled=!!blocked||selected<0;q('[data-ai-replace]').disabled=!!blocked||selected<0;root.setAttribute('aria-busy',String(busy||preparing));}
 function clearResult(){extraction=null;selected=-1;q('[data-ai-result]').hidden=true;q('[data-ai-fields]').replaceChildren();q('[data-ai-warnings]').textContent='';}
 function invalidate(){epoch++;abort?.abort();abort=null;busy=false;preparing=false;clearResult();controls();}
 function releaseImage(){if(previewURL){(api.revokeObjectURL||URL.revokeObjectURL)(previewURL);previewURL=null;}image=null;q('[data-ai-image]').removeAttribute('src');q('[data-ai-preview]').hidden=true;fileInput.value='';}
 function reset(){invalidate();releaseImage();text.value='';lastHash='';lastRequest='';notice('');}
 async function chooseFile(file){
  if(!active()||api.isEditing?.()||api.isSaving?.())return;
  invalidate();releaseImage();const job=epoch;preparing=true;controls();notice('กำลังเตรียมภาพ…');
  try{const encoded=await (api.prepareImage||prepareCustomerImage)(file);if(!active()||epoch!==job)return;
   releaseImage();image=encoded;previewURL=(api.createObjectURL||URL.createObjectURL)(file);q('[data-ai-image]').src=previewURL;q('[data-ai-filename]').textContent=file.name||'ภาพที่วางจากคลิปบอร์ด';q('[data-ai-preview]').hidden=false;notice(encoded.resized?'ย่อภาพเพื่อส่ง AI แล้ว โปรดตรวจเลขเล็กกับต้นฉบับก่อนบันทึก':'แนบภาพแล้ว กดอ่านและกรอกด้วย AI');
  }catch(error){if(active()&&epoch===job)notice(error.message,true);}finally{if(active()&&epoch===job){preparing=false;controls();}}
 }
 function renderResult(){
  q('[data-ai-result]').hidden=!extraction?.candidates.length;if(!extraction)return;
  const choice=q('[data-ai-choice]');choice.replaceChildren();const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='— เลือกบริษัทที่ต้องการ —';choice.append(placeholder);
  const roles={buyer:'ผู้ซื้อ',seller:'ผู้ขาย',company:'บริษัท',unknown:'ไม่ระบุบทบาท'};
  extraction.candidates.forEach((candidate,i)=>{const option=doc.createElement('option');option.value=String(i);option.textContent=(candidate.name||'ยังอ่านชื่อไม่ชัด')+' · '+roles[candidate.role];choice.append(option);});
  choice.value=selected<0?'':String(selected);q('[data-ai-choice-label]').hidden=extraction.candidates.length<2;
  const target=q('[data-ai-fields]');target.replaceChildren();const candidate=extraction.candidates[selected];
  if(candidate){for(const [key,meta] of Object.entries(CUSTOMER_FIELDS)){const dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=meta.label;dd.textContent=candidate[key]||'ไม่พบ / ไม่ชัด';if(!candidate[key])dd.className='customer-ai-missing';target.append(dt,dd);}
   q('[data-ai-warnings]').textContent=[...extraction.warnings,...candidate.warnings,'ข้อมูลนี้เป็นผลอ่าน ยังไม่ได้ตรวจยืนยันกับทะเบียนทางการ'].join(' · ');
  }else q('[data-ai-warnings]').textContent='พบหลายบริษัท จึงยังไม่กรอกข้อมูล กรุณาเลือกบริษัทที่ต้องการก่อน';controls();
 }
 function apply(mode='empty'){
  if(!active()||api.isSaving?.()||api.isEditing?.()||busy)return false;
  const candidate=extraction?.candidates[selected];if(!candidate)return false;
  const plan=customerFillPlan(api.getForm(),candidate,mode,pristine());
  api.applyFields(plan.updates);api.onApplied?.();
  const count=Object.keys(plan.updates).length;
  notice((count?'ใส่ข้อมูล '+count+' ช่องแล้ว':'ไม่มีช่องว่างให้เติม')+(plan.kept.length?' · เก็บข้อมูลที่คุณพิมพ์ไว้ '+plan.kept.length+' ช่อง':'')+' · กรุณาตรวจก่อนกดบันทึกเอง');
  return true;
 }
 async function read(){
  if(!active()||busy||preparing||api.isSaving?.()||api.isEditing?.())return;
  const sourceText=text.value.trim();if(!sourceText&&!image){notice('แนบภาพหรือวางข้อความบริษัทก่อนอ่าน',true);return;}
  if(sourceText.length>MAX_CUSTOMER_TEXT){notice('ข้อความต้องไม่เกิน 16,000 ตัวอักษร',true);return;}
  const source={text:sourceText,...(image?{image:{mimeType:image.mimeType,data:image.data}}:{})},baseline=snapshot(),wasPristine=pristine(),job=++epoch;
  busy=true;clearResult();controls();notice('กำลังให้ AI อ่านข้อมูล… ยังไม่บันทึกฐานข้อมูล');const operationAbort=new AbortController();abort=operationAbort;const timeout=setTimeout(()=>operationAbort.abort(),65000);
  try{
   const sourceBytes=new TextEncoder().encode(JSON.stringify(source)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sourceBytes)),x=>x.toString(16).padStart(2,'0')).join('');
   if(!active()||job!==epoch)return;if(hash!==lastHash){lastHash=hash;lastRequest=crypto.randomUUID();}
   const token=await api.getUser().getIdToken();if(!active()||job!==epoch)return;
   const response=await fetcher('/api/customer-read',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...source,requestId:lastRequest}),signal:operationAbort.signal});
   let value;try{value=await response.json();}catch{throw new Error('บริการอ่านข้อมูลตอบกลับไม่สมบูรณ์ กรุณาลองใหม่');}
   if(!active()||job!==epoch)return;if(!response.ok)throw new Error(value.error||'อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่');
   extraction=normalizeCustomerExtraction(value.extraction);selected=extraction.candidates.length===1?0:-1;busy=false;controls();renderResult();
   if(!extraction.readable||!extraction.candidates.length){notice('ยังไม่พบข้อมูลบริษัทที่อ่านได้ กรุณาแนบภาพชัดขึ้นหรือวางข้อความเฉพาะส่วนบริษัท',true);return;}
   if(extraction.candidates.length>1){notice('พบหลายบริษัท กรุณาเลือกบริษัทที่ต้องการก่อนใส่ข้อมูล');return;}
   if(wasPristine&&snapshot()===baseline)apply('empty');
   else notice('อ่านข้อมูลแล้ว และเก็บข้อมูลที่คุณพิมพ์ไว้ กรุณาเลือกเติมช่องว่างหรือแทนที่ด้านล่าง');
  }catch(error){if(active()&&job===epoch)notice(error.name==='AbortError'?'อ่านนานเกินไป กรุณาลองใหม่ ต้นฉบับยังอยู่':error.message,true);}
  finally{clearTimeout(timeout);if(active()&&job===epoch){busy=false;abort=null;controls();}}
 }
 function onClick(event){if(event.target.closest('[data-ai-read]'))read();else if(event.target.closest('[data-ai-clear]'))reset();else if(event.target.closest('[data-ai-remove]')){invalidate();releaseImage();notice('เอาภาพออกแล้ว');}else if(event.target.closest('[data-ai-fill]'))apply('empty');else if(event.target.closest('[data-ai-replace]'))apply('replace');}
 function onInput(event){if(event.target===text){invalidate();notice('');}}
 function onChange(event){if(event.target===fileInput){if(event.target.files.length>1){notice('แนบครั้งละ 1 ภาพ',true);return;}if(event.target.files[0])chooseFile(event.target.files[0]);}else if(event.target===q('[data-ai-choice]')){selected=event.target.value===''?-1:Number(event.target.value);renderResult();if(selected>=0&&pristine())apply('empty');}}
 function onPaste(event){const files=Array.from(event.clipboardData?.items||[]).filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);if(!files.length)return;event.preventDefault();if(files.length!==1){notice('วางครั้งละ 1 ภาพ',true);return;}chooseFile(files[0]);}
 function onDrop(event){event.preventDefault();if(event.dataTransfer.files?.length!==1){notice('แนบครั้งละ 1 ภาพ',true);return;}chooseFile(event.dataTransfer.files[0]);}
 const dragover=event=>event.preventDefault();root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('paste',onPaste);root.addEventListener('drop',onDrop);root.addEventListener('dragover',dragover);
 function refresh(){root.hidden=!!api.isEditing?.();controls();}
 refresh();return {refresh,reset,get busy(){return busy;},destroy(){if(!alive)return;reset();alive=false;root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('paste',onPaste);root.removeEventListener('drop',onDrop);root.removeEventListener('dragover',dragover);root.replaceChildren();}};
}
