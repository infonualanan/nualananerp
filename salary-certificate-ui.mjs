import {blankDraft,eligibleEmployee,eligibleSigner,createContent,sourceStamp,escapeHtml as h,amountText,thaiDate,PAYMENT_METHODS,sameCertificateContent,paymentSplitFor} from './salary-certificate-core.mjs';
import {createSalaryIssuer} from './salary-certificate-firestore.mjs';
import {certificateHtml,openCertificatePrint} from './salary-certificate-print.mjs';
export function createSalaryCertificateController(host,adapter) {
    const uid=adapter.getUserId(); let draft=blankDraft(adapter.today()),records=[],view='create',selected=null,busy=false,attempt=null,alive=true,loadError='',notice='',historyReady=false,previewUrl=null,attemptStarted=false;
    if(adapter.initialDraft)draft={...draft,...structuredClone(adapter.initialDraft)};
    const issue=createSalaryIssuer(adapter);
    const sources=()=>({employees:adapter.getEmployees(),company:adapter.getCompany(),today:adapter.today()});
    const ready=()=>alive&&adapter.getUserId()===uid;
    const selection=(value,current)=>value===current?' selected':'';
    const options=(list,current)=>list.map(e=>`<option value="${h(e.id)}"${selection(e.id,current)}>${h(e.name)} · ${h(e.position)}</option>`).join('');
    function capture() { if(!adapter.isReady())throw new Error('กำลังโหลดข้อมูลบริษัทและพนักงาน กรุณารอสักครู่');return createContent(draft,sources()); }
    function error(message) { notice=message;const box=host.querySelector('[data-notice]');if(box){box.textContent=message;box.hidden=!message;} }
    function updatePreview(record=null) {
        const frame=host.querySelector('[data-preview]'), hint=host.querySelector('[data-preview-hint]');if(!frame)return;
        try {
            const model=record||{content:capture()};
            if(previewUrl)URL.revokeObjectURL(previewUrl);
            previewUrl=URL.createObjectURL(new Blob([certificateHtml(model,{draft:!model.number,demo:!!adapter.demo})],{type:'text/html'}));
            frame.src=previewUrl;frame.hidden=false;hint.hidden=true;
        } catch(e) { frame.hidden=true;hint.hidden=false;hint.textContent=e.message; }
    }
    function formHtml() {
        const all=adapter.getEmployees(),employees=all.filter(eligibleEmployee),signers=all.filter(eligibleSigner),e=all.find(e=>e.id===draft.employeeId);
        return `<div class="sc-layout"><form class="sc-card" data-form><h2>ข้อมูลหนังสือรับรอง</h2><p class="sc-muted">ดึงชื่อ ตำแหน่ง และวันที่เริ่มงานจากฐานข้อมูลพนักงาน</p><label>พนักงาน<select data-field="employeeId" required><option value="">— เลือกพนักงาน —</option>${options(employees,draft.employeeId)}</select></label>${e?`<div class="sc-info"><strong>${h(e.position)}</strong><br>เริ่มงาน ${h(thaiDate(e.joinDate))}</div>`:''}<div class="sc-fields"><label>วันที่ออก<input data-field="issueDate" type="date" value="${h(draft.issueDate)}" max="${adapter.today()}" required></label><label>อัตรารายได้<select data-field="rateUnit"><option value="month"${selection('month',draft.rateUnit)}>รายเดือน</option><option value="day"${selection('day',draft.rateUnit)}>รายวัน</option></select></label></div><label>เรียน / ผู้รับหนังสือ <span class="sc-muted">(ถ้ามี)</span><input data-field="recipient" value="${h(draft.recipient)}" maxlength="200" placeholder="เช่น ธนาคาร / ผู้เกี่ยวข้อง"></label><label>วัตถุประสงค์<textarea data-field="purpose" rows="2" maxlength="240" required placeholder="เช่น ใช้ประกอบการขอสินเชื่อ">${h(draft.purpose)}</textarea></label><h3>รายได้ประจำก่อนรายการหัก</h3><label>${draft.rateUnit==='day'?'ค่าจ้างพื้นฐาน':'เงินเดือนพื้นฐาน'} (บาท / ${draft.rateUnit==='day'?'วัน':'เดือน'})<input data-field="baseSalary" inputmode="decimal" type="number" min="0.01" step="0.01" value="${h(draft.baseSalary)}" required></label><p class="sc-muted">ตรวจยอดและหน่วยกับข้อมูลจริงก่อนออกหนังสือ การแก้ยอดที่นี่ใช้เฉพาะหนังสือฉบับนี้</p><div data-allowances>${draft.allowances.map((a,i)=>`<div class="sc-allowance"><label>รายได้ประจำอื่น ${i+1}<input data-allow="${i}" data-kind="label" maxlength="80" value="${h(a.label)}" placeholder="เช่น ค่าตำแหน่ง"></label><label>บาท / ${draft.rateUnit==='day'?'วัน':'เดือน'}<input data-allow="${i}" data-kind="amount" type="number" inputmode="decimal" min="0" step="0.01" value="${h(a.amount)}"></label><button type="button" data-remove="${i}" class="sc-small" aria-label="ลบรายได้ประจำอื่น ${i+1}">ลบ</button></div>`).join('')}</div><button type="button" data-action="add" class="sc-secondary" ${draft.allowances.length>=5?'disabled':''}>＋ เพิ่มรายได้ประจำอื่น</button><p class="sc-muted">เพิ่มเฉพาะรายได้ประจำที่รับรองได้ ไม่รวม OT หรือโบนัสที่ไม่แน่นอน</p><fieldset><legend>ช่องทางรับเงิน <span class="sc-required">*</span></legend>${Object.entries(PAYMENT_METHODS).map(([key,label])=>`<label class="sc-radio"><input type="radio" name="sc-payment" data-field="paymentMethod" value="${key}" ${draft.paymentMethod===key?'checked':''}>${label}</label>`).join('')}${draft.paymentMethod==='mixed'?`<div class="sc-fields sc-payment-fields"><label>รับเงินสด (บาท / ${draft.rateUnit==='day'?'วัน':'เดือน'})<input data-field="cashAmount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${h(draft.cashAmount)}" required></label><label>รับผ่านธนาคาร (บาท / ${draft.rateUnit==='day'?'วัน':'เดือน'})<input data-field="bankAmount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${h(draft.bankAmount)}" required></label></div><p class="sc-muted">กรอกยอดรับจริงของแต่ละช่องทาง แยกจากรายได้ก่อนรายการหักด้านบน</p>`:''}</fieldset><label>ผู้รับรอง<select data-field="signerId" required><option value="">— เลือกผู้รับรอง —</option>${options(signers,draft.signerId)}</select></label>${!signers.length?`<div class="sc-warning">ยังไม่มีพนักงานตำแหน่ง กรรมการผู้จัดการ หรือ ผู้จัดการทั่วไป ที่ยังปฏิบัติงาน กรุณาเพิ่มชื่อจริงและตำแหน่งในฐานข้อมูลพนักงาน</div>`:''}<button type="button" class="sc-link" data-action="employees">เปิดฐานข้อมูลพนักงานเพื่อเพิ่ม / แก้ไขผู้รับรอง</button><p class="sc-muted">ระบบใส่ชื่อและตำแหน่งในเอกสาร ผู้รับรองต้องลงนามจริง การเลือกชื่อไม่ได้เป็นการเซ็นหรืออนุมัติแทนบุคคลนั้น</p><label class="sc-review"><input type="checkbox" data-field="reviewed" ${draft.reviewed?'checked':''}>ฉันตรวจสอบรายได้ ช่องทางรับเงิน และผู้รับรองถูกต้องแล้ว</label></form><section class="sc-card sc-preview-card"><div class="sc-preview-title"><h2>ตัวอย่างเอกสาร A4</h2><span class="sc-badge">ฉบับร่าง</span></div><p class="sc-muted">เลขที่หนังสือจะสร้างอัตโนมัติเมื่อบันทึกสำเร็จ</p><p data-preview-hint class="sc-info"></p><iframe data-preview title="ตัวอย่างหนังสือรับรองเงินเดือน A4" sandbox="allow-same-origin allow-scripts allow-modals allow-popups" hidden></iframe></section></div><div class="sc-actions"><span>เก็บสำเนาข้อมูล ณ วันออก พร้อมประวัติหนังสือ</span><button data-action="draft-print" class="sc-secondary" type="button">พิมพ์ฉบับร่าง / PDF</button><button data-action="review" class="sc-primary" type="button">ตรวจทานและออกหนังสือ</button></div>`;
    }
    function historyHtml() {
        return `<section class="sc-card"><h2>ประวัติหนังสือรับรอง</h2><p class="sc-muted">เปิดสำเนาที่บันทึกไว้ ณ วันออกหนังสือ แม้ข้อมูลพนักงานหรือบริษัทเปลี่ยนภายหลัง</p>${!historyReady?'<p>กำลังโหลดประวัติ…</p>':!records.length?'<p class="sc-info">ยังไม่มีหนังสือที่ออก</p>':`<div class="sc-history">${[...records].sort((a,b)=>b.number.localeCompare(a.number)).map(r=>`<button type="button" class="sc-history-row" data-record="${h(r.id)}"><div><strong>${h(r.number)}</strong><span>${h(r.content?.employee?.name)} · ${h(thaiDate(r.content?.issueDate))}</span></div><span class="sc-badge">ออกแล้ว / รอลงนาม</span></button>`).join('')}</div>`}</section>${selected?`<section class="sc-card sc-saved-preview"><div class="sc-preview-title"><h2>${h(selected.number)}</h2><button type="button" data-action="saved-print" class="sc-primary">พิมพ์ / PDF ฉบับที่บันทึก</button></div><p data-preview-hint></p><iframe data-preview title="หนังสือรับรองที่บันทึกแล้ว" sandbox="allow-same-origin allow-scripts allow-modals allow-popups"></iframe></section>`:''}`;
    }
    function render() {
        if(!ready())return;
        host.innerHTML=`<div class="sc-workspace"><div class="sc-heading"><div><p class="sc-eyebrow">HR · เอกสารรับรองพนักงาน</p><h1>หนังสือรับรองเงินเดือน</h1><p class="sc-muted">ฟอร์มบริษัท · รายได้แยกชัดเจน · เลือกช่องทางรับเงินและผู้รับรอง</p></div><span class="sc-badge">${adapter.demo?'ข้อมูลสมมติ':'ข้อมูลพนักงานภายในบัญชีนี้'}</span></div>${adapter.demo?'<div class="sc-demo-banner">DEMO · ข้อมูลสมมติ ไม่บันทึกฐานข้อมูลจริง และไม่ใช่เอกสารใช้งานจริง</div>':''}<div class="sc-tabs"><button type="button" data-view="create" aria-pressed="${view==='create'}">ออกหนังสือใหม่</button><button type="button" data-view="history" aria-pressed="${view==='history'}">ประวัติหนังสือ (${records.length})</button></div><div class="sc-warning" role="alert" data-notice ${!notice&&!loadError?'hidden':''}>${h(loadError||notice)}</div>${view==='create'?formHtml():historyHtml()}<dialog class="sc-dialog" aria-labelledby="sc-confirm-title"><h2 id="sc-confirm-title">ตรวจทานก่อนออกหนังสือ</h2><div data-confirm-summary></div><p data-confirm-error role="alert" class="sc-warning" hidden></p><p class="sc-muted">เมื่อบันทึกแล้ว จะเก็บสำเนาข้อมูลชุดนี้และออกเลขที่หนังสือ การลงนามทำโดยผู้รับรองในเอกสาร</p><div class="sc-dialog-actions"><button type="button" data-action="back" class="sc-secondary">กลับไปแก้ไข</button><button type="button" data-action="issue" class="sc-primary">ยืนยันออกหนังสือ</button></div></dialog></div>`;
        updatePreview(view==='history'?selected:null);
    }
    function markChanged() {draft.reviewed=false;const cb=host.querySelector('[data-field="reviewed"]');if(cb)cb.checked=false;notice='';error('');}
    function handleInput(event) {
        const el=event.target,field=el.dataset.field;
        if(!ready()||busy||attempt)return;
        if(field) {
            if(field==='reviewed'){draft.reviewed=el.checked;return;}
            draft[field]=el.value;markChanged();
            if(field==='employeeId') {draft.cashAmount='';draft.bankAmount='';const employee=adapter.getEmployees().find(e=>e.id===el.value);draft.baseSalary=Number(employee?.salary)>0?String(employee.salary):'';render();return;}
            if(field==='rateUnit') {draft.baseSalary='';draft.allowances=[];draft.cashAmount='';draft.bankAmount='';error('กรุณาระบุยอดตามอัตราที่เลือก ระบบไม่แปลงรายวันเป็นรายเดือนให้อัตโนมัติ');render();return;}
            if(field==='paymentMethod'){render();return;}
            if(['signerId'].includes(field)){updatePreview();return;}
        } else if(el.dataset.allow!==undefined) {const a=draft.allowances[Number(el.dataset.allow)];if(a)a[el.dataset.kind]=el.value;markChanged();}
        updatePreview();
    }
    function confirmation(request) {
        const c=request.content,dialog=host.querySelector('dialog'),split=paymentSplitFor(c);
        host.querySelector('[data-confirm-summary]').innerHTML=`<p><strong>${h(c.employee.name)}</strong><br>${h(c.employee.position)}</p><div class="sc-info">พื้นฐาน ${amountText(c.baseSatang)} บาท<br>รายได้ประจำอื่น ${amountText(c.totalSatang-c.baseSatang)} บาท<br><strong>รวมรายได้ก่อนหัก ${amountText(c.totalSatang)} บาท / ${c.rateUnit==='day'?'วัน':'เดือน'}</strong><br>ช่องทางรับเงิน: ${h(PAYMENT_METHODS[c.paymentMethod])}${split?`<br>รับเงินสด ${amountText(split.cashSatang)} บาท<br>รับผ่านธนาคาร ${amountText(split.bankSatang)} บาท`:''}<br>ผู้รับรอง ${h(c.signer.name)} · ${h(c.signer.position)}</div>`;
        if(!dialog.open)dialog.showModal();
    }
    async function handleClick(event) {
        const button=event.target.closest('button');if(!button||!ready())return;
        const action=button.dataset.action;
        try {
            if(button.dataset.view){if(busy||attempt)return;view=button.dataset.view;notice='';render();return;}
            if(button.dataset.record){selected=records.find(r=>r.id===button.dataset.record);render();return;}
            if(busy)return;
            if(button.dataset.remove!==undefined){draft.allowances.splice(Number(button.dataset.remove),1);markChanged();render();return;}
            if(action==='add'){if(draft.allowances.length<5)draft.allowances.push({label:'',amount:''});markChanged();render();}
            if(action==='employees'){adapter.openEmployees();}
            if(action==='draft-print')openCertificatePrint({content:capture()},{draft:true,demo:!!adapter.demo},adapter.window||window);
            if(action==='saved-print'&&selected)openCertificatePrint(selected,{demo:!!adapter.demo},adapter.window||window);
            if(action==='review') {
                const content=capture();if(!draft.reviewed)throw new Error('กรุณายืนยันการตรวจทานข้อมูลก่อนออกหนังสือ');
                attempt={uid,id:adapter.newId(),draft:structuredClone(draft),content,sourceStamp:sourceStamp(sources(),draft)};
                confirmation(attempt);
            }
            if(action==='back'){
                if(attemptStarted){
                    busy=true;button.disabled=true;
                    try {
                        const snap=await adapter.getDocFromServer(adapter.userDoc('hr_salary_certificates',attempt.id));
                        if(!ready())return;
                        if(snap.exists()){
                            const record={...snap.data(),id:attempt.id};
                            if(!sameCertificateContent(record.content,attempt.content))throw new Error('ข้อมูลคำขอต่างกัน กรุณาตรวจประวัติ');
                            if(!records.some(r=>r.id===record.id))records.push(record);
                            selected=record;view='history';historyReady=true;draft=blankDraft(adapter.today());notice=`พบหนังสือ ${record.number} ที่บันทึกสำเร็จแล้ว`;
                        }
                        attempt=null;attemptStarted=false;render();
                    }catch(e){if(ready()){const box=host.querySelector('[data-confirm-error]');box.hidden=false;box.textContent='ยังตรวจผลคำขอเดิมไม่ได้: '+e.message+' กรุณาเชื่อมต่อแล้วลองอีกครั้ง';}}
                    finally{busy=false;if(ready()){const b=host.querySelector('[data-action="back"]');if(b)b.disabled=false;}}
                }else{attempt=null;host.querySelector('dialog').close();}
            }
            if(action==='issue'&&attempt) {
                busy=true;attemptStarted=true;button.disabled=true;const back=host.querySelector('[data-action="back"]');back.disabled=true;
                const err=host.querySelector('[data-confirm-error]');err.hidden=true;
                try {
                    const record=await issue(attempt);if(!ready())return;
                    if(!records.some(r=>r.id===record.id))records.push(record);
                    historyReady=true;selected=record;attempt=null;attemptStarted=false;view='history';draft=blankDraft(adapter.today());notice=`บันทึก ${record.number} แล้ว กรุณาให้ผู้รับรองลงนามก่อนใช้งาน`;render();
                } catch(e) {
                    if(!ready())return;err.hidden=false;err.textContent=`${e.message} หากการเชื่อมต่อขาด สามารถกดยืนยันซ้ำด้วยคำขอเดิม ระบบจะไม่ออกหนังสือซ้ำ กรุณาตรวจประวัติก่อนเริ่มหนังสือใหม่`;
                } finally {busy=false;if(ready()){const b=host.querySelector('[data-action="issue"]');if(b)b.disabled=false;const b2=host.querySelector('[data-action="back"]');if(b2)b2.disabled=false;}}
            }
        } catch(e){error(e.message);}
    }
    const changeHandler=event=>{if(event.target.tagName==='SELECT'||event.target.type==='radio')handleInput(event);};host.addEventListener('change',changeHandler);
    const inputHandler=event=>{if(event.target.tagName!=='SELECT'&&event.target.type!=='radio')handleInput(event);};host.addEventListener('input',inputHandler);
    host.addEventListener('click',handleClick);
    const submitHandler=event=>event.preventDefault();host.addEventListener('submit',submitHandler);
    const cancelHandler=event=>{if(event.target.tagName==='DIALOG'){event.preventDefault();if(!busy&&!attemptStarted){attempt=null;event.target.close();}}};host.addEventListener('cancel',cancelHandler,true);
    const stop=adapter.watchRecords(next=>{if(!ready())return;records=next;historyReady=true;loadError='';if(view==='history'){if(selected)selected=records.find(r=>r.id===selected.id)||selected;if(!busy&&!attempt)render();}else{const tab=host.querySelector('[data-view="history"]');if(tab)tab.textContent=`ประวัติหนังสือ (${records.length})`;}},()=>{if(!ready())return;loadError='โหลดประวัติหนังสือไม่สำเร็จ กรุณาเปิดหน้านี้ใหม่';error(loadError);});
    render();
    return {open(){render();},refresh(){if(!busy&&!attempt)render();},get busy(){return busy;},get pending(){return !!attempt;},destroy(){alive=false;stop?.();if(previewUrl)URL.revokeObjectURL(previewUrl);host.removeEventListener('input',inputHandler);host.removeEventListener('change',changeHandler);host.removeEventListener('click',handleClick);host.removeEventListener('submit',submitHandler);host.removeEventListener('cancel',cancelHandler,true);host.innerHTML='';draft=null;records=[];selected=null;attempt=null;}};
}
