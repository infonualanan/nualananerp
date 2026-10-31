import {isPaymentRoot,ledgerSummary,moneyCents,validDate,applyOperation,operationPrefix} from './payments-core.mjs';
import {connectedPaymentSources,untrackedDocuments,normalizeReference} from './accounting-common.mjs';
export const clone=v=>JSON.parse(JSON.stringify(v));
export const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
export const text=(v,label,max=180)=>{const s=String(v??'').normalize('NFKC').trim();ensure(s&&s.length<=max,'กรอก'+label+'ไม่เกิน '+max+' ตัวอักษร');return s;};
export const formatMoney=n=>(n/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
const norm=v=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
const branchKey=v=>['สำนักงานใหญ่','HEAD OFFICE','H.O.','00000'].some(label=>norm(label)===norm(v))?'00000':norm(v);
const partyField=(d,k)=>k==='customerTaxId'?String(d[k]||'').replace(/[\s-]/g,''):k==='customerBranch'?branchKey(d[k]):norm(d[k]);
export function partyKey(d){
 const tax=String(d.customerTaxId||'').replace(/[\s-]/g,''),branch=branchKey(d.customerBranch);
 return /^\d{13}$/.test(tax)&&!/^0+$/.test(tax)?JSON.stringify(['tax',tax,branch]):JSON.stringify(['party',norm(d.customerName),norm(d.customerAddr),branch]);
}
export function partySnapshot(d){return Object.fromEntries(['customerId','customerName','customerTaxId','customerBranch','customerAddr','customerEmail'].map(k=>[k,String(d[k]||'')]));}
export const sourceDate=d=>validDate(d.inputDate)?d.inputDate:validDate(String(d.rawDate||'').slice(0,10))?String(d.rawDate).slice(0,10):'';
const safeSum=values=>{const n=values.reduce((s,v)=>s+v,0);ensure(Number.isSafeInteger(n),'ยอดรวมเกินขอบเขต');return n;};
export function sourceRow(root,documents,asOf,today){
 ensure(isPaymentRoot(root),'เอกสารต้นทางไม่ใช่ SO / INV สกุล THB');
 ensure(sourceDate(root),'เอกสารต้นทางไม่มีวันที่ที่ตรวจสอบได้');
 ensure(root.paymentLedger,'เปิดรับชำระหลายงวดและตรวจยอดเดิมก่อน');
 const l=root.paymentLedger,s=ledgerSummary(root);
 ensure(['receipt','domestic-vat7'].includes(l.mode),'รูปแบบรับเงินต้นทางไม่ถูกต้อง');
 ensure(l.version===1&&s.total===moneyCents(root.grandTotal)&&s.total>0&&s.total<=1e12,'ยอดต้นทางหรือรุ่นข้อมูลไม่ตรง กรุณาตรวจยอด');
 ensure(Number.isSafeInteger(s.paid)&&s.paid>=0&&s.balance>=0,'ยอดรับสะสมผิดปกติ');
 const taxDocs=(l.documents||[]).filter(d=>['advance','tax'].includes(d.kind));
 const covered=safeSum(taxDocs.map(d=>d.grossCents));
 ensure(taxDocs.every(d=>Number.isSafeInteger(d.grossCents)&&d.grossCents>=0&&Number.isSafeInteger(d.netCents)&&Number.isSafeInteger(d.vatCents)&&d.netCents+d.vatCents===d.grossCents),'ข้อมูลใบกำกับต้นทางผิดปกติ');
 ensure(l.mode==='receipt'?covered===0:covered<=s.total&&(l.delivered?covered===s.total:covered===s.paid&&!taxDocs.some(d=>d.kind==='tax')),'สถานะภาษีต้นทางไม่ตรงกับประวัติ กรุณาตรวจยอด');
 ensure(!['cancelled','void'].includes(root.status),'ต้นทางถูกยกเลิก ต้องตรวจยอดก่อน');
 ensure(!untrackedDocuments(root,documents).some(d=>!sourceDate(d)||sourceDate(d)<=asOf),'มีใบรับเงิน ใบกำกับ หรือใบเพิ่ม/ลดหนี้เดิมที่ยังไม่กระทบยอด');
 const linked=connectedPaymentSources(root,documents).filter(id=>id!==root.docNo);
 ensure(!linked.some(id=>documents.some(d=>d.docNo===id&&d.paymentLedger)),'พบยอดอ้างอิงจากหลายต้นทาง ต้องกระทบยอดก่อน');
 let invoice=root;
 if(root.prefix==='SO'){
  const issued=(l.documents||[]).filter(d=>d.kind==='invoice'&&validDate(d.date)&&d.date<=asOf);
  const latest=issued.at(-1);ensure(latest,'ยังไม่มีใบแจ้งหนี้ของใบสั่งขายนี้');
  invoice=documents.find(d=>d.docNo===latest.docNo);
  ensure(invoice?.paymentManaged?.kind==='invoice'&&invoice.paymentManaged.rootNo===root.docNo,'ไม่พบใบแจ้งหนี้อ้างอิงที่ตรงกับต้นทาง');
 }
 const date=sourceDate(invoice);ensure(date&&date<=asOf,'ใบแจ้งหนี้ยังไม่อยู่ในวันที่รายงาน');
 const payments=(l.payments||[]).filter(p=>{ensure(validDate(p.date)&&p.date<=today&&p.date>=sourceDate(root)&&Number.isSafeInteger(p.amountCents)&&p.amountCents>0,'ข้อมูลรับชำระไม่สมบูรณ์');return p.date<=asOf;});
 const paid=safeSum(payments.map(p=>p.amountCents));ensure(paid<=s.total,'ยอดรับเงินเกินยอดต้นทาง');
 const history=(l.dueHistory||[]).filter(h=>validDate(h.date)&&validDate(h.dueDate)&&h.date<=asOf);
 let due=history.at(-1)?.dueDate||'';
 if(!due&&asOf===today&&validDate(l.dueDate))due=l.dueDate;
 if(!due&&String(invoice.creditTerm??'').trim()!==''&&/^\d+$/.test(String(invoice.creditTerm))&&Number(invoice.creditTerm)<=3650){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+Number(invoice.creditTerm));due=d.toISOString().slice(0,10);}
 const lock=root.billingLock||null;
 return {rootNo:root.docNo,invoiceNo:invoice.docNo,date,dueDate:due,totalCents:s.total,paidCents:paid,balanceCents:s.total-paid,partyKey:partyKey(root),...partySnapshot(root),
  expectedRevision:l.revision||0,expectedBillingRevision:root.billingRevision||0,mode:l.mode,delivered:!!l.delivered,billingLock:lock};
}
export function receivables(documents,asOf,today){
 ensure(validDate(asOf)&&asOf<=today,'วันที่รายงานไม่ถูกต้อง');
 const rows=[],review=[],uninvoiced=[];
 for(const root of documents.filter(isPaymentRoot)){
  if(root.prefix==='SO'&&!root.paymentLedger)continue;
  if(sourceDate(root)&&sourceDate(root)>asOf)continue;
  try{rows.push(sourceRow(root,documents,asOf,today));}catch(e){
   const candidate={rootNo:root.docNo,invoiceNo:root.docNo,...partySnapshot(root),partyKey:partyKey(root),reason:e.message};
   if(root.prefix==='SO'&&e.message.includes('ยังไม่มีใบแจ้งหนี้'))uninvoiced.push(candidate);else review.push(candidate);
  }
 }
 return {rows,review,uninvoiced};
}
export function aging(rows,asOf){
 const buckets=[0,0,0,0,0,0];
 for(const r of rows){let index=5;if(r.dueDate){const late=Math.round((Date.parse(asOf+'T00:00:00Z')-Date.parse(r.dueDate+'T00:00:00Z'))/86400000);index=late<=0?0:late<=30?1:late<=60?2:late<=90?3:4;}buckets[index]+=r.balanceCents;}
 return {buckets,totalCents:safeSum(rows.map(r=>r.totalCents)),paidCents:safeSum(rows.map(r=>r.paidCents)),balanceCents:safeSum(rows.map(r=>r.balanceCents))};
}
export function rowExpectation(row){return Object.fromEntries(['rootNo','invoiceNo','expectedRevision','expectedBillingRevision','balanceCents'].map(k=>[k,row[k]]));}
export function validateRows(input,documents,today,{allowLock=''}={}){
 ensure(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=30,'เลือกใบแจ้งหนี้ 1–30 ใบ');
 const seen=new Set(),rows=input.rows.map(expected=>{
  ensure(!seen.has(expected.rootNo),'เอกสารต้นทางซ้ำ');seen.add(expected.rootNo);
  const root=documents.find(d=>d.docNo===expected.rootNo);ensure(root,'ไม่พบเอกสารต้นทาง');
  const actual=sourceRow(root,documents,today,today);
  for(const key of ['invoiceNo','expectedRevision','expectedBillingRevision','balanceCents'])ensure(expected[key]===actual[key],'ยอดหรือเอกสารเปลี่ยน กรุณาอัปเดตและตรวจรายการใหม่');
  ensure(actual.balanceCents>0,'มีใบแจ้งหนี้ที่ชำระครบแล้ว');
  if(input.kind!=='payment')ensure(!actual.billingLock||actual.billingLock.billNo===allowLock,'ใบแจ้งหนี้อยู่ในใบวางบิลอื่นแล้ว');
  return actual;
 });
 const key=rows[0].partyKey;ensure(rows.every(r=>r.partyKey===key),'เลือกเอกสารของลูกค้าและสาขาเดียวกัน');
 const fields=['customerName','customerTaxId','customerBranch','customerAddr'];
 const sameParty=rows.every(r=>fields.every(k=>partyField(r,k)===partyField(rows[0],k)));
 ensure(sameParty,'ชื่อ ที่อยู่ หรือสาขาในต้นทางต่างกัน กรุณาตรวจข้อมูลก่อนรวมเอกสาร');
 return rows;
}
export function issuerSnapshot(company){
 ensure(company&&String(company.nameTh||'').trim()&&String(company.addressTh||'').trim(),'กรอกชื่อและที่อยู่บริษัทก่อนออกเอกสาร');
 return Object.fromEntries(['nameTh','nameEn','addressTh','addressEn','taxId','branch','phone','email','logo'].map(k=>[k,String(company[k]||'')]));
}
function vatParties(row,issuer){
 ensure(/^\d{13}$/.test(issuer.taxId.replace(/[\s-]/g,''))&&issuer.branch.trim(),'กรอกเลขผู้เสียภาษีและสาขาบริษัทก่อนออกใบกำกับ');
 ensure(/^\d{13}$/.test(row.customerTaxId.replace(/[\s-]/g,''))&&row.customerBranch.trim()&&row.customerAddr.trim(),'กรอกเลขผู้เสียภาษี ที่อยู่ และสาขาลูกค้าในต้นทางก่อนออกใบกำกับ');
}
function baseDocument(prefix,docNo,party,today,issuer){
 return {...partySnapshot(party),docNo,prefix,inputDate:today,rawDate:today+'T12:00:00+07:00',dateStr:new Date(today+'T12:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok'}),currency:'THB',exchangeRate:1,creditTerm:'',isRevenue:false,isInputTax:false,remarkIds:[],paymentIssuer:clone(issuer)};
}
export function buildBill(action,documents,today,docNo){
 const x=action.input,old=x.replaces?documents.find(d=>d.docNo===x.replaces):null;
 if(x.replaces){ensure(old?.billingManaged?.kind==='bill'&&old.billingManaged.state==='issued','ใบวางบิลต้นฉบับเปลี่ยนสถานะแล้ว');ensure(text(x.reason,'เหตุผลแก้ไข',240).length>=3,'ระบุเหตุผลแก้ไขอย่างน้อย 3 ตัวอักษร');}
 const rows=validateRows(x,documents,today,{allowLock:x.replaces||''});
 if(old)ensure(old.billingManaged.partyKey===rows[0].partyKey,'ใบแทนต้องเป็นลูกค้าเดิม');
 ensure(validDate(x.dueDate)&&x.dueDate>=today,'วันนัดชำระใบวางบิลต้องไม่ก่อนวันนี้');
 const amount=safeSum(rows.map(r=>r.balanceCents)),issuer=issuerSnapshot(action.issuer);
 const d=baseDocument('BL',docNo,rows[0],today,issuer);
 return {...d,docName:'ใบวางบิล (BILLING NOTE)',status:'issued',subtotal:amount/100,vat:0,grandTotal:amount/100,refDocManual:rows.map(r=>r.invoiceNo).join(', '),
  items:rows.map(r=>({code:'',name:r.invoiceNo+' · รับแล้ว '+formatMoney(r.paidCents)+' · คงเหลือ '+formatMoney(r.balanceCents),qty:1,unit:'รายการ',price:r.balanceCents/100,total:r.balanceCents/100,discVal:0})),
  remark:String(x.note||'').slice(0,240),billingRows:clone(rows),
  billingManaged:{version:1,kind:'bill',state:'issued',partyKey:rows[0].partyKey,requestId:action.requestId,dueDate:x.dueDate,rootNos:rows.map(r=>r.rootNo),replaces:x.replaces||'',reason:String(x.reason||'').slice(0,240),actor:action.actor,issuedOn:today}};
}
export function prepareBatch(action,documents,today,numbers={}){
 const x=action.input,rows=validateRows({...x,kind:'payment'},documents,today),issuer=issuerSnapshot(action.issuer);
 const amount=moneyCents(x.amount);ensure(amount>0,'กรอกยอดรับเงินมากกว่า 0');ensure(x.verified===true,'ยืนยันตรวจยอดเงินเข้าจริงก่อน');
 ensure(validDate(x.date)&&x.date<=today,'วันที่รับเงินไม่ถูกต้อง');
 const reference=text(x.reference,'เลขอ้างอิงรับเงิน',80),allocations=x.allocations||{};
 ensure(Object.keys(allocations).every(id=>rows.some(r=>r.rootNo===id)),'มีการจัดสรรไปต้นทางที่ไม่ได้เลือก');
 const positive=rows.map(r=>({...r,amountCents:moneyCents(String(allocations[r.rootNo]||'0'))})).filter(r=>r.amountCents>0);
 ensure(positive.length>0&&safeSum(positive.map(r=>r.amountCents))===amount,'ยอดจัดสรรต้องเท่ากับยอดรับเงินครั้งนี้');
 ensure(positive.every(r=>r.amountCents<=r.balanceCents),'ยอดรับเงินเกินยอดค้าง');
 const groups=new Map(),roots=[];
 for(const [n,row]of positive.entries()){
  const root=documents.find(d=>d.docNo===row.rootNo),prefix=operationPrefix(root,{kind:'payment'});if(prefix==='RETAX')vatParties(row,issuer);
  const docNo=numbers[prefix]||prefix+'-DRAFT';
  const sub={kind:'payment',requestId:action.requestId+'-'+n,now:action.now,issuer,input:{amount:String(row.amountCents/100),date:x.date,reference,method:x.method,dueDate:x.dueDate,verified:true,proofNote:x.proofNote|| (action.proof?'หลักฐานรายการรับเงินรวม · '+action.proof.name:'')}};
  const result=applyOperation(root,sub,docNo,today,documents);
  const updated={...root,paymentLedger:result.ledger,isRevenue:result.ledger.delivered,status:result.summary.balanceCents===0?'paid':'partial'};
  updated.paymentLedger.payments.at(-1).batchId=numbers.batchId||'DRAFT';
  roots.push(updated);
  if(!groups.has(prefix))groups.set(prefix,{prefix,documents:[],rows:[]});
  const group=groups.get(prefix);group.documents.push(result.document);group.rows.push({...row,afterCents:row.balanceCents-row.amountCents,docNo,taxDocumentNo:root.paymentLedger.deliveryTaxDocNo||''});
 }
 ensure(positive.every(r=>!untrackedDocuments(documents.find(d=>d.docNo===r.rootNo),documents).length),'มีเอกสารเดิมที่ยังไม่ได้กระทบยอด');
 const proof=action.proof||null;
 if(proof)ensure(['image/png','image/jpeg','application/pdf'].includes(proof.type)&&/^data:(image\/(?:png|jpeg)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(proof.data||'')&&proof.data.length<=690000,'หลักฐานต้องเป็น PNG/JPG/PDF ไม่เกิน 500 KB');
 ensure(proof||String(x.proofNote||'').trim(),'แนบหลักฐานหรือกรอกรายละเอียดหลักฐานก่อน');
 const output=[];
 for(const group of groups.values()){
  const first=clone(group.documents[0]),sumField=key=>safeSum(group.documents.map(d=>moneyCents(d[key])));
  first.docNo=numbers[group.prefix]||group.prefix+'-DRAFT';first.items=group.rows.map((r,n)=>({...group.documents[n].items[0],name:'รับชำระตาม '+r.invoiceNo+(r.rootNo!==r.invoiceNo?' / '+r.rootNo:'')}));
  first.subtotal=sumField('subtotal')/100;first.vat=sumField('vat')/100;first.grandTotal=sumField('grandTotal')/100;
  first.customerId=group.rows[0].customerId;
  const billNos=[...new Set(group.rows.map(r=>r.billingLock?.billNo).filter(Boolean))];
  first.refDocManual=[...new Set(group.documents.flatMap(d=>String(d.refDocManual).split(',').map(x=>x.trim())).concat(group.rows.map(r=>r.invoiceNo)))].join(', ');
  if(billNos.length)first.refDocManual+=', '+billNos.join(', ');
  first.paymentManaged={...first.paymentManaged,requestId:action.requestId,rootNos:group.rows.map(r=>r.rootNo),batchId:numbers.batchId||'DRAFT'};
  first.paymentSummary={orderNo:group.rows.map(r=>r.invoiceNo).join(', '),totalCents:safeSum(group.rows.map(r=>r.totalCents)),paidBeforeCents:safeSum(group.rows.map(r=>r.paidCents)),paidCents:safeSum(group.rows.map(r=>r.paidCents+r.amountCents)),balanceCents:safeSum(group.rows.map(r=>r.afterCents)),receivedCents:moneyCents(first.grandTotal),dueDate:x.dueDate};
  first.collectionRows=clone(group.rows);first.collectionBillNos=billNos;first.remark='รับเงินรวม '+(numbers.batchId||'ฉบับร่าง')+' · '+x.method+' · อ้างอิง '+reference+'\n'+(billNos.length?'ใบวางบิล '+billNos.join(', ')+'\n':'')+group.rows.map(r=>r.invoiceNo+': รับ '+formatMoney(r.amountCents)+' คงเหลือ '+formatMoney(r.afterCents)).join('\n')+'\n'+(group.prefix==='RE'?'ใบเสร็จรับเงิน ไม่ออก VAT เพิ่ม':'ราคาและจำนวนเงินในตารางรวม VAT แล้ว');
  first.collectionInfo={method:x.method,reference,billNos,note:String(x.note||'').slice(0,240),proofNote:String(x.proofNote||'').slice(0,180)};
  if(String(x.note||'').trim())first.remark+='\n'+String(x.note).slice(0,240);
  if(proof)first.paymentProof=clone(proof);
  first.recordedBy=action.actor?.uid||'';output.push(first);
 }
 return {rows:positive,roots,documents:output,batch:{id:numbers.batchId||'DRAFT',requestId:action.requestId,date:x.date,reference:normalizeReference(reference),method:x.method,amountCents:amount,partyKey:rows[0].partyKey,...partySnapshot(rows[0]),rows:clone(output.flatMap(d=>d.collectionRows)),documentNos:output.map(d=>d.docNo),proofNote:String(x.proofNote||'').slice(0,240),actor:action.actor}};
}
export function billOutstanding(bill,documents){
 if(!bill?.billingRows)return null;
 let total=0;
 for(const row of bill.billingRows){const root=documents.find(d=>d.docNo===row.rootNo);if(!root?.paymentLedger||untrackedDocuments(root,documents).length)return null;total+=Math.max(0,row.balanceCents-Math.max(0,ledgerSummary(root).paid-row.paidCents));}
 return total;
}
