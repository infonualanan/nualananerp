import {receivables,aging,partyKey,rowExpectation,buildBill,prepareBatch,billOutstanding,formatMoney,ensure,clone,issuerSnapshot} from './billing-core.mjs';
import {createBillingStore} from './billing-firestore.mjs';
import {billingPrintModel,statementPrintModel,printHtml,pdfBytes,dateText} from './billing-print.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fingerprint=docs=>JSON.stringify(docs.map(d=>[d.docNo,d.prefix,d.inputDate,d.grandTotal,d.customerName,d.customerTaxId,d.customerAddr,d.refDocManual,d.paymentLedger?.revision||0,d.paymentLedger?.documents?.length||0,d.billingRevision||0,d.billingManaged?.state]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
export function createBillingController(host,api){
 const document=host.ownerDocument,win=document.defaultView,uid=api.getUserId(),store=createBillingStore(api);
 let data={documents:[],batches:[],events:[],revision:0},loaded=false,alive=true,busy=false,stale=false,pending=null,page='billing',customer='',reportDate=api.today(),selected=new Set(),replacement=null,billDraft={dueDate:'',note:''},payDraft=null,proof=null,reading=false,fileToken=0,loadToken=0,currentModel=null,currentDocument='',draftModels=[],exportBusy=false,stopWatch=null,documentStamp='',reasonPending=null;
 const drafts=new Map(),urls=new Set(),$=id=>host.querySelector('#'+id),today=()=>api.today();
 host.innerHTML='<header class="bl-header"><div><h2>วางบิลและลูกหนี้</h2><p>ใบแจ้งหนี้ · รับเงินรวมหลายใบ · ประวัติเอกสาร</p></div><button type="button" id="bl-reload">อัปเดตข้อมูล</button></header><nav class="bl-nav" aria-label="เมนูบัญชี"></nav><p id="bl-message" role="status" aria-live="polite"></p><label class="bl-field bl-customer">ลูกค้า / สาขาตามเอกสาร<select id="bl-customer"></select></label><div id="bl-summary" class="bl-summary"></div><div id="bl-page"></div><dialog id="bl-dialog" aria-labelledby="bl-dialog-title"></dialog>';
 const pages={billing:'วางบิล',receivables:'ลูกหนี้',payments:'รับชำระเงิน',history:'เอกสาร / ประวัติ'},dialog=$('bl-dialog');
 const values=id=>$(id)?.value||'';
 function message(value,error=false){if(!alive)return;$('bl-message').textContent=value;$('bl-message').classList.toggle('bl-error',error);}
 function currentProjection(asOf=today()){return receivables(data.documents,asOf,today());}
 function parties(){
  const r=currentProjection(),map=new Map();
  for(const row of [...r.rows,...r.review,...r.uninvoiced])if(row.customerName&&!map.has(row.partyKey))map.set(row.partyKey,row);
  for(const d of data.documents.filter(d=>d.billingManaged))if(!map.has(d.billingManaged.partyKey))map.set(d.billingManaged.partyKey,{...d,partyKey:d.billingManaged.partyKey});
  return [...map.values()].sort((a,b)=>a.customerName.localeCompare(b.customerName,'th'));
 }
 const currentRows=()=>currentProjection().rows.filter(r=>r.partyKey===customer),party=()=>parties().find(p=>p.partyKey===customer);
 function company(){ensure(api.isCompanyReady?.()!==false,'กรุณารอข้อมูลบริษัทโหลดครบก่อนออกเอกสาร');return issuerSnapshot(api.getCompany());}
 function saveDraft(){if(customer)drafts.set(customer,{selected:[...selected],replacement:clone(replacement),billDraft:clone(billDraft),payDraft:clone(payDraft)});}
 function restoreDraft(){const d=drafts.get(customer);selected=new Set(d?.selected||[]);replacement=d?.replacement||null;billDraft=d?.billDraft||{dueDate:'',note:''};payDraft=d?.payDraft||null;proof=null;reading=false;fileToken++;}
 function buttons(){
  host.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=busy||!!pending||!loaded);
  $('bl-reload').disabled=busy||!!pending;
  if($('bl-confirm'))$('bl-confirm').disabled=busy;
  if($('bl-back'))$('bl-back').disabled=busy;
  if($('bl-dialog-close'))$('bl-dialog-close').disabled=busy;
  if($('bl-download'))$('bl-download').disabled=busy||exportBusy;
  if($('bl-draft-document'))$('bl-draft-document').disabled=busy;
  host.querySelectorAll('[data-bl-action="print"]').forEach(el=>el.disabled=busy||exportBusy);
  host.querySelectorAll('[data-locked]').forEach(el=>el.disabled=true);
  if($('bl-fill')&&!(payDraft?.ids.length))$('bl-fill').disabled=true;
 }
 const field=(id,label,type='text',value='',extra='')=>'<label class="bl-field">'+esc(label)+'<input id="'+id+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
 const button=(action,label,primary=false,extra='')=>'<button type="button" data-bl-action="'+action+'" class="'+(primary?'bl-primary':'')+'" '+extra+'>'+esc(label)+'</button>';
 const table=(heads,rows)=>'<div class="bl-table-wrap"><table class="bl-table"><thead><tr>'+heads.map(s=>'<th>'+esc(s)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map((s,n)=>'<td data-label="'+esc(heads[n])+'">'+s+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+heads.length+'">ยังไม่มีรายการ</td></tr>')+'</tbody></table></div>';
 function render(){
  if(!alive)return;
  $('bl-customer').innerHTML='<option value="">— เลือกลูกค้า —</option>'+parties().map(p=>'<option value="'+esc(p.partyKey)+'">'+esc(p.customerName)+(p.customerBranch?' · '+esc(p.customerBranch):'')+(p.customerTaxId?' · '+esc(p.customerTaxId):'')+'</option>').join('');
  if(customer&&!parties().some(p=>p.partyKey===customer)){customer='';restoreDraft();}
  $('bl-customer').value=customer;
  host.querySelector('.bl-nav').innerHTML=Object.entries(pages).map(([id,name])=>'<button type="button" data-bl-page="'+id+'" aria-pressed="'+(page===id)+'">'+name+'</button>').join('');
  const projected=currentProjection(page==='receivables'?reportDate:today()),rows=projected.rows.filter(r=>r.partyKey===customer),s=aging(rows,page==='receivables'?reportDate:today());
  $('bl-summary').innerHTML=[['ยอดใบแจ้งหนี้ที่ตรวจแล้ว',s.totalCents],['รับชำระแล้ว',s.paidCents],['ลูกหนี้คงเหลือ',s.balanceCents]].map(([label,n])=>'<div><small>'+label+'</small><strong>'+formatMoney(n)+'</strong></div>').join('');
  const unchecked=projected.review.filter(r=>r.partyKey===customer).length;
  if(unchecked)$('bl-summary').innerHTML+='<p class="bl-summary-warning">ยังมี '+unchecked+' ใบรอตรวจยอด ยอดที่แสดงยังไม่ใช่ลูกหนี้ทั้งหมดของลูกค้ารายนี้</p>';
  if(!loaded)$('bl-page').innerHTML='<p class="bl-empty">กำลังโหลดข้อมูลบัญชีจาก Firebase…</p>';
  else if(!customer)$('bl-page').innerHTML='<div class="bl-empty">เลือกลูกค้าที่มีใบแจ้งหนี้ หรือเริ่มจากคลังเอกสารของบริษัท</div>';
  else $('bl-page').innerHTML=({billing:billingPage,receivables:reportPage,payments:paymentPage,history:historyPage})[page]();
  updatePaySummary();buttons();
 }
 function pick(row,mode,checked,locked=false){
  return '<label class="bl-pick"><input type="checkbox" data-bl-pick="'+mode+'" data-root="'+esc(row.rootNo)+'" '+(checked?'checked ':'')+(locked?'data-locked disabled ':'')+'aria-label="เลือก '+esc(row.invoiceNo)+'"><span><strong>'+esc(row.invoiceNo)+'</strong>'+(row.rootNo!==row.invoiceNo?'<small>ต้นทาง '+esc(row.rootNo)+'</small>':'')+'</span></label>';
 }
 function reviewList(){
  const p=currentProjection(),rows=[...p.review,...p.uninvoiced].filter(r=>r.partyKey===customer);
  return rows.length?'<details class="bl-review-list"><summary>รอตรวจยอด / รอใบแจ้งหนี้ '+rows.length+' รายการ (ยังไม่รวมในยอดข้างบน)</summary>'+table(['ต้นทาง','ตรวจสอบก่อนใช้','ดำเนินการ'],rows.map(r=>[esc(r.rootNo),esc(r.reason),'<button type="button" data-bl-root="'+esc(r.rootNo)+'">เปิดรับชำระ / ตรวจต้นทาง</button>']))+'</details>':'';
 }
 function billingPage(){
  const rows=currentRows(),tableRows=rows.map(r=>{
   const lock=r.billingLock&&r.billingLock.billNo!==replacement?.billNo;const disabled=r.balanceCents===0||lock;
   if(disabled)selected.delete(r.rootNo);
   return [pick(r,'bill',selected.has(r.rootNo),disabled)+(lock?'<button type="button" data-bl-document="'+esc(r.billingLock.billNo)+'">อยู่ใน '+esc(r.billingLock.billNo)+'</button>':''),dateText(r.dueDate),formatMoney(r.totalCents),formatMoney(r.paidCents),'<strong>'+formatMoney(r.balanceCents)+'</strong>'];
  }),chosen=rows.filter(r=>selected.has(r.rootNo)),total=chosen.reduce((s,r)=>s+r.balanceCents,0);
  return (replacement?'<div class="bl-banner">ออกฉบับใหม่แทน '+esc(replacement.billNo)+' · '+esc(replacement.reason)+' '+button('abandon','ยกเลิกการแก้ไข')+'</div>':'')+
   '<section class="bl-box"><h3>เลือกใบแจ้งหนี้เพื่อวางบิล</h3>'+table(['เลือก / ใบแจ้งหนี้','ครบกำหนด','ยอดสุทธิ','รับแล้ว','คงเหลือ'],tableRows)+
   '<div class="bl-fields">'+field('bl-bill-date','วันที่ออกบิล','date',today(),'readonly data-locked')+field('bl-bill-due','วันนัดชำระใบวางบิล','date',billDraft.dueDate,'min="'+today()+'"')+field('bl-bill-note','หมายเหตุในใบวางบิล','text',billDraft.note,'maxlength="240"')+'</div>'+
   '<div class="bl-actions"><div><small>เลือก '+chosen.length+' ใบ · ยอดเรียกเก็บ</small><strong>'+formatMoney(total)+' บาท</strong></div>'+button('review-bill','ตรวจและออกใบวางบิล',true)+'</div></section>'+reviewList();
 }
 function reportPage(){
  const projection=currentProjection(reportDate),rows=projection.rows.filter(r=>r.partyKey===customer),s=aging(rows,reportDate),labels=['ยังไม่เกินกำหนด','เกิน 1–30 วัน','เกิน 31–60 วัน','เกิน 61–90 วัน','เกิน 90 วัน','ยังไม่ยืนยันกำหนด'];
  return '<section class="bl-box"><div class="bl-toolbar"><h3>รายงานลูกหนี้รายลูกค้า</h3>'+field('bl-asof','ยอด ณ วันที่','date',reportDate,'max="'+today()+'"')+'</div><div class="bl-aging">'+labels.map((l,n)=>'<div><small>'+l+'</small><strong>'+formatMoney(s.buckets[n])+'</strong></div>').join('')+'</div>'+
   table(['ใบแจ้งหนี้','ครบกำหนด','ยอดสุทธิ','รับแล้ว','คงเหลือ'],rows.map(r=>[esc(r.invoiceNo),dateText(r.dueDate),formatMoney(r.totalCents),formatMoney(r.paidCents),formatMoney(r.balanceCents)]))+
   '<div class="bl-actions"><span>ยอดที่ตรวจแล้ว ณ '+dateText(reportDate)+'</span>'+button('statement','ดูรายงาน / PDF',true)+'</div></section>'+
   (projection.review.some(r=>r.partyKey===customer)?'<p class="bl-hint">มีเอกสารที่ยังไม่กระทบยอด รายงานนี้ยังไม่ใช่ยอดลูกหนี้ทั้งหมดของลูกค้ารายนี้</p>':'')+reviewList();
 }
 function ensurePay(){
  if(!payDraft)payDraft={ids:[],allocations:{},amount:'',date:today(),reference:'',method:'โอนธนาคาร',dueDate:'',proofNote:'',note:'',verified:false,billNo:''};
  return payDraft;
 }
 function paymentPage(){
  const d=ensurePay(),rows=currentRows().filter(r=>r.balanceCents>0);
  return '<section class="bl-box"><h3>รับเงินครั้งเดียว ตัดหนี้หลายใบ</h3>'+(d.billNo?'<p class="bl-banner">อ้างอิงใบวางบิล '+esc(d.billNo)+'</p>':'')+
   '<div class="bl-fields">'+field('bl-amount','รับชำระครั้งนี้ (บาท)','text',d.amount,'inputmode="decimal" maxlength="18"')+field('bl-pay-date','วันที่รับเงิน','date',d.date,'max="'+today()+'"')+field('bl-reference','เลขอ้างอิงรับเงิน (ไม่ซ้ำ)','text',d.reference,'maxlength="80"')+
   '<label class="bl-field">ช่องทาง<select id="bl-method">'+['โอนธนาคาร','พร้อมเพย์','เงินสด'].map(s=>'<option'+(s===d.method?' selected':'')+'>'+s+'</option>').join('')+'</select></label>'+field('bl-next-due','วันนัดชำระยอดที่ยังเหลือ','date',d.dueDate)+
   '<label class="bl-field">หลักฐาน PNG/JPG/PDF ไม่เกิน 500 KB<input id="bl-proof" type="file" accept="image/png,image/jpeg,application/pdf"><small id="bl-proof-label">'+esc(proof?proof.name:'เลือกไฟล์ หรือกรอกรายละเอียดหลักฐาน')+'</small></label>'+
   field('bl-proof-note','รายละเอียดหลักฐาน / รายการธนาคาร','text',d.proofNote,'maxlength="180"')+field('bl-pay-note','หมายเหตุรับเงิน','text',d.note,'maxlength="240"')+'</div>'+
   '<div class="bl-toolbar">'+button('fill','เติมยอดคงเหลือที่เลือก',false,'id="bl-fill"')+button('allocate','จัดสรรตามวันครบกำหนด')+'</div>'+
   table(['เลือก / ใบแจ้งหนี้','ครบกำหนด','คงเหลือ','รับงวดนี้'],rows.map(r=>[pick(r,'pay',d.ids.includes(r.rootNo)),dateText(r.dueDate),formatMoney(r.balanceCents),'<input class="bl-allocation" data-bl-allocation="'+esc(r.rootNo)+'" inputmode="decimal" value="'+esc(d.allocations[r.rootNo]||'')+'" '+(!d.ids.includes(r.rootNo)?'data-locked disabled ':'')+'aria-label="รับชำระ '+esc(r.invoiceNo)+'">']))+
   '<p id="bl-allocation-message" class="bl-hint" role="status" aria-live="polite"></p><label class="bl-check"><input id="bl-verified" type="checkbox" '+(d.verified?'checked':'')+'><span>ตรวจสอบเงินเข้าบัญชีหรือรับเงินสดจริงแล้ว</span></label>'+
   '<div class="bl-actions"><span>ตรวจยอดจัดสรรและเอกสารก่อนยืนยัน</span>'+button('review-payment','ตรวจและบันทึกรับเงิน',true)+'</div></section>'+reviewList();
 }
 function updatePaySummary(){
  if(page!=='payments'||!payDraft||!$('bl-allocation-message'))return;
  try{
   const parse=s=>{const t=String(s||'0').replace(/,/g,'');ensure(/^\d+(?:\.\d{1,2})?$/.test(t),'จำนวนเงินต้องเป็นเลขบวก ทศนิยมไม่เกิน 2 ตำแหน่ง');return Math.round(Number(t)*100);};
   const expected=parse(payDraft.amount),actual=payDraft.ids.reduce((s,id)=>s+parse(payDraft.allocations[id]),0),diff=expected-actual;
   $('bl-allocation-message').textContent=diff===0?'จัดสรรครบ '+formatMoney(actual)+' บาท':diff>0?'ยังไม่จัดสรร '+formatMoney(diff)+' บาท':'จัดสรรเกิน '+formatMoney(-diff)+' บาท';
   $('bl-allocation-message').classList.toggle('bl-error',diff!==0);
  }catch(e){$('bl-allocation-message').textContent=e.message;}
 }
 function historyPage(){
  const bills=data.documents.filter(d=>d.billingManaged?.partyKey===customer).sort((a,b)=>b.docNo.localeCompare(a.docNo));
  const batches=data.batches.filter(b=>b.partyKey===customer).sort((a,b)=>b.id.localeCompare(a.id));
  const events=data.events.filter(e=>e.partyKey===customer).sort((a,b)=>b.sequence-a.sequence);
  return '<section class="bl-box"><h3>ใบวางบิล</h3>'+table(['เอกสาร','สถานะ','ยอดออกบิล','คงเหลือล่าสุด','จัดการ'],bills.map(d=>{
   const left=billOutstanding(d,data.documents),active=d.billingManaged.state==='issued';
   return [esc(d.docNo),esc(active?(left===0?'ชำระครบ':'ออกแล้ว'):d.billingManaged.state==='cancelled'?'ยกเลิกแล้ว':'มีฉบับใหม่แทน'),formatMoney(Math.round(d.grandTotal*100)),left===null?'รอตรวจยอด':formatMoney(left),
    '<div class="bl-inline">'+button('view','เปิดเอกสาร',false,'data-no="'+esc(d.docNo)+'"')+(active?button('pay-bill','รับเงิน',false,'data-no="'+esc(d.docNo)+'"')+button('replace','แก้ไข / ออกใหม่',false,'data-no="'+esc(d.docNo)+'"')+button('cancel','ยกเลิก',false,'data-no="'+esc(d.docNo)+'"'):'')+'</div>'];
  }))+'</section><section class="bl-box"><h3>รับเงินรวมและเอกสารที่ออก</h3>'+table(['รายการรับเงิน','วันที่ / อ้างอิง','ยอดรับ','เอกสาร'],batches.map(b=>[esc(b.id),dateText(b.date)+'<br>'+esc(b.reference),formatMoney(b.amountCents),b.documentNos.map(n=>button('view',n,false,'data-no="'+esc(n)+'"')).join(' ')]))+'</section>'+
   '<section class="bl-box"><h3>หลักฐานรับเงินรวม</h3>'+batches.map(b=>'<p>'+esc(b.id)+' '+button('proof','ดูหลักฐาน',false,'data-no="'+esc(b.id)+'"')+'</p>').join('')+'</section>'+
   '<section class="bl-box"><h3>ประวัติทำรายการ</h3>'+table(['วันที่','รายการ','รายละเอียด','ผู้บันทึก'],events.map(e=>[dateText(e.date),esc(({ 'issue-bill':'ออกใบวางบิล','replace-bill':'ออกฉบับใหม่แทน','cancel-bill':'ยกเลิกใบวางบิล','receive-batch':'รับเงินรวม' })[e.kind]||e.kind)+'<br>'+esc(e.documentNo),esc(e.reason||e.reference||''),esc(e.actor?.name||e.actor?.uid||'')]))+'</section>';
 }
 async function reload(){
  const token=++loadToken;
  try{const loadedData=await store.load();if(!alive||token!==loadToken)return false;data=loadedData;loaded=true;stale=false;documentStamp=fingerprint(data.documents);if(!customer&&parties().length)customer=parties()[0].partyKey;render();return true;}catch(e){if(alive&&token===loadToken){loaded=false;message(e.message,true);render();}return false;}
 }
 function selectedRows(ids){
  const rows=currentRows().filter(r=>ids.includes(r.rootNo));ensure(rows.length===ids.length,'มีใบแจ้งหนี้เปลี่ยนสถานะ กรุณาอัปเดตและเลือกใหม่');return rows;
 }
 function action(kind,input){
  ensure(loaded&&!stale,'กรุณาอัปเดตข้อมูลและตรวจยอดก่อนทำรายการใหม่');ensure(!reading,'กำลังอ่านหลักฐาน กรุณารอสักครู่');
  return {kind,input,requestId:api.newId(),expectedRevision:data.revision,issuer:company(),now:api.now()};
 }
 function openDialog(title,body,footer){
  dialog.innerHTML='<header class="bl-dialog-head"><h3 id="bl-dialog-title">'+esc(title)+'</h3><button type="button" id="bl-dialog-close" data-bl-action="close">ปิด</button></header><div class="bl-dialog-body">'+body+'</div><p id="bl-dialog-error" role="alert"></p><footer class="bl-dialog-actions">'+footer+'</footer>';
  if(!dialog.open){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}
  buttons();
 }
 function closeDialog(){
  if(busy)return;
  if(dialog.close)dialog.close();else dialog.removeAttribute('open');
  pending=null;reasonPending=null;currentModel=null;currentDocument='';draftModels=[];buttons();
 }
 function showPaper(model,{draft=false,confirm=false,documentNo=''}={}){
  currentModel=model;currentDocument=documentNo;
  const picker=draftModels.length>1?'<label class="bl-field">เอกสารที่จะออก ('+draftModels.length+' ฉบับ)<select id="bl-draft-document">'+draftModels.map((m,n)=>'<option value="'+n+'">'+esc(m.title)+'</option>').join('')+'</select></label>':'';
  openDialog(draft?'ตรวจเอกสารก่อนยืนยัน':model.number,picker+'<div class="bl-paper-preview">'+printHtml(model,{draft})+'</div>',
   button('download','ดาวน์โหลด PDF',false,'id="bl-download"')+button('print','พิมพ์')+(confirm?button('back','กลับไปแก้ไข',false,'id="bl-back"')+button('confirm',pending?.kind==='payment'?'ยืนยันรับเงินจริงและออกเอกสาร':'ยืนยันออกใบวางบิล',true,'id="bl-confirm"'):(documentNo&&data.documents.find(d=>d.docNo===documentNo)?.billingManaged?.state==='issued'?button('pay-bill','ไปบันทึกรับเงิน',true,'data-no="'+esc(documentNo)+'"'):'')));
 }
 function prepareReview(kind){
  ensure(!pending&&!busy,'มีรายการที่รอยืนยัน');
  let a,docs;
  if(kind==='bill'){
   const rows=selectedRows([...selected]);a=action('bill',{rows:rows.map(rowExpectation),dueDate:billDraft.dueDate,note:billDraft.note,replaces:replacement?.billNo||'',reason:replacement?.reason||''});
   docs=[buildBill(a,data.documents,today(),'BL-DRAFT')];
  }else{
   const d=ensurePay(),rows=selectedRows(d.ids);
   a=action('payment',{...clone(d),rows:rows.map(rowExpectation)});a.proof=proof?clone(proof):null;
   docs=prepareBatch(a,data.documents,today()).documents;
  }
  pending=a;draftModels=docs.map(d=>billingPrintModel(d,a.issuer));showPaper(draftModels[0],{draft:true,confirm:true});
 }
 async function confirm(){
  if(!pending||busy)return;
  busy=true;buttons();let saved=false,result;
  try{
   result=await store.commit(pending);saved=true;if(!alive)return;pending=null;replacement=null;selected.clear();proof=null;reading=false;fileToken++;payDraft=null;drafts.delete(customer);
   if(dialog.close)dialog.close();else dialog.removeAttribute('open');
   currentModel=null;draftModels=[];
   api.onSaved?.(result);
   await reload();if(!alive)return;page='history';render();message('บันทึกสำเร็จ · '+result.docNos.join(', ')+(result.replayed?' · รายการเดิม ไม่บันทึกซ้ำ':''));
   if(result.docNos.length)openSavedDocument(result.docNos[0]);
  }catch(e){if(alive){const msg=saved?'บันทึกสำเร็จแล้ว แต่อัปเดตหน้าจอไม่สำเร็จ กรุณากดอัปเดตข้อมูล':e.code==='permission-denied'?'บัญชีนี้ไม่มีสิทธิ์บันทึก กรุณาตรวจสิทธิ์ Firebase':e.message;message(msg,true);if($('bl-dialog-error'))$('bl-dialog-error').textContent=msg;}}
  finally{if(alive){busy=false;buttons();}}
 }
 function openSavedDocument(no){
  const doc=data.documents.find(d=>d.docNo===no);ensure(doc,'ไม่พบเอกสาร กรุณาอัปเดตข้อมูล');ensure(doc.billingManaged||doc.collectionRows,'เอกสารนี้เปิดได้จากคลังเอกสารเดิม');
  draftModels=[];showPaper(billingPrintModel(doc),{documentNo:no});
 }
 function reason(no,kind){
  const doc=data.documents.find(d=>d.docNo===no);ensure(doc?.billingManaged?.state==='issued','ใบวางบิลเปลี่ยนสถานะแล้ว');
  reasonPending={no,kind};openDialog(kind==='replace'?'แก้ไข / ออกใบวางบิลใหม่':'ยกเลิกใบวางบิล',
   '<p>'+esc(no)+'</p><p class="bl-hint">ยอดรับเงินจริงและยอดหนี้คงเดิม เก็บต้นฉบับและเหตุผลไว้ตรวจย้อนหลัง</p><label class="bl-field">เหตุผล<textarea id="bl-reason" rows="3" maxlength="240"></textarea></label>',
   button('close','กลับ')+button('confirm-reason',kind==='replace'?'ไปแก้ไขฉบับใหม่':'ยืนยันยกเลิกใบวางบิล',true));
 }
 async function confirmReason(){
  if(!reasonPending||busy)return;
  const why=values('bl-reason').trim();ensure(why.length>=3,'ระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
  const r=reasonPending,doc=data.documents.find(d=>d.docNo===r.no);
  if(r.kind==='replace'){replacement={billNo:r.no,reason:why};selected=new Set(currentRows().filter(row=>doc.billingManaged.rootNos.includes(row.rootNo)&&row.balanceCents>0).map(row=>row.rootNo));billDraft={dueDate:doc.billingManaged.dueDate,note:doc.remark||''};closeDialog();page='billing';render();message('ตรวจยอดและเลือกเอกสารก่อนยืนยันออกฉบับใหม่');}
  else{pending=action('cancel',{billNo:r.no,billRevision:doc.billingManaged.revision||0,reason:why});await confirm();}
 }
 function allocate(){
  const d=ensurePay(),rows=selectedRows(d.ids).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.invoiceNo.localeCompare(b.invoiceNo));
  const amount=String(d.amount||'').replace(/,/g,'');ensure(/^\d+(?:\.\d{1,2})?$/.test(amount)&&Number(amount)>0,'กรอกยอดรับเงินจริงก่อนจัดสรร');
  let left=Math.round(Number(amount)*100);ensure(left<=rows.reduce((s,r)=>s+r.balanceCents,0),'ยอดรับเงินเกินยอดค้างที่เลือก');d.allocations={};
  for(const r of rows){const n=Math.min(left,r.balanceCents);d.allocations[r.rootNo]=String(n/100);left-=n;}
  render();
 }
 function payBill(no){
  const bill=data.documents.find(d=>d.docNo===no);ensure(bill?.billingManaged?.state==='issued','ใบวางบิลเปลี่ยนสถานะแล้ว');const rows=currentRows().filter(r=>bill.billingManaged.rootNos.includes(r.rootNo)&&r.balanceCents>0);ensure(rows.length,'ใบวางบิลนี้ไม่มีหนี้ค้าง');
  closeDialog();payDraft=null;const d=ensurePay();d.ids=rows.map(r=>r.rootNo);d.amount=String(rows.reduce((s,r)=>s+r.balanceCents,0)/100);d.billNo=no;d.dueDate=bill.billingManaged.dueDate;page='payments';allocate();
 }
 async function download(){
  if(!currentModel||exportBusy)return;
  const model=clone(currentModel),draft=!!pending;exportBusy=true;buttons();
  try{
   const bytes=await pdfBytes(model,document,{draft});if(!alive||api.getUserId()!==uid)return;
   const url=win.URL.createObjectURL(new win.Blob([bytes],{type:'application/pdf'}));urls.add(url);const a=document.createElement('a');a.href=url;a.download=(draft?'DRAFT-':'')+model.number.replace(/[^A-Za-z0-9_-]/g,'')+'.pdf';(dialog.open?dialog:host).append(a);a.click();a.remove();win.setTimeout(()=>{win.URL.revokeObjectURL(url);urls.delete(url);},60000);
  }catch(e){if(alive&&$('bl-dialog-error'))$('bl-dialog-error').textContent=e.message;}finally{if(alive){exportBusy=false;buttons();}}
 }
 function cleanPrint(){document.getElementById('billing-print-area')?.remove();document.body.classList.remove('billing-print');}
 function print(){
  ensure(currentModel,'เปิดเอกสารก่อนพิมพ์');cleanPrint();const area=document.createElement('div');area.id='billing-print-area';area.innerHTML=printHtml(currentModel,{draft:!!pending});document.body.append(area);document.body.classList.add('billing-print');win.print();
 }
 const afterPrint=()=>cleanPrint();win.addEventListener('afterprint',afterPrint);
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  try{
   if(b.id==='bl-reload'){if(!pending&&!busy){saveDraft();await reload();}return;}
   if(b.dataset.blPage){saveDraft();page=b.dataset.blPage;render();return;}
   if(b.dataset.blRoot){saveDraft();api.openPayments(b.dataset.blRoot);return;}
   if(b.dataset.blDocument){openSavedDocument(b.dataset.blDocument);return;}
   const a=b.dataset.blAction,no=b.dataset.no;
   if(a==='review-bill')prepareReview('bill');
   if(a==='review-payment')prepareReview('payment');
   if(a==='confirm')await confirm();
   if(a==='close'||a==='back')closeDialog();
   if(a==='allocate')allocate();
   if(a==='fill'){const d=ensurePay();d.amount=String(selectedRows(d.ids).reduce((s,r)=>s+r.balanceCents,0)/100);allocate();}
   if(a==='view')openSavedDocument(no);
   if(a==='proof'){
    const batch=data.batches.find(b=>b.id===no);ensure(batch,'ไม่พบรายการรับเงิน');const file=batch.documentNos.map(n=>data.documents.find(d=>d.docNo===n)?.paymentProof).find(Boolean);
    let content='<p>รับเงิน '+formatMoney(batch.amountCents)+' บาท · '+dateText(batch.date)+'</p><p>อ้างอิง '+esc(batch.reference)+'</p><p>'+esc(batch.proofNote||'')+'</p>';
    if(file&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(file.data))content+='<img class="bl-proof-image" src="'+file.data+'" alt="หลักฐานรับเงิน">';
    else if(file&&/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(file.data))content+='<a href="'+file.data+'" download="'+esc(file.name)+'">ดาวน์โหลดหลักฐาน PDF</a>';
    currentModel=null;openDialog('หลักฐาน '+no,content,button('close','ปิด'));
   }
   if(a==='pay-bill')payBill(no);
   if(a==='replace'||a==='cancel')reason(no,a);
   if(a==='confirm-reason')await confirmReason();
   if(a==='abandon'){replacement=null;selected.clear();render();}
   if(a==='statement'){const rows=currentProjection(reportDate).rows.filter(r=>r.partyKey===customer);ensure(rows.length,'ไม่มีรายการในวันที่เลือก');currentModel=statementPrintModel(rows,party(),company(),reportDate);showPaper(currentModel);}
   if(a==='download')await download();
   if(a==='print')print();
  }catch(error){message(error.message,true);if(dialog.open&&$('bl-dialog-error'))$('bl-dialog-error').textContent=error.message;}
 });
 host.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='bl-draft-document'&&!busy){const index=Number(el.value);if(draftModels[index]){currentModel=draftModels[index];dialog.querySelector('.bl-paper-preview').innerHTML=printHtml(currentModel,{draft:true});}return;}
  if(busy||pending)return;
  try{
   if(el.id==='bl-customer'){saveDraft();customer=el.value;restoreDraft();render();}
   if(el.dataset.blPick==='bill'){el.checked?selected.add(el.dataset.root):selected.delete(el.dataset.root);render();}
   if(el.dataset.blPick==='pay'){const d=ensurePay();if(el.checked&&!d.ids.includes(el.dataset.root))d.ids.push(el.dataset.root);if(!el.checked){d.ids=d.ids.filter(id=>id!==el.dataset.root);delete d.allocations[el.dataset.root];}render();}
   if(el.id==='bl-asof'){ensure(/^\d{4}-\d{2}-\d{2}$/.test(el.value)&&el.value<=today(),'วันที่รายงานไม่ถูกต้อง');reportDate=el.value;render();}
   if(el.id==='bl-method')ensurePay().method=el.value;
   if(el.id==='bl-verified')ensurePay().verified=el.checked;
   if(el.id==='bl-proof'){
    const file=el.files?.[0],token=++fileToken;proof=null;reading=false;if(!file)return;
    ensure(['image/png','image/jpeg','application/pdf'].includes(file.type)&&file.size>0&&file.size<=500*1024,'หลักฐานต้องเป็น PNG/JPG/PDF ไม่เกิน 500 KB');
    reading=true;$('bl-proof-label').textContent='กำลังอ่าน '+file.name;const reader=new win.FileReader();
    reader.onload=()=>{if(!alive||token!==fileToken)return;proof={name:file.name.slice(0,180),type:file.type,data:String(reader.result)};reading=false;if($('bl-proof-label'))$('bl-proof-label').textContent=file.name;};
    reader.onerror=()=>{if(alive&&token===fileToken){reading=false;message('อ่านหลักฐานไม่สำเร็จ กรุณาเลือกใหม่',true);}};reader.readAsDataURL(file);
   }
   if(el.id==='bl-draft-document'){const index=Number(el.value);currentModel=draftModels[index];const viewport=dialog.querySelector('.bl-paper-preview');viewport.innerHTML=printHtml(currentModel,{draft:true});}
  }catch(error){message(error.message,true);}
 });
 host.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='bl-bill-due')billDraft.dueDate=el.value;
  if(el.id==='bl-bill-note')billDraft.note=el.value;
  if(!payDraft)return;
  const fields={'bl-amount':'amount','bl-pay-date':'date','bl-reference':'reference','bl-next-due':'dueDate','bl-proof-note':'proofNote','bl-pay-note':'note'};
  if(fields[el.id])payDraft[fields[el.id]]=el.value;
  if(el.dataset.blAllocation)payDraft.allocations[el.dataset.blAllocation]=el.value;
  updatePaySummary();
 });
 dialog.addEventListener('cancel',e=>{if(busy){e.preventDefault();return;}pending=null;reasonPending=null;currentModel=null;draftModels=[];buttons();});
 if(api.watchMeta)stopWatch=api.watchMeta(revision=>{if(alive&&loaded&&revision!==data.revision){stale=true;message(pending?'ข้อมูลเปลี่ยน กดยืนยันเพื่อตรวจผลรายการเดิม หรือกลับไปแก้ไขและอัปเดต':'มีข้อมูลเปลี่ยนจากอีกเครื่อง กรุณากดอัปเดตก่อนทำรายการใหม่');}},e=>message(e.message,true));
 const ready=reload();
 return {ready,reload,download,open(view='billing'){if(pending||busy)return;page=pages[view]?view:'billing';render();},
  async openDocument(no){await ready;if(!loaded)await reload();if(!alive||busy||pending)return;const d=data.documents.find(x=>x.docNo===no);ensure(d,'ไม่พบเอกสาร');customer=d.billingManaged?.partyKey||partyKey(d);page='history';render();openSavedDocument(no);},
  notifyDocuments(documents){if(loaded&&fingerprint(documents)!==documentStamp){stale=true;message('ข้อมูลเอกสารเปลี่ยน กรุณาอัปเดตก่อนทำรายการใหม่');}},
  destroy(){alive=false;fileToken++;loadToken++;if(stopWatch)stopWatch();for(const url of urls)win.URL.revokeObjectURL(url);urls.clear();win.removeEventListener('afterprint',afterPrint);cleanPrint();if(dialog.open&&dialog.close)dialog.close();host.replaceChildren();},
  get pending(){return !!pending;},get busy(){return busy;}};
}
