export const PAYMENT_METHODS = Object.freeze({cash:'เงินสด',bank:'โอนผ่านธนาคาร',mixed:'รับเงินสดและผ่านธนาคาร'});
export const SIGNER_TITLES = Object.freeze(['กรรมการผู้จัดการ','ผู้จัดการทั่วไป']);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (value,max=200) => { const s=String(value??'').trim(); if(s.length>max)throw new Error('ข้อความยาวเกินกำหนด'); return s; };
const normalize = value => String(value??'').normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/g,'');
export function eligibleEmployee(e) { return !!e?.id && !!String(e.name??'').trim() && ['active','leave'].includes(e.status); }
export function eligibleSigner(e) { return eligibleEmployee(e) && SIGNER_TITLES.some(title=>normalize(e.position)===normalize(title)); }
export function moneySatang(value,allowZero=true) {
    const s=String(value??'').trim();
    if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s))throw new Error('ระบุจำนวนเงินเป็นตัวเลข ไม่เกิน 2 ตำแหน่งทศนิยม');
    const [whole,fraction='']=s.split('.'); const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(!Number.isSafeInteger(n) || (!allowZero&&n<=0))throw new Error('เงินเดือนพื้นฐานต้องมากกว่า 0');
    return n;
}
export const amountText = satang => (satang/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
export function validDate(value) { if(!/^\d{4}-\d{2}-\d{2}$/.test(value??''))return false; const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value; }
export function thaiDate(value) { if(!validDate(value))return '—'; return new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(value+'T00:00:00Z')); }
export function companySnapshot(source) {
    const c={}; for(const field of ['nameTh','nameEn','addressTh','phone','email','taxId','branch'])c[field]=text(source?.[field],field==='addressTh'?600:200);
    c.logo='';
    if(source?.logo) {
        if(typeof source.logo!=='string')throw new Error('รูปแบบโลโก้บริษัทไม่ถูกต้อง');
        if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(source.logo))throw new Error('โลโก้ต้องเป็นไฟล์ PNG, JPEG หรือ WebP ที่บันทึกในข้อมูลบริษัท');
        if(source.logo.length>650000)throw new Error('โลโก้มีขนาดใหญ่เกินไป กรุณาย่อไฟล์ในข้อมูลบริษัท');
        c.logo=source.logo;
    }
    return c;
}
export function blankDraft(today) { return {employeeId:'',issueDate:today,purpose:'',recipient:'',rateUnit:'month',baseSalary:'',allowances:[],paymentMethod:'',cashAmount:'',bankAmount:'',signerId:'',reviewed:false}; }
export function createContent(draft,{employees,company,today}) {
    if(!validDate(today)||!validDate(draft.issueDate)||draft.issueDate>today)throw new Error('วันที่ออกหนังสือต้องเป็นวันที่ถูกต้องและไม่เกินวันนี้');
    const e=employees.find(e=>e.id===draft.employeeId), signer=employees.find(e=>e.id===draft.signerId);
    if(!eligibleEmployee(e))throw new Error('กรุณาเลือกพนักงานที่ยังปฏิบัติงานจากฐานข้อมูล');
    if(!text(e.position))throw new Error('กรุณาเพิ่มตำแหน่งของพนักงานในฐานข้อมูล');
    if(!validDate(e.joinDate)||e.joinDate>draft.issueDate)throw new Error('กรุณาตรวจวันที่เริ่มงานในฐานข้อมูลพนักงาน');
    if(!eligibleSigner(signer))throw new Error('เลือกผู้รับรองตำแหน่ง กรรมการผู้จัดการ หรือ ผู้จัดการทั่วไป ที่ยังปฏิบัติงาน');
    if(!Object.hasOwn(PAYMENT_METHODS,draft.paymentMethod))throw new Error('กรุณาเลือกช่องทางรับเงิน');
    if(!['month','day'].includes(draft.rateUnit))throw new Error('กรุณาเลือกอัตรารายเดือนหรือรายวัน');
    const purpose=text(draft.purpose,240); if(!purpose)throw new Error('กรุณาระบุวัตถุประสงค์');
    const c=companySnapshot(company); if(!c.nameTh||!c.addressTh)throw new Error('กรุณาบันทึกชื่อและที่อยู่บริษัทก่อนออกหนังสือ');
    const baseSatang=moneySatang(draft.baseSalary,false);
    if(!Array.isArray(draft.allowances)||draft.allowances.length>5)throw new Error('เพิ่มรายได้ประจำอื่นได้ไม่เกิน 5 รายการ');
    const allowances=draft.allowances.map(a=>{const label=text(a.label,80);const amountSatang=moneySatang(a.amount);if(!label)throw new Error('กรุณาระบุชื่อรายได้ประจำอื่น');return {label,amountSatang};});
    const totalSatang=allowances.reduce((s,a)=>s+a.amountSatang,baseSatang);
    const content={version:1,company:c,employee:{id:e.id,code:text(e.code,80),name:text(e.name),position:text(e.position),joinDate:e.joinDate},signer:{id:signer.id,name:text(signer.name),position:SIGNER_TITLES.find(t=>normalize(t)===normalize(signer.position))},issueDate:draft.issueDate,purpose,recipient:text(draft.recipient,200),rateUnit:draft.rateUnit,baseSatang,allowances,totalSatang,paymentMethod:draft.paymentMethod};
    if(draft.paymentMethod==='mixed') {
        const read=(value,label)=>{try{const amount=moneySatang(value);if(amount<=0)throw new Error();return amount;}catch{throw new Error(`กรุณาระบุยอด${label}มากกว่า 0 บาท และไม่เกิน 2 ตำแหน่งทศนิยม`);}};
        content.paymentSplit={cashSatang:read(draft.cashAmount,'รับเงินสด'),bankSatang:read(draft.bankAmount,'รับผ่านธนาคาร')};
    }
    return content;
}
export function paymentSplitFor(content) {
    if(content.paymentMethod!=='mixed')return null;
    const split=content.paymentSplit;
    if(!split||![split.cashSatang,split.bankSatang].every(amount=>Number.isSafeInteger(amount)&&amount>0))throw new Error('ข้อมูลยอดรับเงินสดและผ่านธนาคารไม่ครบหรือไม่ถูกต้อง');
    return {cashSatang:split.cashSatang,bankSatang:split.bankSatang};
}
export function sourceStamp({employees,company},draft) {
    const e=employees.find(e=>e.id===draft.employeeId),s=employees.find(e=>e.id===draft.signerId);
    const fields=e=>e?{id:e.id,name:e.name??'',code:e.code??'',position:e.position??'',joinDate:e.joinDate??'',status:e.status??'',salary:e.salary??null}:null;
    return JSON.stringify({company:companySnapshot(company),employee:fields(e),signer:fields(s)});
}
export function certificateNumber(date,sequence) { if(!validDate(date)||!Number.isSafeInteger(sequence)||sequence<1||sequence>9999)throw new Error('เลขลำดับหนังสือไม่ถูกต้อง'); return `NASC-${Number(date.slice(0,4))+543}-${String(sequence).padStart(4,'0')}`; }

// Firestore map field order can differ between devices and server reads.
export function sameCertificateContent(left,right) {
    const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
    return JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
}
