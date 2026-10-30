import {createFactoryStore} from './factory-firestore.mjs';
import {emptyFactoryData,FACTORY_COLLECTIONS,PROCESS_FIELDS,VEHICLE_FIELDS,quantity,mills,day,available,allocateMaterials,applyFactoryAction,ensure} from './factory-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const thDate=d=>d?new Date(d.slice(0,10)+'T12:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok'}):'';
const qInput=n=>String(n/1000);
const KIND={RAW:'วัตถุดิบ',PACK:'บรรจุภัณฑ์',FG:'สินค้าสำเร็จรูป'};
const QA={held:'กักรอ QA',released:'ผ่าน QA',rejected:'ไม่ผ่าน / กักไว้'};
const STAGE={planned:'จองแล้ว / รอเบิก',issued:'เบิกแล้ว / กำลังผลิต',cancelled:'ยกเลิก'};
export function createFactoryController(host,api){
 const doc=host.ownerDocument,win=doc.defaultView,store=createFactoryStore(api),initialUid=api.getUserId();
 let data=emptyFactoryData(),meta={revision:0,sequence:0},loaded=false,busy=false,alive=true,stale=false,pending=null,route='order',jobId='',lotId='',docType='PC03',recipeRows=2,loadToken=0;
 let drafts={},lastResult=null,stopMeta=null,paperReady=false;
 const $=id=>host.querySelector('#'+id),today=()=>api.today(),job=()=>data.jobs.find(j=>j.id===jobId),lot=()=>data.lots.find(l=>l.id===lotId);
 const by=(c,id)=>data[c].find(r=>r.id===id),item=id=>by('items',id);
 const prefix='fx-';
 host.innerHTML='<div class="fx-header"><div><h2>งานผลิต คลัง และ QA</h2><p>ข้อมูลบัญชี ERP ปัจจุบัน · LOT และรายการรับ–จ่ายชุดเดียวกัน</p></div><button type="button" id="fx-reload">อัปเดตข้อมูล</button></div><nav class="fx-nav" aria-label="เมนูงานโรงงาน"></nav><p id="fx-message" role="status" aria-live="polite"></p><div class="fx-selection"><label>งานผลิต<select id="fx-job"></select></label><div id="fx-job-summary"></div></div><section id="fx-review" class="fx-review" hidden></section><div id="fx-page"></div>';
 const pages={setup:'รายการคลัง',recipes:'สูตรผลิต',receive:'รับเข้า / ยอดยกมา',stock:'สต๊อก / ประวัติ LOT',order:'ใบสั่งผลิต',issue:'เบิก / ชั่ง',actual:'บันทึกผลิต',incoming:'QA ตรวจรับ',quality:'QA สินค้าสำเร็จรูป',shipping:'ขนส่ง',forms:'ฟอร์มบริษัท'};
 function message(text,error=false){if(!alive)return;$('fx-message').textContent=text;$('fx-message').classList.toggle('fx-error',error);}
 const opts=(list,label,selected='')=>'<option value="">— เลือก —</option>'+list.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===selected?' selected':'')+'>'+esc(label(r))+'</option>').join('');
 function input(id,label,type='text',value='',extra=''){return '<label class="fx-label">'+esc(label)+'<input id="'+prefix+id+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'step="any" min="0" inputmode="decimal"':'')+' '+(type==='text'?'maxlength="240"':'')+' '+extra+'></label>';}
 function select(id,label,options){return '<label class="fx-label">'+esc(label)+'<select id="'+prefix+id+'">'+options+'</select></label>';}
 const choices=arr=>arr.map(([v,l])=>'<option value="'+esc(v)+'">'+esc(l)+'</option>').join('');
 const check=(id,label)=>'<label class="fx-check"><input type="checkbox" id="'+prefix+id+'"><span>'+esc(label)+'</span></label>';
 const note=(id,label)=>'<label class="fx-label fx-wide">'+esc(label)+'<textarea id="'+prefix+id+'" maxlength="240"></textarea></label>';
 const go=(view,label)=>'<button type="button" data-fx-route="'+view+'">'+esc(label)+'</button>';
 const submit=label=>'<button type="submit" class="fx-primary">'+esc(label)+'</button>';
 const val=id=>$('fx-'+id)?.value||'',checked=id=>!!$('fx-'+id)?.checked;
 function table(headers,rows){return '<div class="fx-table-wrap"><table class="fx-table"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map((c,i)=>'<td data-label="'+esc(headers[i])+'">'+c+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+headers.length+'">ยังไม่มีข้อมูล</td></tr>')+'</tbody></table></div>';}
 const form=(id,title,body,label)=>'<form id="fx-'+id+'" class="fx-box" novalidate><h3>'+esc(title)+'</h3><div class="fx-fields">'+body+'</div><div class="fx-actions">'+submit(label)+'</div></form>';
 function scopeKey(){return route+'|'+jobId+'|'+lotId;}
 function capture(){const values={};$('fx-page').querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>values[el.id]=el.type==='checkbox'?el.checked:el.value);drafts[scopeKey()]=values;}
 function restore(){for(const [id,value]of Object.entries(drafts[scopeKey()]||{})){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=value;else if(el.tagName!=='SELECT'||Array.from(el.options).some(o=>o.value===value))el.value=value;}}
 function buttons(){host.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=busy||!!pending||!loaded);$('fx-reload').disabled=busy||!!pending;const cancel=$('fx-review-cancel'),confirm=$('fx-review-confirm');if(cancel)cancel.disabled=busy;if(confirm)confirm.disabled=busy||stale;if($('fx-print-form'))$('fx-print-form').disabled=busy||stale||!!pending||!loaded||!paperReady;}
 function render(){
  if(!alive)return;
  $('fx-job').innerHTML=opts(data.jobs.filter(j=>j.stage!=='cancelled').sort((a,b)=>b.docNo.localeCompare(a.docNo)),j=>j.docNo+' · '+j.product.name,jobId);$('fx-job').value=jobId;
  const j=job();$('fx-job-summary').textContent=j?j.docNo+' · '+j.customer+' · แผน '+quantity(j.qtyMills)+' '+j.product.unit+' · '+(j.closed?'ปิดยอดวัสดุแล้ว':STAGE[j.stage]):'เลือกงานผลิต หรือสร้างใบสั่งผลิตใหม่';
  $('fx-job-summary').hidden=!j;
  host.querySelector('.fx-nav').innerHTML=Object.entries(pages).map(([id,name])=>'<button type="button" data-fx-route="'+id+'" aria-pressed="'+String(route===id)+'">'+name+'</button>').join('');
  if(!loaded){$('fx-page').innerHTML='<p class="fx-empty">กำลังโหลดข้อมูลโรงงานจาก Firebase…</p>';buttons();return;}
  const renderers={setup:setupPage,recipes:recipePage,receive:receivePage,stock:stockPage,order:orderPage,issue:issuePage,actual:actualPage,incoming:()=>inspectionPage(false),quality:()=>inspectionPage(true),shipping:shippingPage,forms:formsPage};
  $('fx-page').innerHTML=renderers[route]();restore();if(['incoming','quality'].includes(route)&&$('fx-inspect-lot'))$('fx-inspect-lot').value=lotId;if(route==='forms'){$('fx-form-type').value=docType;updateFormItems();try{generatePaper();}catch(error){$('fx-paper-host').textContent=error.message;paperReady=false;}}renderReview();buttons();
 }
 function empty(text,view,label){return '<div class="fx-empty"><p>'+esc(text)+'</p>'+go(view,label)+'</div>';}
 function setupPage(){
  let h=form('item-form','เพิ่มรายการคลัง / เชื่อมรหัสสินค้าเดิม',
   select('catalog','ดึงชื่อ รหัส และหน่วยจากฐานข้อมูลสินค้า (ถ้ามี)',opts(api.getProducts(),p=>p.code+' · '+p.name))+
   input('item-code','รหัสรายการคลัง')+input('item-name','ชื่อรายการ')+select('item-kind','ประเภท',choices([['RAW','วัตถุดิบ'],['PACK','บรรจุภัณฑ์'],['FG','สินค้าสำเร็จรูป']]))+
   input('item-unit','หน่วยคลังหลัก')+select('item-precision','ทศนิยมของหน่วย',choices([['0','จำนวนเต็ม'],['3','ทศนิยมไม่เกิน 3 ตำแหน่ง']]))+
   select('item-inspection','แบบตรวจรับ',choices([['material','วัตถุดิบ / บรรจุภัณฑ์'],['fresh','วัตถุดิบสด']]))+check('item-analysis','รายการนี้ต้องมีผลวิเคราะห์ / COA อ้างอิง'),
   'บันทึกรายการคลัง');
  h+='<p class="fx-hint">แต่ละรหัสใช้หน่วยคลังเดียว ยอดเก่าไม่ถูกนำมาตัดสต๊อกอัตโนมัติ เริ่มจากรับเข้าจริงหรือยอดยกมาที่ตรวจนับแล้ว</p>';
  return h+table(['รหัส','รายการ','ประเภท','หน่วย'],data.items.map(i=>[esc(i.code),esc(i.name),KIND[i.kind],esc(i.unit)]));
 }
 function recipePage(){
  if(!data.items.some(i=>i.kind==='FG')||!data.items.some(i=>i.kind!=='FG'))return empty('เพิ่มรายการสินค้าสำเร็จรูป และวัตถุดิบ / บรรจุภัณฑ์ก่อนบันทึกสูตร','setup','ไปเพิ่มรายการคลัง');
  let rows='';for(let n=0;n<recipeRows;n++)rows+=select('recipe-material-'+n,'วัสดุ '+(n+1),opts(data.items.filter(i=>i.kind!=='FG'),i=>i.code+' · '+i.name+' ('+i.unit+')'))+input('recipe-qty-'+n,'ปริมาณวัสดุ '+(n+1),'number');
  let h=form('recipe-form','บันทึกสูตรฉบับที่ได้รับอนุมัติ',select('recipe-product','สินค้าสำเร็จรูป',opts(data.items.filter(i=>i.kind==='FG'),i=>i.code+' · '+i.name))+input('recipe-revision','Revision สูตร')+input('recipe-output','สูตรนี้ได้ผลผลิตตามแผน','number')+input('recipe-approval','เอกสารอนุมัติสูตร / ผู้อนุมัติอ้างอิง')+rows+'<div class="fx-wide"><button type="button" id="fx-add-material">เพิ่มแถววัสดุ</button></div>'+check('recipe-PC09','งานนี้ต้องบันทึกล้าง / เตรียม PC09')+check('recipe-PC10','งานนี้ต้องบันทึกอบ PC10')+check('recipe-PC11','งานนี้ต้องบันทึกเชื่อม / คลุก PC11')+check('recipe-approved','ยืนยันว่าเป็นสูตรและ Revision ที่อนุมัติใช้งานแล้ว'),'บันทึกสูตรฉบับนี้');
  return h+table(['สินค้า','Revision','ผลผลิตอ้างอิง','เอกสารอนุมัติ'],data.recipes.map(r=>[esc(r.product.name),esc(r.revision),quantity(r.outputMills)+' '+esc(r.product.unit),esc(r.approvalReference)]));
 }
 function receivePage(){
  if(!data.items.length)return empty('ยังไม่มีรายการคลัง เริ่มจากเลือกสินค้าจริงและหน่วยก่อน','setup','เพิ่มรายการคลัง');
  return form('receive-form','รับเข้า / ตั้งยอดยกมาจากการตรวจนับ',select('receive-item','รายการ',opts(data.items,i=>i.code+' · '+i.name+' ('+i.unit+')'))+input('receive-ref','เลขใบรับภายใน (ไม่ซ้ำ)')+input('receive-lot','LOT ภายใน / รหัสติดตามรับเข้า')+input('receive-supplierlot','LOT ผู้ขาย (ถ้ามี)')+input('receive-supplier','ผู้ขาย / ที่มาของยอดยกมา')+input('receive-date','วันที่รับ / ตรวจนับ','date',today())+input('receive-qty','จำนวนจริงในหน่วยคลัง','number')+input('receive-mfg','MFG (ถ้ามี)','date')+input('receive-exp','EXP (สินค้าสำเร็จรูปต้องระบุ)','date')+check('receive-opening','รายการนี้เป็นยอดยกมาที่ตรวจนับแล้ว')+check('receive-verified','ยืนยันรับของจริง / ตรวจนับจำนวนจริงแล้ว'),'บันทึกรับเข้ากักรอ QA')+'<p class="fx-hint">รับเข้าแล้วเป็นของกัก QA ก่อนอนุมัติใช้หรือจัดส่ง LOT ผู้ขายเก็บแยกจากรหัสติดตามภายใน</p>';
 }
 function lotOptions(fgOnly=null){return opts(data.lots.filter(l=>fgOnly===null||((l.item.kind==='FG')===fgOnly)),l=>l.code+' · '+l.item.name+' · '+quantity(l.qtyMills)+' '+l.item.unit);}
 function stockPage(){
  let h=table(['รายการ / หน่วย','LOT','คงเหลือจริง','จองแล้ว','ใช้ / ส่งได้','QA'],data.lots.map(l=>[esc(l.item.name)+'<br>'+esc(l.item.unit),esc(l.code),quantity(l.qtyMills),quantity(l.reservedMills),quantity(available(l,today())),esc(l.exp&&l.exp<today()?'หมดอายุ':QA[l.qa])+'<br><button type="button" data-fx-lot="'+esc(l.id)+'">'+(l.item.kind==='FG'?'ตรวจสินค้าสำเร็จ':'ตรวจรับ')+'</button>']));
  if(!data.lots.length)return h+empty('ยังไม่มีข้อมูลรับเข้าจริง / ยอดยกมา','receive','ไปบันทึกรับเข้า');
  h+=form('adjust-form','ปรับยอดตรวจนับ / จ่ายออกพร้อมหลักฐาน',select('adjust-lot','LOT',lotOptions())+select('adjust-kind','ประเภทรายการ',choices([['adjust','ปรับเป็นยอดตรวจนับจริง'],['stockOut','จ่ายออก / คืนผู้ขาย / ทำลาย'],['quarantine','กักกัน LOT / หยุดใช้และจัดส่ง']]))+input('adjust-qty','ยอดนับใหม่ / จำนวนจ่ายออก (กักกันไม่ต้องกรอก)','number')+note('adjust-note','เหตุผลและหลักฐานอ้างอิง')+check('adjust-verified','ยืนยันตรวจนับ / จ่ายของจริงแล้ว'),'ตรวจสอบรายการ');
  if(data.shipments.length)h+=form('return-form','รับคืนจากลูกค้า',select('return-shipment','ใบส่งของ',opts(data.shipments,s=>s.reference+' · '+s.customer))+select('return-lot','LOT ที่เคยส่ง',opts(data.shipments.flatMap(s=>s.lines.map(l=>({...l,id:s.id+'|'+l.lotId}))),l=>l.code+' · คืนได้ '+quantity(l.qtyMills-l.returnedMills)+' '+l.item.unit))+input('return-date','วันที่รับคืน','date',today())+input('return-qty','จำนวนรับคืนจริง','number')+note('return-note','เหตุผลรับคืน')+check('return-verified','ยืนยันรับคืนจริงแล้ว'),'รับคืนเข้ากักรอ QA');
  return h+'<h3>ประวัติรับ–จ่าย / จอง / ตรวจ QA</h3>'+table(['วันที่','รายการ','ผู้บันทึก'],data.events.slice().sort((a,b)=>(b.sequence||0)-(a.sequence||0)).slice(0,150).map(e=>[thDate(e.date),esc(e.description),esc(e.actor.name)]));
 }
 function orderPage(){
  if(!data.recipes.length)return empty('เริ่มจากบันทึกสูตรที่อนุมัติ และรับวัตถุดิบ / บรรจุภัณฑ์เข้าคลังก่อนสร้างงาน','recipes','ไปสูตรผลิต');
  return form('order-form','สร้างใบสั่งผลิต / จองวัสดุ',select('order-recipe','สูตร / Revision',opts(data.recipes,r=>r.product.name+' · Rev.'+r.revision))+select('order-source','ดึงอ้างอิงใบสั่งขาย (ถ้ามี)',opts(api.getDocuments().filter(d=>d.prefix==='SO').map(d=>({...d,id:d.docNo})),d=>d.docNo+' · '+d.customerName))+select('order-production-type','ผลิตสำหรับ',choices([['order','ลูกค้า / ใบสั่งขาย'],['stock','ผลิตเก็บสต๊อก']]))+input('order-customer','ชื่อลูกค้า (ผลิตตามออเดอร์)')+input('order-reference','เอกสารขายอ้างอิง (ถ้ามี)')+input('order-qty','จำนวนผลิตตามแผน','number')+input('order-due','ต้องการสินค้าวันที่','date')+'<p class="fx-hint fx-wide">ยืนยันแล้วจอง LOT ที่ผ่าน QA และใช้ได้วันต้องการสินค้า ของจริงยังอยู่ในคลัง</p>','ตรวจแผนและ LOT ก่อนยืนยัน')+table(['ใบสั่งผลิต','สินค้า','เป้าหมาย','สถานะ'],data.jobs.slice().reverse().map(j=>['<button type="button" data-fx-job="'+esc(j.id)+'">'+esc(j.docNo)+'</button>',esc(j.product.name),quantity(j.qtyMills)+' '+esc(j.product.unit),esc(j.closed?'ปิดยอดแล้ว':STAGE[j.stage])]));
 }
 function needJob(){return empty('เลือกใบสั่งผลิตด้านบน หรือสร้างงานใหม่','order','ไปใบสั่งผลิต');}
 function issuePage(){
  const j=job();if(!j)return needJob();
  if(j.stage!=='planned')return table(['รายการ / LOT','จำนวนเบิกจริง','ผู้เบิก'],j.issues.map(i=>[esc(i.item.name)+' / '+esc(i.code),quantity(i.qtyMills)+' '+esc(i.item.unit),esc(i.actor.name)]))+'<div class="fx-actions">'+go('actual','ไปบันทึกผลิต')+'</div>';
  let body=input('issue-date','วันที่เบิก / ชั่งจริง','date',today());
  j.allocations.forEach((a,n)=>{const l=by('lots',a.lotId);body+=input('issue-'+n,(l?.item.name||a.itemId)+' / '+(l?.code||a.lotId)+' ('+(l?.item.unit||'')+')','number',qInput(a.qtyMills));});
  body+=note('issue-note','เหตุผลกรณีจำนวนจริงต่างจากแผน');
  return form('issue-form','เบิก / ชั่งจริงตาม LOT ที่จอง',body,'ตรวจสอบและยืนยันเบิกจริง')+form('cancel-form','ยกเลิกก่อนเบิก / คืนยอดจอง',note('cancel-note','เหตุผลยกเลิก'),'ยืนยันยกเลิกงาน');
 }
 function actualPage(){
  const j=job();if(!j)return needJob();if(j.stage!=='issued')return empty('เบิกวัสดุจริงก่อนบันทึกผลิต','issue','ไปเบิก / ชั่ง');
  let h='';
  if(!j.closed){
   const selected=drafts[scopeKey()]?.['fx-process-form-type']||'PC09';
   const fields=PROCESS_FIELDS[selected]||PROCESS_FIELDS.PC09;
   h+=form('process-form','บันทึกขั้นตอนที่ปฏิบัติจริง',select('process-form-type','แบบบันทึก',choices([['PC09','PC09 · ล้าง / เตรียม'],['PC10','PC10 · อบ'],['PC11','PC11 · เชื่อม / คลุก']]))+input('process-date','วันที่ปฏิบัติงาน','date',today())+fields.map(f=>input('process-'+f.id,f.label,f.type)).join('')+note('process-note','ผลสังเกต / รายละเอียด')+check('process-verified','ยืนยันค่าที่บันทึกจากการปฏิบัติงานจริง'),'ตรวจบันทึกกระบวนการ');
   h+=form('produce-form','รับผลผลิตจริง (บันทึกได้หลาย LOT ต่อหนึ่งงาน)',input('produce-lot','LOT ผลิตจริง')+input('produce-qty','จำนวนผลิตจริงในหน่วยสินค้า','number')+input('produce-date','วันที่รับผลผลิตจริง','date',today())+input('produce-mfg','วันที่ผลิต (MFG)','date',today())+input('produce-exp','EXP ตามสเปกที่อนุมัติ','date')+note('produce-note','เหตุผลกรณีผลผลิตรวมเกินแผน')+check('produce-verified','ตรวจนับจำนวนผลิตได้จริงแล้ว'),'รับผลผลิตเข้ารอ QA');
  }
  h+=table(['LOT ผลิต','ผลผลิตจริง','MFG / EXP'],j.batches.map(b=>[esc(b.code),quantity(b.qtyMills)+' '+esc(j.product.unit),thDate(b.mfg)+' / '+thDate(b.exp)]));
  const processes=data.processes.filter(p=>p.jobId===j.id);h+=table(['บันทึกขั้นตอน','วันที่','ผู้บันทึก'],processes.map(p=>[esc(p.form),thDate(p.date),esc(p.actor.name)]));
  if(j.batches.length&&!j.closed){let body=input('close-date','วันที่กระทบยอดวัสดุ','date',today());j.issues.forEach((i,n)=>{body+='<div class="fx-wide"><strong>'+esc(i.item.name)+' / '+esc(i.code)+' · เบิก '+quantity(i.qtyMills)+' '+esc(i.item.unit)+'</strong></div>'+input('close-used-'+n,'ใช้จริง ('+i.item.unit+')','number')+input('close-return-'+n,'คืนเข้ากัก QA ('+i.item.unit+')','number','0')+input('close-scrap-'+n,'เสียหาย / สูญเสีย ('+i.item.unit+')','number','0');});h+=form('close-form','ปิดยอดวัสดุ: ใช้ + คืน + เสียหาย = เบิก',body+note('close-note','ผลกระทบยอดวัสดุ')+check('close-verified','ตรวจสอบจำนวนใช้ คืน และสูญเสียจริงแล้ว'),'ปิดยอดวัสดุของงาน');}
  return h;
 }
 function inspectionPage(fg){
  const lots=data.lots.filter(l=>(l.item.kind==='FG')===fg&&l.qa!=='released');
  if(!lots.length)return '<p class="fx-empty">ยังไม่มี LOT '+(fg?'สินค้าสำเร็จรูป':'วัตถุดิบ / บรรจุภัณฑ์')+' รอ QA</p>';
  let selected=lots.find(l=>l.id===lotId)||lots[0];lotId=selected.id;
  let body=select('inspect-lot','LOT รอตรวจ',opts(lots,l=>l.code+' · '+l.item.name,lotId))+input('inspect-date','วันที่ตรวจจริง','date',today())+select('inspect-decision','ผลพิจารณา',choices([['held','กักไว้ / รอแก้ไข'],['released','ผ่าน / อนุมัติใช้หรือจัดส่ง'],['rejected','ไม่ผ่าน / กักไว้']]));
  if(fg)body+=check('inspect-package','บรรจุภัณฑ์ผ่านสเปก')+check('inspect-label','ฉลากถูกต้อง')+check('inspect-code','MFG / EXP / LOT ถูกต้อง')+input('inspect-sample','จำนวนสุ่มซีลจริง (จำนวนเต็ม)','number')+select('inspect-seal','ผลซีลตามเกณฑ์ที่อนุมัติ',choices([['','ยังไม่ตรวจ'],['pass','ผ่าน'],['fail','ไม่ผ่าน']]))+input('inspect-plan','อ้างอิงแผนสุ่มที่ QA อนุมัติ');
  else body+=check('inspect-clean','ความสะอาดผ่านเกณฑ์')+check('inspect-foreign','สิ่งปลอมปนผ่านเกณฑ์')+check('inspect-spec','ข้อกำหนดอื่นตามสเปกผ่าน')+check('inspect-avl','ตรวจสอบผู้ขายตาม AVL แล้ว (วัตถุดิบสด)')+input('inspect-analysis','เอกสารผลวิเคราะห์ / COA อ้างอิง');
  body+=note('inspect-note','ผลตรวจ / การแก้ไข / เหตุผล')+check('inspect-verified','ยืนยันตรวจและพิจารณาผลจริงแล้ว');
  return '<p class="fx-hint">'+esc(selected.item.name)+' · คงเหลือ '+quantity(selected.qtyMills)+' '+esc(selected.item.unit)+' · '+esc(selected.exp&&selected.exp<today()?'หมดอายุ':QA[selected.qa])+'</p>'+form('inspect-form','บันทึกผลตรวจและอนุมัติ LOT',body,'ตรวจผลก่อนยืนยัน')+table(['วันที่','LOT / ผลพิจารณา','ผลตรวจ / ผู้บันทึก'],data.inspections.filter(r=>(r.item.kind==='FG')===fg).slice().reverse().map(r=>[thDate(r.date),esc(r.lotCode)+' / '+QA[r.decision],esc(r.note)+'<br>'+esc(r.actor.name)]));
 }
 function shippingPage(){
  const j=job();if(!j)return needJob();
  const lots=data.lots.filter(l=>l.sourceJob===j.id&&l.item.kind==='FG'&&l.qtyMills>0);
  let body=input('ship-customer','ลูกค้าที่จัดส่งจริง','text',j.productionType==='stock'?'':j.customer)+input('ship-ref','เลขใบส่งของ / เลขจ่ายภายใน (ไม่ซ้ำ)')+input('ship-date','วันที่จัดส่งจริง','date',today())+input('ship-time','เวลาตรวจ / ส่ง','time')+input('ship-destination','สถานที่ส่ง')+input('ship-vehicle','ทะเบียนรถ')+input('ship-driver','พนักงานขนส่ง')+input('ship-invoice','INV อ้างอิง (ถ้ามี)');
  if(!lots.length)return empty('ยังไม่มีสินค้าสำเร็จรูปคงเหลือของงานนี้','actual','ไปบันทึกผลผลิต')+shipmentTable(j);
  lots.forEach((l,n)=>{body+=input('ship-line-'+l.id,l.code+' · ใช้ / ส่งได้ '+quantity(available(l,today()))+' '+l.item.unit+' (ไม่ส่ง LOT นี้ให้เว้นว่าง)','number');});
  body+='<h3 class="fx-wide">ตรวจเช็ครถก่อนขนส่ง</h3>'+VEHICLE_FIELDS.map(f=>select('ship-check-'+f.id,f.label,choices([['','ยังไม่ตรวจ'],['pass','ผ่าน'],['fail','ไม่ผ่าน'],['fixed','แก้ไขแล้ว / ผ่านตรวจซ้ำ']]))).join('')+note('ship-note','หมายเหตุ / รายละเอียดแก้ไข')+check('ship-verified','ยืนยันตรวจรถครบ และจ่ายสินค้าจริงตามจำนวน');
  return form('ship-form','จัดส่งจาก '+j.docNo+' / '+j.customer,body,'ตรวจและยืนยันจ่ายสินค้า')+shipmentTable(j);
 }
 const shipmentTable=j=>table(['ใบส่งของ','วันที่','จำนวน / LOT'],data.shipments.filter(s=>s.jobId===j.id).map(s=>[esc(s.reference),thDate(s.date),s.lines.map(l=>quantity(l.qtyMills)+' '+esc(l.item.unit)+' / '+esc(l.code)).join('<br>')]));
 const formOptions=[['PC03','FM-PC-03 · ใบสั่งผลิต'],['PC04','FM-PC-04 · ชั่งวัตถุดิบ'],['PC02','FM-PC-02 · รับ–จ่ายสินค้าสำเร็จรูป'],['RM03','FM-RM-03 · รับ–จ่ายวัตถุดิบ / บรรจุภัณฑ์'],['PC09','FM-PC-09 · ล้าง / เตรียม'],['PC10','FM-PC-10 · อบ'],['PC11','FM-PC-11 · เชื่อม / คลุก'],['TS01','FM-TS-01 · ขนส่ง'],['QA','ทะเบียนผลตรวจ QA']];
 function formsPage(){
  return '<div class="fx-doc-controls fx-fields">'+select('form-type','แบบฟอร์ม',choices(formOptions))+select('form-item','รายการสำหรับ Stock Card',opts(data.items,i=>i.code+' · '+i.name))+input('form-start','ตั้งแต่วันที่','date',today().slice(0,7)+'-01')+input('form-end','ถึงวันที่','date',today())+'<div class="fx-actions"><button type="button" id="fx-generate-form">ดึงข้อมูลลงฟอร์ม</button><button type="button" id="fx-print-form">พิมพ์ / บันทึก PDF</button></div></div><p class="fx-hint">ข้อมูลจากรายการที่บันทึกแล้ว ผลทวนสอบและลายเซ็นเว้นให้ผู้รับผิดชอบจริง รูปแบบ QA เป็นทะเบียนแนบก่อนยืนยันแม่แบบ PC07/08</p><div id="fx-paper-host"></div>';
 }
 function updateFormItems(){const selected=val('form-item'),list=data.items.filter(i=>docType==='PC02'?i.kind==='FG':docType==='RM03'?i.kind!=='FG':true);$('fx-form-item').innerHTML=opts(list,i=>i.code+' · '+i.name,list.some(i=>i.id===selected)?selected:'');}
 function generatePaper(){const start=day(val('form-start')),end=day(val('form-end'));ensure(start<=end&&end<=today(),'ตรวจช่วงวันที่รายงาน (ถึงวันที่ไม่เกินวันนี้)');docType=val('form-type');$('fx-paper-host').innerHTML=paperFor(docType,{start,end,itemId:val('form-item')});paperReady=!!$('fx-paper-host').querySelector('.fx-paper');}
 function paper(title,headers,rows,footer,metaText='',landscape=false){
  return '<article class="fx-paper" data-landscape="'+landscape+'"><header><img src="'+esc(api.getCompany().logo||'./factory-logo.png')+'" alt="โลโก้บริษัท"><h3>'+esc(title)+'</h3></header><div class="fx-paper-meta">'+esc(metaText)+'</div>'+table(headers,rows)+'<p class="fx-sign">ผู้ทวนสอบ ................................ วันที่ ........................</p><footer>'+esc(footer)+'</footer></article>';
 }
 function paperFor(type,filter){
  const j=job(),stamp=today(),stampFooter=n=>'FM-PC-'+n+' Rev.00-01/01/69';
  if(type==='PC03')return paper('ใบสั่งผลิตประจำวัน',['วันที่','รายการ','จำนวนที่ต้องการ','ต้องการสินค้าวันที่','ผู้บันทึก','ชื่อลูกค้า'],(j?[j]:data.jobs).map(r=>[thDate(r.date),esc(r.product.name),quantity(r.qtyMills)+' '+esc(r.product.unit),thDate(r.dueDate),esc(r.createdBy.name),esc(r.customer)]),stampFooter('03'),j?.docNo||'',true);
  if(type==='PC04')return paper('รายงานการชั่ง-ผสมวัตถุดิบ',['วันที่ชั่ง','ชื่อสินค้า','ชื่อวัตถุดิบที่ใช้','วันที่รับเข้า','น้ำหนัก/จำนวน','ผู้บันทึก'],(j?.issues||[]).filter(r=>r.item.kind==='RAW').map(r=>[thDate(r.date),esc(j.product.name),esc(r.item.name)+' / LOT '+esc(r.code),thDate(r.received),quantity(r.qtyMills)+' '+esc(r.item.unit),esc(r.actor.name)]),stampFooter('04'),j?.docNo||'');
  if(type==='PC02'||type==='RM03'){
   const i=item(filter.itemId);if(!i)return '<p class="fx-empty">เลือกรายการคลังและช่วงวันที่ แล้วกดดึงข้อมูล</p>';
   const events=data.events.flatMap(e=>(e.physical||[]).filter(p=>p.itemId===i.id).map(p=>({...p,date:e.date,sequence:e.sequence||0,kind:e.kind,description:e.description,actor:e.actor}))).sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence);
   let balance=events.filter(e=>e.date<filter.start).reduce((n,e)=>n+e.inMills-e.outMills,0),rows=[['ยอดยกมา','','','',quantity(balance),'','']];
   for(const e of events.filter(e=>e.date>=filter.start&&e.date<=filter.end)){balance+=e.inMills-e.outMills;const inDate=e.inMills?(e.kind==='adjust'?'ปรับยอด':thDate(e.date)):'',outDate=e.outMills?(e.kind==='adjust'?'ปรับยอด':thDate(e.date)):'';rows.push([inDate,e.inMills?quantity(e.inMills):'',outDate,e.outMills?quantity(e.outMills):'',quantity(balance),esc(e.actor.name),type==='RM03'?esc(e.lotCode+' / '+e.description):'']);}
   const headers=type==='PC02'?['วันที่รับเข้า','จำนวนรับเข้า','วันที่จ่ายออก','จำนวนจ่ายออก','คงเหลือ','ผู้บันทึก','ผู้ทวนสอบ']:['วันที่รับ','จำนวน','วันที่เบิก','จำนวน','คงเหลือ','ผู้เบิก','หมายเหตุ'];
   let h=paper(type==='PC02'?'รายงานรับสินค้าเข้าคลัง':'บันทึกการรับ-จ่ายวัตถุดิบ-บรรจุภัณฑ์',headers,rows,type==='PC02'?stampFooter('02'):'FM-RM-03 Rev.00-01/01/69','รายการ: '+i.name+'   หน่วย: '+i.unit+'   '+thDate(filter.start)+' - '+thDate(filter.end));
   if(type==='PC02')h+=paper('ทะเบียน LOT และเอกสารประกอบรายงาน',['วันที่','LOT','รายการอ้างอิง'],events.filter(e=>e.date>=filter.start&&e.date<=filter.end).map(e=>[thDate(e.date),esc(e.lotCode),esc(e.description)]),'ทะเบียนประกอบ FM-PC-02');
   return h;
  }
  if(PROCESS_FIELDS[type]){const fields=PROCESS_FIELDS[type],records=data.processes.filter(r=>r.form===type&&(!j||r.jobId===j.id));return paper({PC09:'บันทึกการล้างและเตรียมวัตถุดิบ',PC10:'บันทึกการใช้เครื่องอบ และเตาอบ',PC11:'บันทึกการเชื่อม-คลุก'}[type],['วันที่'].concat(fields.map(f=>f.label)).concat(['ผู้บันทึก']),records.map(r=>[thDate(r.date)].concat(fields.map(f=>esc(r.values[f.id]))).concat([esc(r.actor.name)])),stampFooter(type.slice(2)),j?.docNo||'',true);}
  if(type==='TS01'){
   const records=data.shipments.filter(s=>!j||s.jobId===j.id),groups=[...new Set(records.map(s=>s.vehicle+'|'+s.date))],text={pass:'ผ่าน',fixed:'แก้ไขแล้ว / ผ่านตรวจซ้ำ',fail:'ไม่ผ่าน'};
   return (groups.length?groups:['']).map(group=>{const ss=records.filter(s=>s.vehicle+'|'+s.date===group),first=ss[0];let h=paper('บันทึกการตรวจเช็ครถขนส่ง',['เวลา'].concat(VEHICLE_FIELDS.map(f=>f.label)).concat(['พนักงาน']),ss.map(s=>[esc(s.time)].concat(VEHICLE_FIELDS.map(f=>text[s.checks[f.id]])).concat([esc(s.driver)])),'FM-TS-01 Rev.00-01/01/69','ทะเบียนรถ: '+(first?.vehicle||'')+'   วันที่: '+thDate(first?.date));
   const second='<h3>รายการที่จัดส่งสินค้า</h3>'+table(['สถานที่ส่ง','รายการ','จำนวน','เลข LOT สินค้า','เลข INV','หมายเหตุ','พนักงาน'],ss.flatMap(s=>s.lines.map(l=>[esc(s.destination),esc(l.item.name),quantity(l.qtyMills)+' '+esc(l.item.unit),esc(l.code),esc(s.invoice),esc(s.note),esc(s.driver)])));
   return h.replace('<p class="fx-sign">',second+'<p class="fx-sign">');}).join('');
  }
  return paper('ทะเบียนผลตรวจ QA',['วันที่','รายการ / LOT','ผลพิจารณา','ผลตรวจ / หลักฐาน','ผู้ตรวจ'],data.inspections.filter(r=>!j||r.sourceJob===j.id).map(r=>[thDate(r.date),esc(r.item.name)+' / '+esc(r.lotCode),QA[r.decision],esc(r.note)+'<br>'+esc(r.analysisRef||r.samplingPlan),esc(r.actor.name)]),'ทะเบียนแนบผลตรวจ · รอ QA ยืนยันแม่แบบและรหัสเอกสาร',j?.docNo||'',true);
 }
 function renderReview(){
  const box=$('fx-review');box.hidden=!pending;if(!pending)return;
  const event=pending.preview.event,changes=pending.preview.writes.filter(w=>w.collection==='lots');
  box.innerHTML='<h3>ตรวจสอบก่อนบันทึกจริง</h3><p>'+esc(event.description)+'</p>'+table(['LOT','คงเหลือหลังรายการ','จองหลังรายการ','สถานะ QA'],changes.map(w=>[esc(w.data.code),quantity(w.data.qtyMills)+' '+esc(w.data.item.unit),quantity(w.data.reservedMills),QA[w.data.qa]]))+'<div class="fx-actions"><button type="button" id="fx-review-cancel">กลับไปแก้ไข</button><button type="button" class="fx-primary" id="fx-review-confirm">ยืนยันบันทึกจริง</button></div>';
 }
 function collect(formId){
  const j=job(),input={},kind=formId.replace(/^fx-/,'').replace(/-form$/,'');let op=kind;
  if(kind==='item')Object.assign(input,{code:val('item-code'),name:val('item-name'),unit:val('item-unit'),kind:val('item-kind'),precision:val('item-precision'),productCode:val('catalog')?api.getProducts().find(p=>p.id===val('catalog'))?.code||'':'',inspection:val('item-inspection'),needsAnalysis:checked('item-analysis')});
  if(kind==='recipe'){Object.assign(input,{productItemId:val('recipe-product'),revision:val('recipe-revision'),outputQty:val('recipe-output'),approvalReference:val('recipe-approval'),approved:checked('recipe-approved'),requiredForms:['PC09','PC10','PC11'].filter(f=>checked('recipe-'+f)),materials:[]});for(let n=0;n<recipeRows;n++)if(val('recipe-material-'+n)||val('recipe-qty-'+n))input.materials.push({itemId:val('recipe-material-'+n),qty:val('recipe-qty-'+n)});}
  if(kind==='receive')Object.assign(input,{itemId:val('receive-item'),reference:val('receive-ref'),lotCode:val('receive-lot'),supplierLot:val('receive-supplierlot'),supplier:val('receive-supplier'),date:val('receive-date'),qty:val('receive-qty'),mfg:val('receive-mfg'),exp:val('receive-exp'),opening:checked('receive-opening'),verified:checked('receive-verified')});
  if(kind==='order'){op='plan';const r=by('recipes',val('order-recipe'));ensure(r,'เลือกสูตรผลิต');Object.assign(input,{recipeId:r.id,qty:val('order-qty'),dueDate:val('order-due'),customer:val('order-customer'),productionType:val('order-production-type'),salesReference:val('order-reference'),candidateLotIds:data.lots.filter(l=>r.materials.some(m=>m.itemId===l.itemId)&&available(l,today())>0).map(l=>l.id)});allocateMaterials(data,r,mills(input.qty,r.product.precision),input.dueDate,today());}
  if(['issue','process','produce','cancel','close','ship'].includes(kind))ensure(j,'เลือกใบสั่งผลิต');
  if(kind==='issue')Object.assign(input,{jobId:j.id,date:val('issue-date'),varianceNote:val('issue-note'),lines:j.allocations.map((a,n)=>({lotId:a.lotId,qty:val('issue-'+n)}))});
  if(kind==='process'){const form=val('process-form-type');Object.assign(input,{jobId:j.id,form,date:val('process-date'),values:Object.fromEntries(PROCESS_FIELDS[form].map(f=>[f.id,val('process-'+f.id)])),note:val('process-note'),verified:checked('process-verified')});}
  if(kind==='produce')Object.assign(input,{jobId:j.id,lotCode:val('produce-lot'),qty:val('produce-qty'),date:val('produce-date'),mfg:val('produce-mfg'),exp:val('produce-exp'),varianceNote:val('produce-note'),verified:checked('produce-verified')});
  if(kind==='cancel')Object.assign(input,{jobId:j.id,note:val('cancel-note')});
  if(kind==='close')Object.assign(input,{jobId:j.id,date:val('close-date'),note:val('close-note'),verified:checked('close-verified'),lines:j.issues.map((i,n)=>({lotId:i.lotId,used:val('close-used-'+n),returned:val('close-return-'+n),scrap:val('close-scrap-'+n)}))});
  if(kind==='inspect')Object.assign(input,{lotId:val('inspect-lot'),date:val('inspect-date'),decision:val('inspect-decision'),note:val('inspect-note'),sampleQty:val('inspect-sample'),samplingPlan:val('inspect-plan'),analysisRef:val('inspect-analysis'),verified:checked('inspect-verified'),values:{clean:checked('inspect-clean'),foreign:checked('inspect-foreign'),spec:checked('inspect-spec'),avl:checked('inspect-avl'),package:checked('inspect-package'),label:checked('inspect-label'),code:checked('inspect-code'),seal:val('inspect-seal')}});
  if(kind==='ship'){const lots=data.lots.filter(l=>l.sourceJob===j.id&&l.item.kind==='FG'&&l.qtyMills>0);Object.assign(input,{jobId:j.id,customer:val('ship-customer'),reference:val('ship-ref'),date:val('ship-date'),time:val('ship-time'),destination:val('ship-destination'),vehicle:val('ship-vehicle'),driver:val('ship-driver'),invoice:val('ship-invoice'),note:val('ship-note'),verified:checked('ship-verified'),checks:Object.fromEntries(VEHICLE_FIELDS.map(f=>[f.id,val('ship-check-'+f.id)])),lines:lots.map((l,n)=>({lotId:l.id,qty:val('ship-line-'+l.id)})).filter(l=>l.qty&&Number(l.qty)!==0)});}
  if(kind==='adjust'){op=val('adjust-kind');Object.assign(input,{lotId:val('adjust-lot'),qty:val('adjust-qty'),note:val('adjust-note'),verified:checked('adjust-verified')});}
  if(kind==='return'){const parts=val('return-lot').split('|');ensure(parts[0]===val('return-shipment'),'LOT ต้องตรงกับใบส่งของที่เลือก');Object.assign(input,{shipmentId:parts[0],lotId:parts[1],qty:val('return-qty'),date:val('return-date'),note:val('return-note'),verified:checked('return-verified')});}
  return {kind:op,input,requestId:api.newId(),expectedRevision:meta.revision||0};
 }
 function startReview(id){
  ensure(loaded&&!busy&&!pending,'รอโหลดข้อมูล / บันทึกรายการก่อน');ensure(!stale,'มีข้อมูลใหม่จากอีกเครื่อง กรุณาอัปเดตก่อนตรวจรายการ');capture();
  const action=collect(id),ctx=Object.fromEntries(FACTORY_COLLECTIONS.map(c=>[c,Object.fromEntries(data[c].map(r=>[r.id,r]))]));
  const actor={...api.getActor(),uid:initialUid,now:api.now()};
  const preview=applyFactoryAction(action,ctx,meta,actor,today());pending={action,preview,scope:scopeKey()};renderReview();buttons();message('ตรวจข้อมูลและยอดหลังรายการก่อนยืนยัน');
 }
 async function reload(){
  const token=++loadToken;busy=true;buttons();try{const loadedData=await store.load();if(!alive||token!==loadToken)return;data=loadedData.data;meta=loadedData.meta;loaded=true;stale=false;if(jobId&&!job())jobId='';render();message('ข้อมูลล่าสุด · '+data.jobs.length+' งานผลิต / '+data.lots.length+' LOT');}
  catch(error){if(alive&&token===loadToken)message(error.code==='permission-denied'?'บัญชีนี้ยังอ่านข้อมูลโรงงานไม่ได้ กรุณาตรวจสิทธิ์ Firebase ของบัญชีเดิม โดยไม่เปิดข้อมูลสาธารณะ':error.message,true);}
  finally{if(alive&&token===loadToken){busy=false;buttons();}}
 }
 async function confirm(){
  if(!pending||busy)return;busy=true;buttons();let saved=false;
  try{const result=await store.commit(pending.action);if(!alive)return;const kind=pending.action.kind;delete drafts[pending.scope];pending=null;lastResult=result;saved=true;
   if(kind==='plan')jobId=result.id;if(kind==='cancel')jobId='';if(kind==='receive'||kind==='produce'||kind==='return')lotId=result.id;
   loaded=false;await reload();if(!alive)return;renderReview();message('บันทึกสำเร็จ'+(result.reference?' · '+result.reference:'')+(result.replayed?' · รายการเดิม ไม่บันทึกซ้ำ':''));
  }catch(error){if(alive){message(error.code==='permission-denied'?'บันทึกไม่ได้: บัญชีนี้ไม่มีสิทธิ์เขียนข้อมูลโรงงาน กรุณาตรวจสิทธิ์บัญชีเดิม':error.message,true);}}
  finally{if(alive){busy=false;if(saved&&!loaded)message('บันทึกแล้ว แต่ยังโหลดข้อมูลล่าสุดไม่ได้ กรุณาอัปเดตข้อมูลก่อนทำรายการถัดไป',true);renderReview();buttons();}}
 }
 function open(view='order'){
  if(!alive)return;if(busy||pending){message('กรุณายืนยันหรือกลับไปแก้ไขรายการที่กำลังตรวจอยู่ก่อน',true);return;}
  if(loaded)capture();route=pages[view]?view:'order';render();if(!loaded)reload();
 }
 const click=event=>{
  const nav=event.target.closest('[data-fx-route]');if(nav&&host.contains(nav))return open(nav.dataset.fxRoute);
  const target=event.target.closest('[data-fx-job]');if(target){capture();jobId=target.dataset.fxJob;route='issue';render();return;}
  const lotButton=event.target.closest('[data-fx-lot]');if(lotButton){capture();lotId=lotButton.dataset.fxLot;route=lot()?.item.kind==='FG'?'quality':'incoming';render();return;}
  if(event.target.closest('#fx-reload')){if(loaded)capture();return reload();}
  if(event.target.closest('#fx-review-cancel')){if(busy)return;pending=null;render();return message('กลับไปแก้ไขแล้ว · ยังไม่บันทึกเพิ่ม');}
  if(event.target.closest('#fx-review-confirm'))return confirm();
  if(event.target.closest('#fx-add-material')){if(recipeRows>=30)return message('รองรับวัสดุ 30 รายการต่อสูตร',true);capture();recipeRows++;render();return;}
  if(event.target.closest('#fx-generate-form')){try{capture();generatePaper();buttons();message('ดึงข้อมูลจากทะเบียนโรงงานแล้ว');}catch(e){paperReady=false;buttons();message(e.message,true);}return;}
  if(event.target.closest('#fx-print-form'))return printForm();
 };
 function printForm(){
  if(!loaded||stale||pending||busy||!paperReady)return;const paper=$('fx-paper-host');if(!paper?.querySelector('.fx-paper'))return message('เลือกแบบฟอร์มและดึงข้อมูลก่อนพิมพ์',true);
  cleanupPrint();const area=doc.createElement('div');area.id='factory-print-area';area.innerHTML=paper.innerHTML;
  const style=doc.createElement('style');style.id='factory-page-style';style.textContent='@page{size:A4 '+(paper.querySelector('.fx-paper').dataset.landscape==='true'?'landscape':'portrait')+';margin:12mm}';doc.head.append(style);doc.body.append(area);doc.body.classList.add('factory-print');win.addEventListener('afterprint',cleanupPrint,{once:true});
  try{win.print();}catch(e){cleanupPrint();message('เปิดหน้าพิมพ์ไม่สำเร็จ กรุณาลองใหม่',true);}
 }
 function cleanupPrint(){doc.getElementById('factory-print-area')?.remove();doc.getElementById('factory-page-style')?.remove();doc.body.classList.remove('factory-print');win.removeEventListener('afterprint',cleanupPrint);}
 const submitHandler=e=>{if(!e.target.id?.startsWith('fx-'))return;e.preventDefault();try{startReview(e.target.id);}catch(error){message(error.message,true);}};
 const change=e=>{
  if(e.target.id==='fx-job'){capture();jobId=e.target.value;render();return;}
  if(e.target.id==='fx-inspect-lot'){capture();lotId=e.target.value;render();return;}
  if(e.target.id==='fx-process-form-type'){capture();render();return;}
  if(e.target.id==='fx-form-type'){docType=e.target.value;updateFormItems();paperReady=false;buttons();message('แบบฟอร์มเปลี่ยนแล้ว กดดึงข้อมูลลงฟอร์มก่อนพิมพ์');return;}
  if(['fx-form-item','fx-form-start','fx-form-end'].includes(e.target.id)){paperReady=false;buttons();return;}
  if(e.target.id==='fx-order-source'){const source=api.getDocuments().find(d=>d.docNo===e.target.value);if(source){$('fx-order-reference').value=source.docNo;$('fx-order-customer').value=source.customerName||'';}return;}
  if(e.target.id==='fx-catalog'){const product=api.getProducts().find(p=>p.id===e.target.value);if(product){$('fx-item-code').value=product.code;$('fx-item-name').value=product.name;$('fx-item-unit').value=product.unit;$('fx-item-kind').value='FG';}}
 };
 const inputHandler=e=>{if(['fx-form-start','fx-form-end'].includes(e.target.id)){paperReady=false;buttons();message('ช่วงวันที่เปลี่ยนแล้ว กดดึงข้อมูลลงฟอร์มก่อนพิมพ์');}};
 host.addEventListener('click',click);host.addEventListener('submit',submitHandler);host.addEventListener('change',change);
 host.addEventListener('input',inputHandler);
 if(api.watchMeta)stopMeta=api.watchMeta(r=>{if(!alive||!loaded)return;if((r?.revision||0)>(meta.revision||0)){stale=true;buttons();message('มีข้อมูลใหม่จากอีกเครื่อง กดอัปเดตข้อมูลก่อนทำรายการ');}},e=>message(e.message,true));
 render();
 return {open,reload,refreshCatalog(){if(alive&&loaded&&!busy&&!pending){capture();render();}},destroy(){alive=false;loadToken++;stopMeta?.();cleanupPrint();host.removeEventListener('click',click);host.removeEventListener('submit',submitHandler);host.removeEventListener('change',change);host.removeEventListener('input',inputHandler);host.replaceChildren();},get busy(){return busy;},get pending(){return !!pending;},get ready(){return loaded;},get lastResult(){return lastResult;}};
}
