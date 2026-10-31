import {formatMoney,ensure,clone} from './billing-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const dateText=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.slice(8)+'/'+d.slice(5,7)+'/'+(Number(d.slice(0,4))+543):'ยังไม่ยืนยัน';
const sum=(rows,key)=>rows.reduce((s,r)=>s+Number(r[key]||0),0);
export function billingPrintModel(d,company={}){
 const issuer=d.paymentIssuer||company,party={name:d.customerName||'',address:d.customerAddr||'',taxId:d.customerTaxId||'',branch:d.customerBranch||''};
 if(d.billingManaged){
  const rows=d.billingRows||[],state=d.billingManaged.state;
  return {number:d.docNo,date:d.inputDate,title:'ใบวางบิล / BILLING NOTE',issuer,party,status:state==='cancelled'?'ยกเลิกแล้ว':state==='superseded'?'มีฉบับใหม่แทน':'',headers:['ลำดับ','ใบแจ้งหนี้','ครบกำหนด','ยอดสุทธิ','รับแล้ว','คงเหลือ'],widths:[.06,.25,.15,.18,.18,.18],
   rows:rows.map((r,n)=>[String(n+1),r.invoiceNo,dateText(r.dueDate),formatMoney(r.totalCents),formatMoney(r.paidCents),formatMoney(r.balanceCents)]),
   totals:[['ยอดตามใบแจ้งหนี้',sum(rows,'totalCents')],['รับชำระแล้ว ณ วันออกบิล',sum(rows,'paidCents')],['ยอดเรียกเก็บครั้งนี้',Math.round(d.grandTotal*100)]],
   meta:['นัดชำระ: '+dateText(d.billingManaged.dueDate)],note:[d.remark,d.billingManaged.replaces?'ออกแทน '+d.billingManaged.replaces:'',d.billingManaged.reason?'เหตุผล: '+d.billingManaged.reason:''].filter(Boolean).join('\n'),signatures:['ผู้จัดทำ / ผู้วางบิล','ผู้รับเอกสาร']};
 }
 const tax=['advance','tax'].includes(d.paymentManaged?.kind),rows=d.collectionRows||[],info=d.collectionInfo||{};
 return {number:d.docNo,date:d.inputDate,title:d.docName||'ใบรับเงิน',issuer,party,status:'',headers:tax?['ลำดับ','รายการ / เอกสารอ้างอิง','จำนวน','หน่วย','ราคา (รวม VAT)','รวม (รวม VAT)']:['ลำดับ','ใบแจ้งหนี้','ค้างก่อนรับ','รับครั้งนี้','คงเหลือ'],widths:tax?[.06,.4,.08,.1,.18,.18]:[.06,.34,.2,.2,.2],
  rows:tax?(d.items||[]).map((i,n)=>[String(n+1),i.name,String(i.qty),i.unit||'',formatMoney(Math.round(i.price*100)),formatMoney(Math.round(i.total*100))]):rows.map((r,n)=>[String(n+1),[r.invoiceNo,r.taxDocumentNo,r.billingLock?.billNo].filter(Boolean).join('\n'),formatMoney(r.balanceCents),formatMoney(r.amountCents),formatMoney(r.afterCents)]),
  totals:tax?[['ยอดออเดอร์ที่รับชำระ',d.paymentSummary?.totalCents||0],['รับชำระสะสม',d.paymentSummary?.paidCents||0],['คงเหลือหลังรับ',d.paymentSummary?.balanceCents||0],['มูลค่าก่อน VAT',Math.round(d.subtotal*100)],['VAT 7%',Math.round(d.vat*100)],['รับชำระครั้งนี้',Math.round(d.grandTotal*100)]]:[['ยอดค้างก่อนรับ',sum(rows,'balanceCents')],['คงเหลือหลังรับ',sum(rows,'afterCents')],['รับชำระครั้งนี้',Math.round(d.grandTotal*100)]],
  meta:[d.paymentManaged?.batchId?'รับเงินรวม: '+d.paymentManaged.batchId:'',info.method?'ช่องทาง: '+info.method:'',info.reference?'อ้างอิง: '+info.reference:'',info.billNos?.length?'ใบวางบิลที่เกี่ยวข้อง '+info.billNos.length+' ฉบับ':''].filter(Boolean),
  note:d.collectionInfo?[info.note,info.proofNote?'หลักฐาน: '+info.proofNote:'',tax?'ราคาและยอดในตารางรวม VAT แล้ว':'ใบเสร็จรับเงินนี้ไม่ออก VAT เพิ่ม'].filter(Boolean).join('\n'):d.remark||'',signatures:['ผู้รับเงิน','ผู้ชำระเงิน']};
}
export function statementPrintModel(rows,party,company,asOf){
 return {number:'AR-'+asOf,date:asOf,title:'รายงานลูกหนี้ / CUSTOMER STATEMENT',issuer:clone(company),party:{name:party.customerName||'',address:party.customerAddr||'',taxId:party.customerTaxId||'',branch:party.customerBranch||''},status:'',headers:['ลำดับ','ใบแจ้งหนี้','ครบกำหนด','ยอดสุทธิ','รับแล้ว','คงเหลือ'],widths:[.06,.25,.15,.18,.18,.18],
  rows:rows.map((r,n)=>[String(n+1),r.invoiceNo,dateText(r.dueDate),formatMoney(r.totalCents),formatMoney(r.paidCents),formatMoney(r.balanceCents)]),totals:[['ยอดใบแจ้งหนี้',sum(rows,'totalCents')],['รับชำระแล้ว',sum(rows,'paidCents')],['ลูกหนี้คงเหลือ',sum(rows,'balanceCents')]],
  meta:['ยอด ณ วันที่ '+dateText(asOf)],note:rows.some(r=>!r.dueDate)?'รายการที่ยังไม่ยืนยันวันครบกำหนดแยกจากกลุ่มอายุหนี้':'' ,signatures:['ผู้จัดทำรายงาน','ผู้ทวนสอบ']};
}
function chunks(rows){const out=[];for(let n=0;n<rows.length;n+=8)out.push(rows.slice(n,n+8));return out.length?out:[[]];}
export function printHtml(model,{draft=false}={}){
 const pages=chunks(model.rows),issuer=model.issuer||{},logo=/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(issuer.logo||'')?'<img src="'+issuer.logo+'" alt="">':'';
 return pages.map((rows,page)=>'<article class="bl-paper"><header class="bl-paper-header">'+logo+'<div><h3>'+esc(issuer.nameTh)+'</h3><p>'+esc(issuer.addressTh)+'</p><p>เลขผู้เสียภาษี '+esc(issuer.taxId)+' · สาขา '+esc(issuer.branch)+'</p></div><strong>'+esc(draft?'ฉบับร่าง':model.status)+'</strong></header><h2>'+esc(model.title)+'</h2><div class="bl-paper-meta"><div><strong>ลูกค้า: '+esc(model.party.name)+'</strong><p>'+esc(model.party.address)+'</p><p>เลขผู้เสียภาษี '+esc(model.party.taxId)+' · สาขา '+esc(model.party.branch)+'</p></div><div>เลขที่: '+esc(draft?'ยังไม่ออกเลขที่':model.number)+'<br>วันที่: '+dateText(model.date)+(model.meta||[]).map(s=>'<br>'+esc(s)).join('')+'</div></div>'+
 '<table><colgroup>'+model.widths.map(w=>'<col style="width:'+w/model.widths.reduce((a,b)=>a+b,0)*100+'%">').join('')+'</colgroup><thead><tr>'+model.headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((v,n)=>'<td'+(n>1?' class="bl-paper-number"':'')+'>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+
 (page===pages.length-1?'<div class="bl-paper-totals">'+model.totals.map(([label,cents])=>'<div><span>'+esc(label)+'</span><strong>'+formatMoney(cents)+' THB</strong></div>').join('')+'</div><p class="bl-paper-note">'+esc(model.note)+'</p><div class="bl-paper-sign">'+model.signatures.map(s=>'<div>________________________<br>'+esc(s)+'<br>วันที่ ____ / ____ / ____</div>').join('')+'</div>':'<p class="bl-paper-note">ยอดรวมแสดงที่หน้าสุดท้าย</p>')+
 '<footer>หน้า '+(page+1)+' / '+pages.length+(draft?' · ฉบับร่าง ยังไม่บันทึก':'')+'</footer></article>').join('');
}
export async function pdfBytes(model,document,{draft=false}={}){
 ensure(model.rows.length<=300,'PDF รองรับไม่เกิน 300 รายการ กรุณาแบ่งช่วงรายงาน');
 const W=2480,H=3508,M=150,pages=chunks(model.rows),images=[];
 for(let page=0;page<pages.length;page++){
  const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ensure(ctx,'เบราว์เซอร์นี้สร้าง PDF ไม่ได้ กรุณาใช้ปุ่มพิมพ์');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.textBaseline='top';
  const font=size=>'400 '+size+'px Tahoma,Arial,sans-serif';
  const text=(s,x,y,size=32,align='left',color='#263b2e')=>{ctx.font=font(size);ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(s??''),x,y);};
  function wrap(s,x,y,width,size=32,line=48,max=8){
   const chars=typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter('th',{granularity:'grapheme'}).segment(String(s||'')),p=>p.segment):Array.from(String(s||''));
   const result=[];let current='';ctx.font=font(size);
   for(const ch of chars){if(ch==='\n'){result.push(current);current='';}else if(current&&ctx.measureText(current+ch).width>width){result.push(current);current=ch;}else current+=ch;}
   if(current||!result.length)result.push(current);ensure(result.length<=max,'ข้อความยาวเกินพื้นที่ PDF กรุณาใช้ปุ่มพิมพ์สำหรับเอกสารนี้');
   result.forEach((s,n)=>text(s,x,y+n*line,size));return y+result.length*line;
  }
  const rule=y=>{ctx.strokeStyle='#c7d9cc';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(M,y);ctx.lineTo(W-M,y);ctx.stroke();};
  const issuer=model.issuer||{};let y=145;
  y=wrap(issuer.nameTh,M,y,1750,43,62,3)+18;
  y=wrap(issuer.addressTh,M,y,1750,30,43,4)+10;
  y=wrap('เลขผู้เสียภาษี '+(issuer.taxId||'')+' · สาขา '+(issuer.branch||''),M,y,1750,30,43,2)+38;
  text(draft?'ฉบับร่าง':model.status||'',W-M,145,37,'right','#875c29');rule(y);
  y+=55;y=wrap(model.title,M,y,W-M*2,48,66,2)+70;
  const metaY=y;let left=wrap('ลูกค้า: '+model.party.name,M,y,1120,34,48,3);
  left=wrap(model.party.address,M,left+12,1120,29,42,4);
  left=wrap('เลขผู้เสียภาษี '+model.party.taxId+' · สาขา '+model.party.branch,M,left+10,1120,28,40,3);
  let right=wrap('เลขที่: '+(draft?'ยังไม่ออกเลขที่':model.number),1500,metaY,800,31,43,3);
  right=wrap('วันที่: '+dateText(model.date),1500,right+10,800,31,43,2);
  for(const m of model.meta||[])right=wrap(m,1500,right+8,800,29,42,3);
  y=Math.max(left,right)+65;
  const totalWidth=W-M*2,widths=model.widths.map(w=>w/model.widths.reduce((a,b)=>a+b,0)*totalWidth);
  const headerH=125,rowH=144;ctx.fillStyle='#edf6f0';ctx.fillRect(M,y,totalWidth,headerH);let x=M;
  model.headers.forEach((s,n)=>{wrap(s,x+15,y+20,widths[n]-30,32,40,2);x+=widths[n];});y+=headerH;
  for(const row of pages[page]){x=M;row.forEach((s,n)=>{if(n<=1)wrap(s,x+15,y+20,widths[n]-30,34,40,3);else{text(s,x+widths[n]-15,y+25,36,'right');}x+=widths[n];});rule(y+rowH);y+=rowH;}
  if(page===pages.length-1){
   y+=65;for(let n=0;n<model.totals.length;n++){const [label,amount]=model.totals[n];if(n===model.totals.length-1)rule(y-12);text(label,1240,y,n===model.totals.length-1?35:30);text(formatMoney(amount)+' THB',W-M,y,n===model.totals.length-1?37:32,'right',n===model.totals.length-1?'#047857':'#263b2e');y+=78;}
   if(model.note)y=wrap('หมายเหตุ: '+model.note,M,y+35,W-M*2,27,39,10);
   const signY=Math.max(y+140,2830);ensure(signY<3190,'เนื้อหาเกินพื้นที่ PDF กรุณาใช้ปุ่มพิมพ์');
   text('____________________________',650,signY,29,'center');text('____________________________',1830,signY,29,'center');
   text(model.signatures[0],650,signY+55,29,'center');text(model.signatures[1],1830,signY+55,29,'center');
  }else ensure(y<3180,'เนื้อหาเกินพื้นที่ PDF กรุณาใช้ปุ่มพิมพ์');
  rule(3300);text('หน้า '+(page+1)+' / '+pages.length+(draft?' · ฉบับร่าง ยังไม่บันทึก':''),W/2,3350,27,'center','#64756a');
  images.push(Uint8Array.from(atob(c.toDataURL('image/jpeg',.94).split(',')[1]),c=>c.charCodeAt(0)));c.width=1;c.height=1;
 }
 const enc=new TextEncoder(),parts=[],offsets=[0];let length=0;const push=x=>{const b=typeof x==='string'?enc.encode(x):x;parts.push(b);length+=b.length;},object=(n,body)=>{offsets[n]=length;push(n+' 0 obj\n'+body+'\nendobj\n');};
 push('%PDF-1.4\n% Nual Anan ERP\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,n)=>(3+n*3)+' 0 R').join(' ')+'] >>');
 images.forEach((jpg,n)=>{const id=3+n*3;object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');offsets[id+1]=length;push((id+1)+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+W+' /Height '+H+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpg.length+' >>\nstream\n');push(jpg);push('\nendstream\nendobj\n');const data='q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';object(id+2,'<< /Length '+enc.encode(data).length+' >>\nstream\n'+data+'endstream');});
 const info=3+pages.length*3;object(info,'<< /Title ('+String(model.number).replace(/[^A-Za-z0-9_-]/g,'')+') /Producer (Nual Anan ERP) >>');const xref=length;push('xref\n0 '+(info+1)+'\n0000000000 65535 f \n');for(let n=1;n<=info;n++)push(String(offsets[n]).padStart(10,'0')+' 00000 n \n');push('trailer\n<< /Size '+(info+1)+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 const result=new Uint8Array(length);let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;
}
