// All money in this module is integer satang. It never calls Firebase or mutates inputs.
export const ROOT_TYPES = ['SO', 'INV'];
const clone = value => JSON.parse(JSON.stringify(value));
export function moneyCents(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('จำนวนเงินไม่ถูกต้อง');
        const cents = Math.round((value + Number.EPSILON) * 100);
        if (!Number.isSafeInteger(cents)) throw new Error('จำนวนเงินเกินขอบเขต');
        return cents;
    }
    const text = String(value ?? '').trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) throw new Error('กรอกจำนวนเงินและทศนิยมไม่เกิน 2 ตำแหน่ง');
    const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents)) throw new Error('จำนวนเงินเกินขอบเขต');
    return cents;
}
export function validDate(value) {
    const d = new Date(String(value) + 'T00:00:00Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function paidCents(ledger) { return (ledger?.payments || []).reduce((sum, p) => sum + p.amountCents, 0); }
export function ledgerSummary(root) {
    const total = root.paymentLedger?.totalCents ?? moneyCents(root.grandTotal);
    const paid = paidCents(root.paymentLedger);
    return {total, paid, balance: total - paid, percent: total ? paid / total * 100 : 0};
}
export function isPaymentRoot(d) { return ROOT_TYPES.includes(d.prefix) && !d.paymentManaged && (d.currency || 'THB') === 'THB' && Number(d.grandTotal) > 0; }
export function relatedLegacyDocuments(root, documents) {
    const visited = new Set([root.docNo]);
    let changed = true;
    const edges = documents.filter(d => !d.paymentManaged).map(d => [d.docNo, ...String(d.refDocManual || '').split(',').map(x => x.trim()).filter(Boolean)]);
    while (changed) { changed = false; for (const edge of edges) if (edge.some(id => visited.has(id))) for (const id of edge) if (!visited.has(id)) { visited.add(id); changed = true; } }
    return documents.filter(d => d.docNo !== root.docNo && visited.has(d.docNo) && ['RE', 'RETAX', 'TINV', 'ABB', 'RV', 'EVAT', 'CI', 'DO'].includes(d.prefix));
}
function assertRoot(root) {
    if (!isPaymentRoot(root)) throw new Error('เลือกรายการใบสั่งขายหรือใบแจ้งหนี้สกุล THB');
    if (root.paymentLedger && root.paymentLedger.totalCents !== moneyCents(root.grandTotal)) throw new Error('ยอดเอกสารเปลี่ยน กรุณาตรวจสอบกับผู้ดูแลก่อนรับเงิน');
    if (root.paymentLedger && root.paymentLedger.version !== 1) throw new Error('เวอร์ชันรายการชำระเงินไม่รองรับ');
}
export function createLedger(root, mode, dueDate, today, documents = []) {
    assertRoot(root);
    if (root.paymentLedger) return clone(root.paymentLedger);
    if (relatedLegacyDocuments(root, documents).length) throw new Error('มีใบรับเงิน ใบกำกับ หรือใบส่งของเดิมอ้างอิงอยู่ ต้องกระทบยอดเดิมก่อนเปิดรับชำระหลายงวด');
    if (!['receipt', 'domestic-vat7'].includes(mode)) throw new Error('เลือกวิธีออกเอกสารก่อน');
    if (!validDate(dueDate) || dueDate < today) throw new Error('กำหนดวันนัดชำระให้ไม่ก่อนวันนี้');
    const total = moneyCents(root.grandTotal), net = mode === 'domestic-vat7' ? Math.round(total * 100 / 107) : total;
    if (mode === 'domestic-vat7' && (Math.abs(moneyCents(root.subtotal) - net) > 1 || Math.abs(moneyCents(root.vat) - (total - net)) > 1 || Math.abs((root.items || []).reduce((sum,i)=>sum+moneyCents(i.total),0)-total)>1)) throw new Error('ยอดต้นทางต้องรวม VAT 7% เต็มทั้งออเดอร์ หากมีสินค้ายกเว้นภาษี ให้ใช้รับเงิน/ใบเสร็จอย่างเดียว');
    return {version:1, mode, totalCents:total, netCents:net, vatCents:total-net, dueDate, dueHistory:[{date:today,dueDate}], delivered:false, deliveryDate:'', payments:[], documents:[]};
}
function assertLedger(root) {
    assertRoot(root);
    const ledger = root.paymentLedger;
    if (!ledger) throw new Error('เปิดใช้งานรับชำระหลายงวดสำหรับเอกสารนี้ก่อน');
    const paid = paidCents(ledger);
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > ledger.totalCents) throw new Error('ยอดรับชำระสะสมผิดปกติ กรุณาตรวจสอบก่อน');
    return ledger;
}
export function validatePayment(root, input, today) {
    const l = assertLedger(root), amount = moneyCents(input.amount);
    if (amount <= 0 || amount > l.totalCents - paidCents(l)) throw new Error('ยอดรับเงินต้องมากกว่า 0 และไม่เกินยอดคงเหลือ');
    const last = l.payments.at(-1)?.date || String(root.inputDate || '').slice(0,10);
    if (!validDate(input.date) || input.date > today || (last && input.date < last) || (l.delivered && input.date < l.deliveryDate)) throw new Error('วันที่รับเงินต้องไม่ก่อนเอกสาร/งวดล่าสุด/วันส่งมอบ และไม่เป็นวันในอนาคต');
    const reference = String(input.reference || '').normalize('NFKC').trim();
    if (!reference || reference.length > 80) throw new Error('กรอกเลขอ้างอิงรับเงินไม่เกิน 80 ตัวอักษร');
    if (l.payments.some(p => p.reference.normalize('NFKC').toUpperCase() === reference.toUpperCase())) throw new Error('เลขอ้างอิงรับเงินนี้ใช้แล้ว กรุณาตรวจสอบรายการซ้ำ');
    if (!['โอนธนาคาร','พร้อมเพย์','เงินสด'].includes(input.method)) throw new Error('เลือกช่องทางรับเงิน');
    if (!input.verified) throw new Error('ยืนยันตรวจสอบยอดเงินเข้าจริงก่อน');
    if (amount < l.totalCents - paidCents(l) && (!validDate(input.dueDate) || input.dueDate < input.date)) throw new Error('วันนัดชำระยอดที่เหลือต้องไม่ก่อนวันที่รับเงิน');
    return {...input, reference, amountCents:amount, dueDate:amount < l.totalCents-paidCents(l) ? input.dueDate : l.dueDate};
}
const amountText = cents => (cents / 100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
const percentage = (part, total) => Number((part / total * 100).toFixed(2)) + '%';
function item(name, cents) { return {code:'',name,qty:1,unit:'รายการ',price:cents/100,basePrice:cents/100,discVal:0,discType:'disc_%',rowDisc:0,total:cents/100,itemBeforeVat:cents/100,itemVat:0}; }
export function applyOperation(root, action, docNo, today, allDocuments = []) {
    const l = clone(assertLedger(root));
    if (!/^[a-zA-Z0-9-]{12,80}$/.test(action.requestId || '')) throw new Error('รหัสรายการไม่ถูกต้อง');
    const priorOperation = l.documents.find(d => d.requestId === action.requestId);
    if (priorOperation) return {replayed:true, docNo:priorOperation.docNo};
    const before = paidCents(l), dueBefore = l.totalCents - before;
    let kind, prefix, date, gross = 0, net = 0, vat = 0, items = [], note = '', payment = null;
    const priorTax = l.documents.filter(d => ['advance','tax'].includes(d.kind));
    const covered = priorTax.reduce((s,d)=>s+d.grossCents,0), coveredNet = priorTax.reduce((s,d)=>s+d.netCents,0), coveredVat=priorTax.reduce((s,d)=>s+d.vatCents,0);
    if (action.kind === 'payment') {
        const p = validatePayment(root, action.input, today);
        kind = l.mode === 'domestic-vat7' && !l.delivered ? 'advance' : 'receipt'; prefix = kind === 'advance' ? 'RETAX' : 'RE'; date = p.date; gross = p.amountCents;
        net = kind === 'advance' ? Math.round((covered + gross) * 100 / 107) - coveredNet : gross; vat = gross - net;
        const proof = action.proof || null;
        if (proof && (!['image/png','image/jpeg','application/pdf'].includes(proof.type) || !/^data:(image\/(?:png|jpeg)|application\/pdf);base64,[a-zA-Z0-9+/=]+$/.test(proof.data || '') || proof.data.length > 690000)) throw new Error('หลักฐานต้องเป็น PNG/JPG/PDF ขนาดไม่เกิน 500 KB');
        if (!proof && !String(p.proofNote || '').trim()) throw new Error('แนบหลักฐานหรือระบุรายละเอียดหลักฐานก่อนรับเงิน');
        payment = {id:action.requestId,docNo,amountCents:gross,date,method:p.method,reference:p.reference,proofName:proof ? proof.name : String(p.proofNote).trim(),recordedAt:action.now,number:l.payments.length+1};
        l.payments.push(payment); l.dueDate=p.dueDate;
        l.dueHistory=[...(l.dueHistory||[]),{date:p.date,dueDate:p.dueDate}];
        items=[{...item((kind === 'advance' ? 'รับล่วงหน้าค่าสินค้า' : 'รับชำระค่าสินค้า')+' งวดที่ '+payment.number+' ตาม '+root.docNo,gross),itemBeforeVat:net/100,itemVat:vat/100}];
        note='รับเงินครั้งนี้ '+amountText(gross)+' บาท ('+percentage(gross,l.totalCents)+')\nช่องทาง '+p.method+' · อ้างอิง '+p.reference+'\nหลักฐาน: '+payment.proofName;
        if (kind === 'receipt' && l.deliveryTaxDocNo) note+='\nอ้างอิงใบกำกับ '+l.deliveryTaxDocNo+' (ไม่ออก VAT เพิ่ม)';
        if (l.mode === 'receipt') note+='\nใบเสร็จรับเงินนี้ไม่ใช่ใบกำกับภาษี';
    } else if (action.kind === 'delivery') {
        if (l.delivered) throw new Error('บันทึกส่งมอบแล้ว กรุณาเปิดเอกสารเดิม');
        date=today; l.delivered=true; l.deliveryDate=today;
        kind='delivery'; prefix='';
        if (l.mode === 'domestic-vat7' && covered < l.totalCents) {
            kind='tax'; prefix='TINV'; gross=l.totalCents-covered; net=l.netCents-coveredNet; vat=l.vatCents-coveredVat;
            items=[...clone(root.items),...priorTax.map(d=>({...item('หักรับล่วงหน้าที่ออกใบกำกับแล้ว '+d.docNo,-d.grossCents),itemBeforeVat:-d.netCents/100,itemVat:-d.vatCents/100}))];
            l.deliveryTaxDocNo=docNo;
            note='ส่งมอบสินค้าและหักรับล่วงหน้าที่ออกใบกำกับแล้ว '+amountText(covered)+' บาท\n'+priorTax.map(d=>d.docNo+': ฐาน '+amountText(d.netCents)+' + VAT '+amountText(d.vatCents)+' บาท').join('\n')+'\nเอกสารนี้ไม่ใช่ใบรับเงิน และไม่เพิ่มยอดรับชำระ';
        }
    } else if (action.kind === 'invoice') {
        kind='invoice'; prefix='INV'; date=today; gross=l.totalCents; net=moneyCents(root.subtotal); vat=moneyCents(root.vat); items=clone(root.items || []);
        note='ใบแจ้งหนี้ตาม '+root.docNo+'\nหักรับชำระแล้ว '+percentage(before,l.totalCents)+' จำนวน '+amountText(before)+' บาท\nยอดคงเหลือที่เรียกเก็บ '+amountText(dueBefore)+' บาท\nใบแจ้งหนี้ไม่ใช่ใบกำกับภาษีและไม่ใช่หลักฐานรับเงิน';
    } else throw new Error('ประเภทรายการไม่รองรับ');
    if (l.payments.length > 500 || l.documents.length >= 1000) throw new Error('จำนวนรายการถึงขีดจำกัด กรุณาติดต่อผู้ดูแลเพื่อแยกงวดบัญชี');
    const after=paidCents(l), balance=l.totalCents-after;
    const summary={orderNo:root.docNo,totalCents:l.totalCents,paidBeforeCents:before,paidCents:after,balanceCents:balance,receivedCents:payment?gross:0,dueDate:l.dueDate};
    const docName=kind==='advance'?'ใบเสร็จรับเงิน/ใบกำกับภาษี (RECEIPT/TAX INVOICE)':kind==='tax'?'ใบกำกับภาษี (TAX INVOICE)':kind==='receipt'?'ใบเสร็จรับเงิน (RECEIPT)':'ใบแจ้งหนี้ (INVOICE)';
    let output=null;
    if (prefix) {
        if (!docNo || !docNo.startsWith(prefix+'-')) throw new Error('เลขที่เอกสารไม่ตรงประเภทรายการ');
        const names=['customerName','customerTaxId','customerBranch','customerAddr','customerEmail','sellerName'];
        const parties=Object.fromEntries(names.map(k=>[k,String(root[k]||'')]));
        output={...parties,docNo,prefix,docName,inputDate:date,rawDate:date+'T12:00:00+07:00',dateStr:new Date(date+'T12:00:00+07:00').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}),creditTerm:'',currency:'THB',exchangeRate:1,refDocManual:[root.docNo,...(kind==='tax'?priorTax.map(d=>d.docNo):kind==='receipt'&&l.deliveryTaxDocNo?[l.deliveryTaxDocNo]:[])].join(', '),items,subtotal:net/100,vat:vat/100,grandTotal:gross/100,isRevenue:false,isInputTax:false,status:kind==='advance'||kind==='receipt'?'paid':kind==='invoice'?'pending':'completed',remark:note,remarkIds:[],paymentManaged:{version:1,rootNo:root.docNo,kind,requestId:action.requestId},paymentSummary:summary};
        if (kind==='advance'||kind==='tax') { output.paymentManaged.priceIncludesVat=true; output.remark+='\nราคาและจำนวนเงินในตารางรวม VAT แล้ว'; }
        if (action.issuer) output.paymentIssuer=clone(action.issuer);
        if (action.proof && payment) output.paymentProof=clone(action.proof);
    }
    l.documents.push({requestId:action.requestId,docNo:prefix?docNo:'',kind,date,grossCents:gross,netCents:net,vatCents:vat,...(action.fingerprint?{fingerprint:action.fingerprint}:{})});
    l.revision=(l.revision||0)+1;
    return {ledger:l,document:output,docNo:output?.docNo||'',summary};
}
export function operationPrefix(root, action) {
    const l=assertLedger(root);
    if (action.kind==='invoice') return 'INV';
    if (action.kind==='payment') return l.mode==='domestic-vat7'&&!l.delivered?'RETAX':'RE';
    if (action.kind==='delivery') return l.mode==='domestic-vat7'&&l.documents.filter(d=>['advance','tax'].includes(d.kind)).reduce((s,d)=>s+d.grossCents,0)<l.totalCents?'TINV':'';
    throw new Error('ประเภทรายการไม่รองรับ');
}
