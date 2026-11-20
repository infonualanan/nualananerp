import {isPaymentRoot, ledgerSummary, applyOperation, operationPrefix, moneyCents, cancelPaymentDocument, isCancelledRecord} from './payments-core.mjs';
import {createPaymentStore} from './payments-firestore.mjs';
const money=c=>(c/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=d=>d?new Date(d+'T12:00:00+07:00').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}):'—';
const pct=(p,t)=>Number((p/t*100).toFixed(2))+'%';
export function createPaymentsController(host,api) {
    const document=host.ownerDocument, Option=document.defaultView.Option, FileReader=document.defaultView.FileReader;
    const store=createPaymentStore(api);
    let selected='',currentDoc='',pending=null,busy=false,alive=true,proof=null,fileToken=0,reading=false,management=null;
    host.innerHTML=`<div class="pp-header"><div><h2>รับชำระเงินและออกเอกสาร</h2><p>รับเงินหลายงวด · เก็บหลักฐาน · หักมัดจำ · เอกสารอ้างอิงออเดอร์เดียวกัน</p></div></div>
    <label class="pp-label pp-order">เลือกใบสั่งขาย / ใบแจ้งหนี้ (THB)<select id="pp-order"><option value="">— เลือกเอกสารต้นทาง —</option></select></label>
    <p class="pp-message" id="pp-message" role="status" aria-live="polite">เลือกเอกสารต้นทางเพื่อดูยอดรับเงินและยอดคงเหลือ</p>
    <div id="pp-selected" hidden>
     <div class="pp-metrics"><div><small>ยอดออเดอร์ (บาท)</small><strong id="pp-total"></strong></div><div><small>รับชำระแล้ว (บาท)</small><strong id="pp-paid"></strong><span id="pp-ratio"></span></div><div><small>คงเหลือ (บาท)</small><strong id="pp-balance"></strong><span id="pp-due-label"></span></div></div>
     <form id="pp-setup" class="pp-box"><h3>เปิดรับชำระหลายงวด</h3><div class="pp-fields"><label class="pp-label">วิธีออกเอกสาร<select id="pp-mode"><option value="receipt">รับเงิน / ใบเสร็จเท่านั้น (ไม่ออกใบกำกับภาษี)</option><option value="domestic-vat7">ขายสินค้าในประเทศ · จด VAT · รวม VAT 7%</option></select></label><label class="pp-label">วันนัดชำระ<input id="pp-setup-due" type="date" required></label></div><p class="pp-hint">โหมด VAT ใช้กับมัดจำที่เป็นส่วนหนึ่งของราคาสินค้า และยังไม่ได้ส่งมอบหรือออกใบกำกับมาก่อน</p><label class="pp-check"><input id="pp-setup-verified" type="checkbox" required><span>ตรวจสอบแล้วว่ายังไม่มีรับเงิน ออกใบกำกับ หรือส่งมอบสำหรับรายการนี้</span></label><button class="pp-primary" type="submit">เปิดรับชำระหลายงวด</button></form>
     <div id="pp-workspace" class="pp-columns" hidden>
      <div class="pp-box">
       <div class="pp-toolbar"><h3>รับชำระเงิน</h3><span id="pp-stage"></span></div>
       <div class="pp-toolbar pp-soft"><button type="button" id="pp-deliver">บันทึกส่งมอบ / ออกใบกำกับส่วนที่เหลือ</button></div>
       <form id="pp-payment-form" class="pp-form" novalidate><fieldset id="pp-payment-fields"><div class="pp-fields"><label class="pp-label">รับเงินครั้งนี้ (บาท)<input id="pp-amount" inputmode="decimal" autocomplete="off" maxlength="16" required></label><label class="pp-label">วันที่รับเงิน<input id="pp-date" type="date" required></label><label class="pp-label">ช่องทาง<select id="pp-method"><option>โอนธนาคาร</option><option>พร้อมเพย์</option><option>เงินสด</option></select></label><label class="pp-label">เลขอ้างอิงรับเงิน<input id="pp-reference" maxlength="80" autocomplete="off" required></label><label class="pp-label pp-wide">วันนัดชำระยอดที่ยังเหลือ<input id="pp-due" type="date"></label><div class="pp-wide"><button type="button" id="pp-fill">เติมยอดคงเหลือ</button></div><label class="pp-label pp-wide">หลักฐาน PNG / JPG / PDF ไม่เกิน 500 KB<input id="pp-file" type="file" accept="image/png,image/jpeg,application/pdf"><small id="pp-file-label">เลือกไฟล์ หรือกรอกรายละเอียดหลักฐานด้านล่าง</small></label><label class="pp-label pp-wide">รายละเอียดหลักฐาน / รายการธนาคาร<input id="pp-proof-note" maxlength="180" placeholder="เช่น รายการจากบัญชีธนาคาร เลขอ้างอิง…"></label></div><label class="pp-check"><input type="checkbox" id="pp-verified"><span>ตรวจสอบเงินเข้าบัญชีหรือรับเงินสดจริงแล้ว</span></label><button type="submit" class="pp-primary pp-full">ตรวจสอบและออกเอกสาร</button></fieldset></form>
       <div id="pp-review" class="pp-form pp-soft" hidden><h3 id="pp-review-title">ตรวจสอบก่อนยืนยัน</h3><div id="pp-review-summary"></div><div class="pp-actions"><button type="button" id="pp-cancel">กลับไปแก้ไข</button><button type="button" id="pp-confirm" class="pp-primary">ยืนยัน</button></div></div>
       <div id="pp-complete" class="pp-form pp-soft" hidden><h3>รับชำระครบแล้ว</h3><p>ไม่มีเงินค้างรับ · เอกสารแต่ละงวดยังเปิดดูได้</p></div>
       <div class="pp-toolbar"><h3>ประวัติรับชำระ</h3><span id="pp-count"></span></div><div id="pp-history"></div>
       <section class="pp-form pp-soft" id="pp-proof-view" hidden><div class="pp-toolbar"><h3>หลักฐานรับเงิน</h3><button type="button" id="pp-close-proof">ปิด</button></div><div id="pp-proof-content"></div></section>
      </div>
      <section class="pp-box"><div class="pp-toolbar"><h3>เอกสารของออเดอร์</h3><span id="pp-doc-count"></span></div><div class="pp-form"><label class="pp-label">เลือกเอกสาร<select id="pp-document"></select></label><div class="pp-actions"><button id="pp-invoice" type="button">ออกใบแจ้งหนี้หักยอดรับแล้ว</button><button id="pp-edit-issued" type="button">แก้ไข / ออกใหม่</button><button id="pp-void-issued" type="button" class="pp-danger">ยกเลิกเอกสาร</button><button id="pp-a4" type="button">เปิด A4 / พิมพ์</button><button id="pp-pdf" type="button">โหลด PDF</button></div></div><div class="pp-form pp-soft"><label class="pp-label">ยอดเรียกเก็บในใบแจ้งหนี้ (บาท · รวม VAT ถ้ามี)<input id="pp-invoice-amount" inputmode="decimal" placeholder="เว้นว่าง = แสดงยอดออเดอร์เต็มและยอดรับแล้ว"></label><button id="pp-invoice-half" type="button">เรียกเก็บ 50% ของออเดอร์</button></div>
       <form id="pp-correction-form" class="pp-form pp-correction" hidden novalidate>
        <h3 id="pp-correction-title">จัดการเอกสารที่ออกผิด</h3>
        <p class="pp-hint">เก็บฉบับเดิมและเหตุผลไว้ตรวจสอบ การยกเลิกนี้ใช้แก้รายการบันทึกผิด ไม่ใช่การคืนเงินจริงหรือการออกใบลดหนี้</p>
        <label class="pp-label">เอกสาร / รายการที่ต้องการแก้ไข<select id="pp-correction-target"></select></label>
        <p id="pp-correction-context" role="status"></p>
        <div id="pp-correction-fields" class="pp-fields">
         <label class="pp-label">ยอดใหม่ (บาท · รวม VAT ถ้ามี)<input id="pp-correction-amount" inputmode="decimal"></label>
         <label class="pp-label">วันที่ฉบับใหม่<input id="pp-correction-date" type="date"></label>
         <label class="pp-label pp-correction-payment">ช่องทาง<select id="pp-correction-method"><option>โอนธนาคาร</option><option>พร้อมเพย์</option><option>เงินสด</option></select></label>
         <label class="pp-label pp-correction-payment">เลขอ้างอิงรับเงิน<input id="pp-correction-reference" maxlength="80"></label>
         <label class="pp-label pp-correction-payment">วันนัดชำระยอดที่เหลือ<input id="pp-correction-due" type="date"></label>
         <label class="pp-label pp-correction-payment">รายละเอียดหลักฐาน (ใช้ไฟล์เดิมถ้ามี)<input id="pp-correction-proof-note" maxlength="180"></label>
        </div>
        <label class="pp-label">เหตุผลที่แก้ไข / ยกเลิก <span aria-hidden="true">*</span><textarea id="pp-correction-reason" rows="3" maxlength="500" required></textarea></label>
        <label class="pp-check"><input id="pp-correction-verified" type="checkbox"><span>ตรวจแล้วว่าเป็นรายการบันทึกผิด หากมีการรับเงินจริง ได้ตรวจยอดและเอกสารที่เกี่ยวข้องแล้ว</span></label>
        <div class="pp-actions pp-correction-actions"><button type="button" id="pp-correction-close">ปิด</button><button type="submit" id="pp-correction-review" class="pp-primary">ตรวจสอบก่อนยืนยัน</button></div>
       </form>
       <article id="pp-paper" class="pp-paper" aria-label="ตัวอย่างเอกสาร"><div class="pp-paper-head"><h3 id="pp-company"></h3><small id="pp-company-address"></small><small id="pp-company-tax"></small></div><h3 id="pp-paper-title"></h3><p id="pp-paper-no"></p><small id="pp-paper-date"></small><p id="pp-paper-customer"></p><div id="pp-paper-items"></div><div id="pp-paper-lines"></div><p id="pp-paper-note" class="pp-paper-note"></p><small id="pp-paper-state"></small></article></section>
     </div>
    </div>`;
    const $=id=>host.querySelector('#'+id);
    const docs=()=>api.getDocuments();
    const root=()=>docs().find(d=>d.docNo===selected);
    function message(text,isError=false){$('pp-message').textContent=text;$('pp-message').classList.toggle('pp-error',isError);}
    function row(label,value){const el=document.createElement('div');el.className='pp-money-row';const a=document.createElement('span'),b=document.createElement('span');a.textContent=label;b.textContent=value;el.append(a,b);return el;}
    function setBusy(value){busy=value;host.querySelectorAll('button,input,select').forEach(el=>{el.disabled=value;});$('pp-order').disabled=value||!!pending;}
    function selectedDoc(){return currentDoc===selected?root():docs().find(d=>d.docNo===currentDoc);}
    function paper(d,draft=false){
        const company=d?.paymentIssuer||api.getCompany();$('pp-company').textContent=company.nameTh||'';$('pp-company-address').textContent=company.addressTh||'';$('pp-company-tax').textContent='เลขผู้เสียภาษี '+(company.taxId||'')+' · สาขา '+(company.branch||'สำนักงานใหญ่');
        if(!d){$('pp-paper-title').textContent='บันทึกส่งมอบโดยไม่ออกใบกำกับเพิ่ม';for(const id of ['pp-paper-no','pp-paper-date','pp-paper-customer','pp-paper-state'])$(id).textContent='';$('pp-paper-items').replaceChildren();$('pp-paper-lines').replaceChildren();$('pp-paper-note').textContent='ออกใบกำกับครบแล้ว หรือใช้โหมดใบเสร็จเท่านั้น';return;}
        $('pp-paper-title').textContent=d.docName||d.prefix;$('pp-paper-no').textContent=draft?'ฉบับร่าง · ยังไม่ออกเลขที่':d.docNo;$('pp-paper-date').textContent='วันที่ '+date(d.inputDate);$('pp-paper-customer').textContent=d.customerName||'';
        $('pp-paper-items').replaceChildren(...(d.items||[]).map(i=>row(i.name+' · '+i.qty+' '+(i.unit||''),money(moneyCents(i.total)))));
        const summary=d.paymentSummary||(d.paymentLedger?{totalCents:d.paymentLedger.totalCents,paidCents:ledgerSummary(d).paid,balanceCents:ledgerSummary(d).balance,dueDate:d.paymentLedger.dueDate}:null);
        const receipt=['advance','receipt'].includes(d.paymentManaged?.kind), pureReceipt=d.paymentManaged?.kind==='receipt';
        const list=[];
        if (!pureReceipt) {list.push(row('มูลค่าก่อนภาษี',money(moneyCents(d.subtotal))));list.push(row('VAT',money(moneyCents(d.vat))));}
        list.push(row(receipt?'รับชำระครั้งนี้':'ยอดเอกสาร',money(moneyCents(d.grandTotal))+' บาท'));
        if(summary){list.push(row('ยอดออเดอร์',money(summary.totalCents)));list.push(row((draft?'หลังยืนยัน · ':'')+'รับสะสม '+pct(summary.paidCents,summary.totalCents),money(summary.paidCents)));list.push(row('ยอดคงเหลือ',money(summary.balanceCents)+' บาท'));list.push(row('วันนัดชำระ',date(summary.dueDate)));}
        $('pp-paper-lines').replaceChildren(...list);$('pp-paper-note').textContent=d.remark||'';$('pp-paper-state').textContent=draft?'ฉบับร่าง · ยังไม่บันทึกรับเงิน':isCancelledRecord(d)?'ยกเลิกแล้ว · '+(d.paymentCancellation?.reason||'')+(d.paymentCancellation?.replacedBy?' · ออกแทนด้วย '+d.paymentCancellation.replacedBy:''):d.paymentManaged?'เอกสารที่ออกแล้ว · ยอดตามวันที่ออกเอกสาร':'ยอดรับชำระล่าสุดของเอกสารต้นทาง';$('pp-paper').classList.toggle('pp-cancelled',isCancelledRecord(d));
    }
    function renderDocuments(r){
        const entries=[r,...(r.paymentLedger?.documents||[]).filter(d=>d.docNo).slice().reverse().map(d=>docs().find(x=>x.docNo===d.docNo)).filter(Boolean)];
        const select=$('pp-document');select.replaceChildren(...entries.map(d=>{const option=document.createElement('option');option.value=d.docNo;option.textContent=d.docNo+' · '+d.docName+(isCancelledRecord(d)?' · ยกเลิกแล้ว':'');return option;}));
        if(pending){const opt=document.createElement('option');opt.value='draft';opt.textContent='ฉบับร่าง · รอยืนยัน';select.append(opt);select.value='draft';paper(pending.preview,true);}else{if(!entries.some(d=>d.docNo===currentDoc))currentDoc=r.docNo;select.value=currentDoc;paper(selectedDoc());}
        $('pp-doc-count').textContent=(entries.length-1)+' ฉบับ';select.disabled=busy||!!pending;$('pp-a4').disabled=busy||!!pending;$('pp-pdf').disabled=busy||!!pending;const inactive=isCancelledRecord(selectedDoc())||isCancelledRecord(r);$('pp-edit-issued').disabled=busy||!!pending||inactive;$('pp-void-issued').disabled=busy||!!pending||inactive;
    }
    function renderHistory(r){const target=$('pp-history');target.replaceChildren();const payments=r.paymentLedger?.payments||[];$('pp-count').textContent=payments.filter(p=>!isCancelledRecord(p)).length+' ครั้ง';if(!payments.length){const p=document.createElement('p');p.className='pp-empty';p.textContent='ยังไม่มีการรับชำระ';target.append(p);}for(const p of payments.slice().reverse()){
        const div=document.createElement('div');div.className='pp-history-row';const line=row('งวดที่ '+p.number+(isCancelledRecord(p)?' · ยกเลิกแล้ว':''),money(p.amountCents)+' บาท');const meta=document.createElement('p');meta.className='pp-hint';meta.textContent=date(p.date)+' · '+p.method+' · '+p.reference;const actions=document.createElement('div');actions.className='pp-actions';
        const open=document.createElement('button');open.type='button';open.textContent='เปิด '+p.docNo;open.disabled=busy||!!pending;open.addEventListener('click',()=>{currentDoc=p.docNo;renderDocuments(r);});
        const proofButton=document.createElement('button');proofButton.type='button';proofButton.textContent='ดูหลักฐาน';proofButton.addEventListener('click',()=>viewProof(p));actions.append(open,proofButton);div.append(line,meta,actions);target.append(div);
    }}
    function render(){if(!alive)return;const r=root();$('pp-selected').hidden=!r;if(!r)return;const s=ledgerSummary(r);$('pp-total').textContent=money(s.total);$('pp-paid').textContent=money(s.paid);$('pp-balance').textContent=money(s.balance);$('pp-ratio').textContent=pct(s.paid,s.total)+' · '+(r.paymentLedger?.payments.filter(p=>!isCancelledRecord(p)).length||0)+' ครั้ง';$('pp-due-label').textContent=r.paymentLedger?(s.balance===0?'ชำระครบแล้ว':(r.paymentLedger.dueDate<api.today()?'เกินกำหนด · ':'นัดชำระ ')+date(r.paymentLedger.dueDate)):'';
        const enabled=!!r.paymentLedger;$('pp-setup').hidden=enabled;$('pp-workspace').hidden=!enabled;if(!enabled)return;
        const l=r.paymentLedger;$('pp-stage').textContent=(l.delivered?'ส่งมอบแล้ว '+date(l.deliveryDate):'ยังไม่ส่งมอบ')+' · '+(l.mode==='domestic-vat7'?'VAT 7%':'ใบเสร็จเท่านั้น');$('pp-deliver').disabled=isCancelledRecord(r)||l.delivered||busy||!!pending;$('pp-deliver').textContent=l.delivered?'บันทึกส่งมอบแล้ว':'บันทึกส่งมอบ / ออกใบกำกับส่วนที่เหลือ';
        $('pp-payment-form').hidden=isCancelledRecord(r)||s.balance===0||!!pending;$('pp-complete').hidden=isCancelledRecord(r)||s.balance!==0||!!pending;$('pp-review').hidden=!pending;$('pp-payment-fields').disabled=busy||!!pending;$('pp-invoice').disabled=isCancelledRecord(r)||busy||!!pending;$('pp-order').disabled=busy||!!pending;
        renderHistory(r);renderDocuments(r);$('pp-correction-form').hidden=!management||!!pending;
    }
    function refresh(){if(!alive)return;const select=$('pp-order');select.replaceChildren(new Option('— เลือกเอกสารต้นทาง —',''),...docs().filter(d=>isPaymentRoot(d)||(d.paymentLedger&&isCancelledRecord(d))).sort((a,b)=>String(b.docNo).localeCompare(String(a.docNo),'en',{numeric:true})).map(d=>new Option(d.docNo+' · '+d.customerName+' · '+money(moneyCents(d.grandTotal)),d.docNo)));select.value=selected;if(!root()){selected='';pending=null;currentDoc='';}render();}
    function resetForm(r){$('pp-payment-form').reset();$('pp-invoice-amount').value='';$('pp-date').value=api.today();$('pp-date').max=api.today();$('pp-due').value=r?.paymentLedger?.dueDate||'';proof=null;fileToken++;reading=false;$('pp-file-label').textContent='เลือกไฟล์ หรือกรอกรายละเอียดหลักฐานด้านล่าง';$('pp-proof-view').hidden=true;}
    function open(orderNo){if(busy||pending){message('กรุณายืนยันหรือกลับไปแก้ไขรายการปัจจุบันก่อน',true);return;}management=null;selected=orderNo||'';currentDoc=selected;refresh();resetForm(root());message(root()?'เลือกวิธีรับเงินและตรวจสอบยอดก่อนยืนยัน':'เลือกเอกสารต้นทางเพื่อดูยอดรับเงินและยอดคงเหลือ');}
    $('pp-order').addEventListener('change',()=>open($('pp-order').value));
    function fillCorrectionTarget(value) {
        const r=root(),entry=r.paymentLedger.documents.find(d=>d.requestId===value),d=entry?docs().find(d=>d.docNo===entry.docNo):r;
        management={...management,targetDocNo:entry?.docNo||r.docNo,targetRequestId:entry?.requestId||'',entry,d};
        const payment=['advance','receipt'].includes(entry?.kind),editable=management.mode==='edit'&&(payment||entry?.kind==='invoice');
        $('pp-correction-fields').hidden=!editable;
        host.querySelectorAll('.pp-correction-payment').forEach(el=>el.hidden=!payment);
        $('pp-correction-title').textContent=management.mode==='edit'?'แก้ไขและออกเอกสารใหม่':'ยกเลิกเอกสารที่ออกผิด';
        $('pp-correction-context').textContent=(entry?.docNo||(!entry?r.docNo:'รายการส่งมอบที่ไม่มีเลขเอกสาร'))+(entry?.kind==='invoice'?' · ไม่เพิ่มหรือลดยอดรับเงินจริง':!entry&&management.mode==='edit'?' · ยกเลิกฉบับเดิม แล้วเปิดข้อมูลให้แก้ไขเป็นเลขใหม่':entry&&management.mode==='edit'&&!editable?' · ยกเลิกการส่งมอบ แล้วออกใหม่จากออเดอร์':' · ระบบจะแสดงผลต่อยอดคงเหลือก่อนยืนยัน');
        $('pp-correction-amount').value=String(d?.grandTotal||0);
        const p=r.paymentLedger.payments.find(p=>p.docNo===entry?.docNo&&!isCancelledRecord(p));
        $('pp-correction-date').value=payment?p?.date||api.today():api.today();$('pp-correction-date').max=api.today();
        $('pp-correction-method').value=p?.method||'โอนธนาคาร';$('pp-correction-reference').value=p?.reference||'';
        $('pp-correction-due').value=r.paymentLedger.dueDate||'';$('pp-correction-proof-note').value=p?.proofName||'';
    }
    function manage(no,mode='cancel') {
        if(busy||pending){message('กรุณายืนยันหรือกลับไปแก้ไขรายการปัจจุบันก่อน',true);return;}
        const d=docs().find(d=>d.docNo===no),r=d?.paymentManaged?docs().find(r=>r.docNo===d.paymentManaged.rootNo):d;
        if(!r?.paymentLedger||isCancelledRecord(d)){message('เอกสารนี้ยกเลิกแล้ว หรือไม่พบเอกสารต้นทาง',true);return;}
        open(r.docNo);currentDoc=no;management={mode,targetDocNo:no};
        const select=$('pp-correction-target');select.replaceChildren(new Option(r.docNo+' · เอกสารต้นทาง','root'),...r.paymentLedger.documents.filter(e=>!isCancelledRecord(e)).map(e=>new Option(e.docNo||'รายการส่งมอบที่ไม่มีเลขเอกสาร',e.requestId)));
        select.value=d.paymentManaged?.requestId||'root';$('pp-correction-reason').value='';$('pp-correction-verified').checked=false;
        fillCorrectionTarget(select.value);render();$('pp-correction-form').scrollIntoView?.({block:'start',behavior:'smooth'});$('pp-correction-reason').focus();
    }
    $('pp-correction-target').addEventListener('change',()=>fillCorrectionTarget($('pp-correction-target').value));
    $('pp-edit-issued').addEventListener('click',()=>manage(currentDoc,'edit'));
    $('pp-void-issued').addEventListener('click',()=>manage(currentDoc,'cancel'));
    $('pp-correction-close').addEventListener('click',()=>{if(!busy){management=null;render();}});
    $('pp-invoice-half').addEventListener('click',()=>{if(root()&&!busy&&!pending)$('pp-invoice-amount').value=String(Math.round(ledgerSummary(root()).total/2)/100);});
    $('pp-correction-form').addEventListener('submit',e=>{
        e.preventDefault();if(!management||busy||pending)return;
        try{
            const r=root(),m=management,payment=['advance','receipt'].includes(m.entry?.kind),replace=m.mode==='edit'&&(payment||m.entry?.kind==='invoice');
            const action={kind:replace?'replace':'cancel',requestId:api.newId(),now:new Date().toISOString(),expectedRevision:r.paymentLedger.revision||0,input:{targetDocNo:m.targetDocNo,targetRequestId:m.targetRequestId,reason:$('pp-correction-reason').value.trim(),verified:$('pp-correction-verified').checked}};
            if(replace)Object.assign(action.input,{replacementKind:payment?'payment':'invoice',amount:$('pp-correction-amount').value,date:$('pp-correction-date').value,method:$('pp-correction-method').value,reference:$('pp-correction-reference').value,dueDate:$('pp-correction-due').value,proofNote:$('pp-correction-proof-note').value});
            const cancelled=cancelPaymentDocument(r,docs(),action.input,{requestId:action.requestId,at:action.now,by:api.getUserId()});
            let preview=null,after=cancelled.summary;
            if(replace){checkParties(r,r.paymentLedger.mode);action.issuer=Object.fromEntries(['nameTh','nameEn','addressTh','addressEn','taxId','branch','phone','email','logo'].map(k=>[k,api.getCompany()[k]||'']));if(payment&&m.d?.paymentProof)action.proof=m.d.paymentProof;
                const posting={...action,kind:action.input.replacementKind},prefix=operationPrefix(cancelled.root,posting),result=applyOperation(cancelled.root,posting,prefix+'-DRAFT',api.today());preview=result.document;after=ledgerSummary({...cancelled.root,paymentLedger:result.ledger});}
            const before=ledgerSummary(r);pending={action,preview:preview||m.d||r};
            $('pp-review-title').textContent=replace?'ตรวจสอบการยกเลิกและออกฉบับใหม่':'ตรวจสอบก่อนยกเลิกเอกสาร';
            $('pp-review-summary').replaceChildren(row('เอกสารเดิม',m.entry?.docNo||r.docNo),row('รับสะสมก่อน',money(before.paid)+' บาท'),row('รับสะสมหลัง',money(after.paid)+' บาท'),row('ยอดคงเหลือหลัง',money(after.balance)+' บาท'),row('เหตุผล',action.input.reason));
            $('pp-confirm').textContent=replace?'ยืนยันยกเลิกและออกใหม่':'ยืนยันยกเลิกเอกสาร';render();$('pp-review').scrollIntoView?.({block:'start',behavior:'smooth'});
        }catch(err){message(err.message,true);}
    });
    $('pp-setup').addEventListener('submit',async e=>{e.preventDefault();if(busy||!root())return;if(!$('pp-setup-verified').checked){message('ตรวจสอบรายการเดิมและทำเครื่องหมายยืนยันก่อน',true);return;}setBusy(true);const id=selected;try{checkParties(root(),$('pp-mode').value);const r=await store.activate(id,$('pp-mode').value,$('pp-setup-due').value);if(!alive)return;api.onSaved({root:r});resetForm(r);message('เปิดรับชำระหลายงวดแล้ว · ยังไม่มีการบันทึกรับเงิน');}catch(err){if(alive)message(err.message,true);}finally{if(alive){setBusy(false);render();}}});
    function checkParties(r,mode) {
        if(api.isCompanyReady && !api.isCompanyReady()) throw new Error('กำลังโหลดข้อมูลบริษัท กรุณารอสักครู่');
        if(mode!=='domestic-vat7') return;
        const c=api.getCompany();
        if(!String(c.nameTh||'').trim() || !String(c.addressTh||'').trim() || !/^\d{13}$/.test(String(c.taxId||'').replace(/[- ]/g,''))) throw new Error('กรอกชื่อ ที่อยู่ และเลขผู้เสียภาษี 13 หลักของผู้ขายในข้อมูลบริษัทก่อนใช้โหมด VAT');
        if(!String(r.customerName||'').trim() || !String(r.customerAddr||'').trim()) throw new Error('เอกสารต้นทางต้องมีชื่อและที่อยู่ผู้ซื้อก่อนใช้โหมด VAT กรุณาสร้างเอกสารต้นทางให้ครบ');
    }
    function startReview(action){
        const r=root();checkParties(r,r.paymentLedger.mode);const prefix=operationPrefix(r,action);action.requestId=api.newId();action.now=new Date().toISOString();action.expectedRevision=r.paymentLedger.revision||0;
        action.issuer=Object.fromEntries(['nameTh','nameEn','addressTh','addressEn','taxId','branch','phone','email','logo'].map(k=>[k,api.getCompany()[k]||'']));
        const result=applyOperation(r,action,prefix?prefix+'-DRAFT':'',api.today());pending={action,preview:result.document};
        $('pp-review-title').textContent=action.kind==='payment'?'ตรวจสอบก่อนรับเงินและออกเอกสาร':action.kind==='delivery'?'ยืนยันส่งมอบและออกเอกสาร':'ยืนยันออกใบแจ้งหนี้';
        $('pp-review-summary').replaceChildren(row('ประเภทเอกสาร',result.document?.docName||'บันทึกส่งมอบ'),row('รับเงินเพิ่ม',money(result.summary.receivedCents)+' บาท'),row('คงเหลือหลังรายการนี้',money(result.summary.balanceCents)+' บาท'));
        $('pp-confirm').textContent=action.kind==='payment'?'ยืนยันรับเงินจริงและออกเอกสาร':'ยืนยันออกเอกสาร / บันทึก';message('ตรวจสอบเอกสารฉบับร่างและยอดเงินก่อนยืนยัน');render();
    }
    $('pp-payment-form').addEventListener('submit',e=>{e.preventDefault();if(busy||pending)return;try{if(reading)throw new Error('กำลังอ่านหลักฐาน กรุณารอสักครู่');startReview({kind:'payment',input:{amount:$('pp-amount').value,date:$('pp-date').value,method:$('pp-method').value,reference:$('pp-reference').value,dueDate:$('pp-due').value,proofNote:$('pp-proof-note').value,verified:$('pp-verified').checked},proof});}catch(err){message(err.message,true);}});
    $('pp-deliver').addEventListener('click',()=>{if(busy||pending||!root())return;try{startReview({kind:'delivery'});}catch(err){message(err.message,true);}});
    $('pp-invoice').addEventListener('click',()=>{if(busy||pending||!root())return;try{startReview({kind:'invoice',input:{amount:$('pp-invoice-amount').value}});}catch(err){message(err.message,true);}});
    $('pp-cancel').addEventListener('click',()=>{if(busy)return;pending=null;render();message('กลับไปแก้ไขแล้ว · ยังไม่บันทึกหรือออกเอกสารเพิ่ม');});
    $('pp-confirm').addEventListener('click',async()=>{if(!pending||busy)return;let copyAfter=null;setBusy(true);try{const wasManagement=management,oldRoot=root();const result=await store.commit(selected,pending.action);if(!alive)return;api.onSaved(result);currentDoc=result.docNo||selected;pending=null;management=null;resetForm(result.root);if(wasManagement?.mode==='edit'&&wasManagement.targetDocNo===oldRoot.docNo&&result.root.status==='cancelled')copyAfter=result.root;message(result.root.status==='cancelled'?'ยกเลิกเอกสารต้นทางแล้ว · เก็บประวัติเดิมไว้':result.corrected&&!result.docNo?'ยกเลิกเอกสารแล้ว · ปรับยอดคงเหลือเรียบร้อย':result.docNo?'บันทึกสำเร็จ · ออก '+result.docNo:'บันทึกส่งมอบสำเร็จ · ไม่เพิ่มยอดรับเงิน');}catch(err){if(alive)message(err.code==='permission-denied'?'บันทึกไม่ได้: บัญชีนี้ไม่มีสิทธิ์เขียนข้อมูล กรุณาตรวจสิทธิ์ Firebase โดยไม่เปิดให้บุคคลทั่วไป':err.message,true);}finally{if(alive){setBusy(false);render();}}if(copyAfter&&alive)api.editCopy?.(copyAfter);});
    $('pp-fill').addEventListener('click',()=>{if(root()&&!busy)$('pp-amount').value=String(ledgerSummary(root()).balance/100);});
    $('pp-document').addEventListener('change',()=>{currentDoc=$('pp-document').value;renderDocuments(root());});
    $('pp-a4').addEventListener('click',()=>{if(!pending&&!busy&&selectedDoc())api.preview(currentDoc);});
    $('pp-pdf').addEventListener('click',()=>{if(!pending&&!busy&&selectedDoc())api.download(currentDoc);});
    $('pp-file').addEventListener('change',()=>{const file=$('pp-file').files?.[0],token=++fileToken;proof=null;reading=false;if(!file)return;
        if(!['image/png','image/jpeg','application/pdf'].includes(file.type)||file.size>500*1024||file.size===0){$('pp-file').value='';$('pp-file-label').textContent='ไฟล์ไม่ถูกต้อง';message('หลักฐานต้องเป็น PNG/JPG/PDF ไม่เกิน 500 KB',true);return;}
        reading=true;$('pp-file-label').textContent='กำลังอ่าน '+file.name;const reader=new FileReader();reader.onload=()=>{if(!alive||token!==fileToken)return;reading=false;proof={name:file.name.slice(0,180),type:file.type,data:String(reader.result)};$('pp-file-label').textContent=file.name;};reader.onerror=()=>{if(!alive||token!==fileToken)return;reading=false;message('อ่านหลักฐานไม่สำเร็จ กรุณาเลือกใหม่',true);};reader.readAsDataURL(file);
    });
    function viewProof(p){const d=docs().find(x=>x.docNo===p.docNo),body=$('pp-proof-content');body.replaceChildren(row('ยอดรับเงิน',money(p.amountCents)+' บาท'),row('วันที่',date(p.date)),row('เลขอ้างอิง',p.reference));const details=document.createElement('p');details.textContent=p.proofName;body.append(details);const file=d?.paymentProof;if(file&&/^data:image\/(png|jpeg);base64,/.test(file.data)){const img=document.createElement('img');img.src=file.data;img.alt='หลักฐานรับเงิน '+p.docNo;body.append(img);}else if(file&&/^data:application\/pdf;base64,/.test(file.data)){const a=document.createElement('a');a.href=file.data;a.download=file.name;a.textContent='ดาวน์โหลดหลักฐาน PDF';body.append(a);}$('pp-proof-view').hidden=false;}
    $('pp-close-proof').addEventListener('click',()=>{$('pp-proof-view').hidden=true;});
    refresh();return {refresh,open,manage,destroy(){alive=false;fileToken++;host.replaceChildren();},get busy(){return busy;},get pending(){return !!pending||!!management;}};
}
