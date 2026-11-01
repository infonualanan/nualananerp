export const MAX_FILE_BYTES=2500000;
export const TYPES={tax_invoice:'ใบกำกับภาษี',receipt_tax:'ใบเสร็จรับเงิน/ใบกำกับภาษี',receipt:'ใบเสร็จรับเงิน',invoice:'ใบแจ้งหนี้',credit_note:'ใบลดหนี้',debit_note:'ใบเพิ่มหนี้',other:'เอกสารอื่น'};
export const FIELDS=['documentType','documentNo','documentDate','currency','sellerName','sellerTaxId','sellerBranch','sellerAddress','buyerName','buyerTaxId','buyerBranch','buyerAddress','priceBasis','vatRate','discount','subtotal','vat','grandTotal','reportMonth','referenceNo','note'];
const ITEM_FIELDS=['name','quantity','unit','unitPrice','discount','lineTotal'];
export const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
export const clean=x=>String(x??'').trim();
export const digits=x=>clean(x).replace(/[\s-]/g,'');
export function validDate(x){if(!/^\d{4}-\d{2}-\d{2}$/.test(x||''))return false;const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x&&x>='2000-01-01'&&x<='2199-12-31';}
export function money(x){const raw=clean(x);ensure(/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw),'จำนวนเงินต้องเป็นเลขตั้งแต่ 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง');const s=raw.replace(/,/g,''),[a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));ensure(Number.isSafeInteger(n)&&n<=999999999999,'จำนวนเงินเกินขนาดที่รองรับ');return n;}
export const formatMoney=n=>(n/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
export function blankDraft(){return {...Object.fromEntries(FIELDS.map(k=>[k,''])),documentType:'other',currency:'',items:[],warnings:[],readable:true,taxEligible:false,reviewed:false,status:'draft'};}
export function normalizeDraft(raw){const d=blankDraft();for(const k of FIELDS)d[k]=clean(raw?.[k]).slice(0,k==='note'?1000:500);ensure(!raw?.items||Array.isArray(raw.items),'รายการสินค้าไม่ถูกต้อง');ensure((raw?.items||[]).length<=80,'รองรับสูงสุด 80 รายการต่อเอกสาร');d.items=(raw?.items||[]).map(row=>Object.fromEntries(ITEM_FIELDS.map(k=>[k,clean(row[k]).slice(0,500)])));d.warnings=(raw?.warnings||[]).filter(x=>typeof x==='string').slice(0,30).map(x=>x.slice(0,500));d.readable=raw?.readable!==false;d.taxEligible=raw?.taxEligible===true;d.reviewed=raw?.reviewed===true;d.status=raw?.status==='reviewed'?'reviewed':'draft';return d;}
export function fromExtraction(extraction){return normalizeDraft({...extraction,reportMonth:validDate(extraction.documentDate)?extraction.documentDate.slice(0,7):'',status:'draft',reviewed:false,taxEligible:false});}
export function validation(raw,{company={},today='2199-12-31'}={}){
 const d=normalizeDraft(raw),errors=[],taxErrors=[],warnings=[];let total=null,net=null,vat=null;
 const need=(ok,msg)=>{if(!ok)errors.push(msg);};
 need(Object.hasOwn(TYPES,d.documentType),'เลือกประเภทเอกสาร');need(d.documentNo,'ระบุเลขเอกสาร');need(validDate(d.documentDate)&&d.documentDate<=today,'ตรวจวันที่เอกสาร');need(d.sellerName,'ระบุชื่อผู้ขาย');need(d.currency==='THB','รุ่นนี้ตรวจยอดและรายงานได้เฉพาะ THB');
 for(const k of ['subtotal','vat','grandTotal'])try{const n=money(d[k]);if(k==='subtotal')net=n;if(k==='vat')vat=n;if(k==='grandTotal')total=n;}catch{errors.push('ตรวจจำนวนเงินช่อง '+({subtotal:'มูลค่าก่อน VAT',vat:'VAT',grandTotal:'ยอดสุทธิ'}[k]));}
 if(net!==null&&vat!==null&&total!==null)need(net+vat===total,'มูลค่าก่อน VAT + VAT ไม่เท่ากับยอดสุทธิต้นฉบับ');
 need(d.items.length>0,'เพิ่มรายการสินค้า/ค่าใช้จ่ายอย่างน้อย 1 รายการ');let sum=0,complete=true;
 for(let i=0;i<d.items.length;i++){const r=d.items[i];need(r.name,'ระบุชื่อรายการที่ '+(i+1));const quantityOK=/^\d{1,9}(?:\.\d{1,6})?$/.test(r.quantity)&&Number(r.quantity)>0;need(quantityOK,'ตรวจจำนวนรายการที่ '+(i+1));need(r.unit,'ระบุหน่วยรายการที่ '+(i+1));try{const price=money(r.unitPrice),line=money(r.lineTotal),discount=r.discount?money(r.discount):0;sum+=line;if(quantityOK){const [a,b='']=r.quantity.split('.'),q=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')),expected=Number((q*BigInt(price)+500000n)/1000000n)-discount;need(Math.abs(expected-line)<=1,'จำนวน × ราคา หักส่วนลด ไม่ตรงกับยอดรายการที่ '+(i+1));}}catch{complete=false;errors.push('ตรวจเงินในรายการที่ '+(i+1));}}
 if(complete&&d.items.length&&['INC','EXC'].includes(d.priceBasis)&&net!==null&&total!==null){let discount=0;try{if(d.discount)discount=money(d.discount);}catch{errors.push('ตรวจส่วนลดท้ายบิล');}need(sum-discount===(d.priceBasis==='INC'?total:net),'รวมยอดรายการหักส่วนลดท้ายบิลไม่ตรงกับยอดเอกสาร');}
 if(!['INC','EXC'].includes(d.priceBasis))warnings.push('ยังไม่ระบุว่าราคาต่อหน่วยรวม VAT หรือไม่รวม VAT');
 if(d.vatRate){if(!/^\d+(?:\.\d{1,2})?$/.test(d.vatRate)||Number(d.vatRate)>100)errors.push('ตรวจอัตรา VAT');else if(net!==null&&vat!==null&&Math.abs(Math.round(net*Number(d.vatRate)/100)-vat)>1)errors.push('VAT ไม่ตรงกับฐานภาษีและอัตราที่ระบุ (ยอมให้ต่าง 0.01 บาท)');}
 const taxNeed=(ok,msg)=>{if(!ok)taxErrors.push(msg);};
 taxNeed(['tax_invoice','receipt_tax'].includes(d.documentType),'ใบเสร็จธรรมดา ใบแจ้งหนี้ และใบเพิ่ม/ลดหนี้ยังไม่เข้ารายงานภาษีซื้อจากคลังนี้');
 taxNeed(/^\d{13}$/.test(digits(d.sellerTaxId)),'ตรวจเลขภาษีผู้ขาย 13 หลัก');taxNeed(/^\d{5}$/.test(digits(d.sellerBranch)),'ระบุรหัสสาขาผู้ขาย 5 หลัก');
 taxNeed(d.buyerName&&d.buyerAddress&&d.sellerAddress,'ตรวจชื่อ/ที่อยู่ผู้ซื้อและที่อยู่ผู้ขาย');taxNeed(/^\d{13}$/.test(digits(d.buyerTaxId)),'ตรวจเลขภาษีผู้ซื้อ 13 หลัก');taxNeed(/^\d{5}$/.test(digits(d.buyerBranch)),'ตรวจสาขาผู้ซื้อ 5 หลัก');
 taxNeed(/^\d{13}$/.test(digits(company.taxId))&&digits(company.taxId)===digits(d.buyerTaxId),'เลขภาษีผู้ซื้อไม่ตรงกับข้อมูลบริษัทที่บันทึกใน ERP');
 const companyBranch=/^(สำนักงานใหญ่|head\s*office)$/i.test(clean(company.branch))?'00000':digits(company.branch);taxNeed(/^\d{5}$/.test(companyBranch)&&companyBranch===digits(d.buyerBranch),'สาขาผู้ซื้อไม่ตรงกับข้อมูลบริษัท ERP');
 taxNeed(/^\d{4}-(0[1-9]|1[0-2])$/.test(d.reportMonth)&&d.reportMonth>=d.documentDate.slice(0,7),'ตรวจเดือนรายงาน (ต้องไม่ก่อนเดือนเอกสาร)');taxNeed(['INC','EXC'].includes(d.priceBasis),'ระบุรูปแบบราคาต่อหน่วย');taxNeed(d.vatRate!==''&&Number(d.vatRate)>0&&vat>0,'ตรวจอัตราและยอดภาษีซื้อ');
 if(d.taxEligible)errors.push(...taxErrors);need(d.reviewed,'ยืนยันตรวจต้นฉบับ รายการ และยอดก่อนบันทึกเป็นตรวจแล้ว');
 return {errors:[...new Set(errors)],taxErrors:[...new Set(taxErrors)],warnings,net,vat,total};
}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function naturalKey(d){const seller=digits(d.sellerTaxId)||clean(d.sellerName).normalize('NFKC').toLowerCase().replace(/\s+/g,' '),number=clean(d.documentNo).normalize('NFKC').toUpperCase().replace(/\s+/g,'');if(!seller||!number)return null;const kind=['tax_invoice','receipt_tax'].includes(d.documentType)?'tax_invoice':d.documentType;return sha256(new TextEncoder().encode(JSON.stringify([seller,digits(d.sellerBranch),kind,number])));}
export function report(records,{period,yearly=false,company={},today}){
 ensure(yearly?/^\d{4}$/.test(period):/^\d{4}-(0[1-9]|1[0-2])$/.test(period),'เลือกรอบรายงาน');
 const included=[],excluded=[];
 for(const r of records){const d=r.data||{},month=d.reportMonth||d.documentDate?.slice(0,7)||'';if(!(yearly?month.slice(0,4)===period:month===period))continue;
  const check=validation(d,{company,today});const reason=r.status!=='reviewed'?'ยังไม่ตรวจยืนยัน':!d.taxEligible?'ไม่ได้เลือกเข้ารายงานภาษีซื้อ':check.errors.join(' / ');
  if(reason)excluded.push({...r,reason});else included.push({...r,netCents:check.net,vatCents:check.vat,totalCents:check.total});
 }
 included.sort((a,b)=>a.data.documentDate.localeCompare(b.data.documentDate)||a.data.documentNo.localeCompare(b.data.documentNo));
 return {period,yearly,included,excluded,net:included.reduce((s,r)=>s+r.netCents,0),vat:included.reduce((s,r)=>s+r.vatCents,0),total:included.reduce((s,r)=>s+r.totalCents,0)};
}
export function csvCell(x){let s=String(x??'');if(/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function reportCSV(r){const rows=[['รายงานเอกสารภาษีซื้อจากคลังแนบ',r.period,r.yearly?'สรุปรายปีปฏิทิน':'รายเดือน'],['เฉพาะเอกสารตรวจแล้วในคลังแนบ ไม่รวมเอกสารซื้อเดิมใน ERP'],['วันที่','เลขเอกสาร','ผู้ขาย','เลขภาษีผู้ขาย','สาขา','ก่อน VAT','VAT','สุทธิ','เดือนรายงาน','รหัสอ้างอิงไฟล์']];for(const x of r.included){const d=x.data;rows.push([d.documentDate,d.documentNo,d.sellerName,d.sellerTaxId,d.sellerBranch,(x.netCents/100).toFixed(2),(x.vatCents/100).toFixed(2),(x.totalCents/100).toFixed(2),d.reportMonth,x.id]);}rows.push(['รวม','','','','',(r.net/100).toFixed(2),(r.vat/100).toFixed(2),(r.total/100).toFixed(2)]);rows.push([],['รายการไม่รวมในยอด','เลขเอกสาร','ผู้ขาย','เหตุผล']);for(const x of r.excluded)rows.push(['',x.data?.documentNo,x.data?.sellerName,x.reason]);return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
