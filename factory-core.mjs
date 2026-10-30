// Factory records are independent of commercial/tax documents. Quantities use integer thousandths.
export const FACTORY_COLLECTIONS=['items','recipes','lots','jobs','processes','inspections','shipments','events','returns'];
export const emptyFactoryData=()=>Object.fromEntries(FACTORY_COLLECTIONS.map(k=>[k,[]]));
export const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
export const clean=(v,label,max=120)=>{const s=String(v??'').normalize('NFKC').trim();ensure(s&&s.length<=max,'กรอก'+label+'ไม่เกิน '+max+' ตัวอักษร');return s;};
export const code=v=>clean(v,'รหัส',60).toUpperCase();
export const entityId=v=>encodeURIComponent(code(v));
export const keyId=(...parts)=>{const s=parts.map(x=>encodeURIComponent(String(x))).join(':');ensure(new TextEncoder().encode(s).length<1400,'เลขอ้างอิงยาวเกินไป');return s;};
export const day=(v,label='วันที่')=>{const s=String(v||'');ensure(/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s,'กรอก'+label+'ให้ถูกต้อง');return s;};
export function mills(value,precision=3,allowZero=false){
 const s=String(value??'').trim();ensure(/^\d+(\.\d{1,3})?$/.test(s),'จำนวนต้องเป็นเลขบวก รองรับทศนิยมไม่เกิน 3 ตำแหน่ง');
 const [a,b='']=s.split('.');ensure(b.length<=precision,'หน่วยนี้รองรับทศนิยม '+precision+' ตำแหน่ง');
 const n=Number(a)*1000+Number(b.padEnd(3,'0'));ensure(Number.isSafeInteger(n)&&n>=(allowZero?0:1)&&n<=1e12,'จำนวนอยู่นอกช่วงที่บันทึกได้');return n;
}
export const quantity=n=>(n/1000).toLocaleString('th-TH',{maximumFractionDigits:3});
export const released=(l,today)=>l.qa==='released'&&(!l.exp||l.exp>=today);
export const available=(l,today)=>released(l,today)?l.qtyMills-l.reservedMills:0;
export const labelActor=a=>a.name||a.uid;
const find=(ctx,c,id)=>ctx[c]?.[id]||null;
const need=(ctx,c,id,label)=>{const x=find(ctx,c,id);ensure(x,label||'ไม่พบข้อมูล '+c);return x;};
const actorSnapshot=a=>({uid:clean(a.uid,'บัญชีผู้บันทึก',128),name:clean(a.name||a.uid,'ชื่อผู้บันทึก',180)});
const itemSnap=i=>({id:i.id,code:i.code,name:i.name,unit:i.unit,kind:i.kind,precision:i.precision,needsAnalysis:!!i.needsAnalysis,inspection:i.inspection});
const lotSnap=l=>({id:l.id,itemId:l.itemId,code:l.code,supplierLot:l.supplierLot||'',received:l.received,mfg:l.mfg||'',exp:l.exp||'',sourceJob:l.sourceJob||'',item:l.item});
export function requiredMaterials(recipe,qtyMills){
 return recipe.materials.map(m=>{const step=10**(3-m.item.precision),num=BigInt(m.qtyMills)*BigInt(qtyMills),den=BigInt(recipe.outputMills)*BigInt(step);
  const n=Number((num+den-1n)/den)*step;ensure(Number.isSafeInteger(n)&&n>0&&n<=1e12,'จำนวนตามสูตรมากเกินไป');return {...m,qtyMills:n};});
}
export function allocateMaterials(data,recipe,qtyMills,due,today){
 const result=[];
 for(const m of requiredMaterials(recipe,qtyMills)){
  let left=m.qtyMills;
  const lots=data.lots.filter(l=>l.itemId===m.itemId&&available(l,today)>0&&(!l.exp||l.exp>=due)).sort((a,b)=>(a.exp||'9999').localeCompare(b.exp||'9999')||a.received.localeCompare(b.received)||a.id.localeCompare(b.id));
  for(const l of lots){const take=Math.min(left,available(l,today));if(take){result.push({lotId:l.id,itemId:m.itemId,qtyMills:take});left-=take;}if(!left)break;}
  ensure(!left,m.item.name+' ใช้ได้ไม่พอวันต้องการสินค้า · ขาด '+quantity(left)+' '+m.item.unit);
 }
 ensure(result.length<=80,'มี LOT ที่ต้องเบิกจำนวนมาก กรุณาแบ่งงานผลิต');return result;
}
export function readRefs(action,ctx={},phase=0){
 const x=action.input||{},refs=[],add=(c,id)=>{if(id&&!refs.some(r=>r[0]===c&&r[1]===id))refs.push([c,String(id)]);};
 if(phase===0){
  if(action.kind==='item')add('items',entityId(x.code));
  if(action.kind==='recipe'){add('items',x.productItemId);(x.materials||[]).forEach(m=>add('items',m.itemId));add('keys',keyId('recipe',x.productItemId,code(x.revision)));}
  if(action.kind==='receive'){add('items',x.itemId);add('keys',keyId('receipt',code(x.reference)));add('keys',keyId('lot',x.itemId,code(x.lotCode)));}
  if(action.kind==='plan'){add('recipes',x.recipeId);(x.candidateLotIds||[]).forEach(id=>add('lots',id));}
  if(['issue','process','produce','cancel','close'].includes(action.kind))add('jobs',x.jobId);
  if(['inspect','adjust','stockOut','quarantine'].includes(action.kind))add('lots',x.lotId);
  if(action.kind==='ship'){add('jobs',x.jobId);(x.lines||[]).forEach(r=>add('lots',r.lotId));add('keys',keyId('shipment',code(x.reference)));}
  if(action.kind==='return')add('shipments',x.shipmentId);
 }
 if(phase===1){
  const job=find(ctx,'jobs',x.jobId),l=find(ctx,'lots',x.lotId);
  if(action.kind==='plan'){const r=find(ctx,'recipes',x.recipeId);if(r){add('items',r.productItemId);r.materials.forEach(m=>add('items',m.itemId));}}
  if(['issue','cancel'].includes(action.kind)&&job)job.allocations.forEach(a=>add('lots',a.lotId));
  if(action.kind==='produce'&&job)add('keys',keyId('lot',job.product.id,code(x.lotCode)));
  if(action.kind==='inspect'&&l){add('items',l.itemId);if(l.sourceJob)add('jobs',l.sourceJob);}
  if(action.kind==='close'&&job)job.issues.forEach(i=>add('lots',i.lotId));
 }
 return refs;
}
export function applyFactoryAction(action,ctx,meta,actor,today){
 ensure(Number.isSafeInteger(meta.revision||0)&&(meta.revision||0)>=0,'รุ่นข้อมูลโรงงานไม่ถูกต้อง');
 const x=action.input||{},id=clean(action.requestId,'เลขรายการ',100),who=actorSnapshot(actor),now=clean(actor.now,'เวลาบันทึก',50),writes=[];
 const seq=(meta.sequence||0)+1;ensure(Number.isSafeInteger(seq)&&seq>0,'เลขลำดับไม่ถูกต้อง');
 const ref=prefix=>prefix+'-'+today.slice(0,4)+'-F'+String(seq).padStart(6,'0');
 const save=(c,r)=>{ensure(r.id,'ข้อมูลไม่มีรหัส');const i=writes.findIndex(w=>w.collection===c&&w.id===r.id);const w={collection:c,id:r.id,data:r};if(i<0)writes.push(w);else writes[i]=w;return r;};
 const get=(c,key,label)=>{const w=writes.find(w=>w.collection===c&&w.id===key);return w?.data||need(ctx,c,key,label);};
 const unique=k=>ensure(!find(ctx,'keys',k),'เลขอ้างอิง / LOT / Revision นี้มีอยู่แล้ว');
 const putKey=(k,target)=>{unique(k);save('keys',{id:k,target,requestId:id});};
 const actualDate=value=>{const d=day(value);ensure(d<=today,'วันที่ทำรายการจริงต้องไม่อยู่ในอนาคต');return d;};
 let result={},description='',physical=[];
 if(action.kind==='item'){
  const c=code(x.code),key=entityId(c);ensure(!find(ctx,'items',key),'รหัสรายการคลังนี้มีอยู่แล้ว');ensure(['RAW','PACK','FG'].includes(x.kind),'เลือกประเภทสินค้า');
  const precision=Number(x.precision);ensure(Number.isInteger(precision)&&precision>=0&&precision<=3,'ทศนิยมต้องเป็น 0–3');
  const r={id:key,code:c,name:clean(x.name,'ชื่อรายการ'),unit:clean(x.unit,'หน่วย',25),kind:x.kind,precision,productCode:String(x.productCode||'').slice(0,60),needsAnalysis:!!x.needsAnalysis||x.inspection==='fresh',inspection:x.inspection==='fresh'?'fresh':'material',createdBy:who,createdAt:now};
  save('items',r);result={id:key};description='เพิ่มรายการคลัง '+c+' / '+r.unit;
 }else if(action.kind==='recipe'){
  const product=get('items',x.productItemId);ensure(product.kind==='FG','สูตรต้องอ้างอิงสินค้าสำเร็จรูป');ensure(x.approved===true,'ยืนยันสูตรที่ได้รับอนุมัติก่อนบันทึก');
  ensure(Array.isArray(x.materials)&&x.materials.length>0&&x.materials.length<=30,'ระบุวัตถุดิบ / บรรจุภัณฑ์ 1–30 รายการ');
  const seen=new Set(),materials=x.materials.map(m=>{ensure(!seen.has(m.itemId),'วัสดุซ้ำในสูตร');seen.add(m.itemId);const item=get('items',m.itemId);ensure(item.kind!=='FG','เลือกวัสดุจากประเภทวัตถุดิบ / บรรจุภัณฑ์');return {itemId:item.id,item:itemSnap(item),qtyMills:mills(m.qty,item.precision)};});
  const revision=code(x.revision);putKey(keyId('recipe',product.id,revision),id);
  const requiredForms=[...new Set(x.requiredForms||[])];ensure(requiredForms.every(s=>['PC09','PC10','PC11'].includes(s)),'ขั้นตอนการผลิตไม่ถูกต้อง');
  save('recipes',{id,productItemId:product.id,product:itemSnap(product),revision,outputMills:mills(x.outputQty,product.precision),materials,requiredForms,approvalReference:clean(x.approvalReference,'เอกสารอนุมัติสูตร',160),createdBy:who,createdAt:now});
  result={id};description='บันทึกสูตร '+product.code+' Rev.'+revision;
 }else if(action.kind==='receive'){
  const item=get('items',x.itemId),qty=mills(x.qty,item.precision),reference=code(x.reference),lotCode=code(x.lotCode),received=actualDate(x.date),exp=x.exp?day(x.exp,'EXP'):'',mfg=x.mfg?day(x.mfg,'MFG'):'';
  ensure(!mfg||mfg<=received,'MFG ต้องไม่หลังวันรับ');ensure(!exp||!mfg||exp>=mfg,'EXP ต้องไม่ก่อน MFG');if(item.kind==='FG')ensure(exp,'ระบุ EXP ตามสเปกสินค้า');
  ensure(x.verified===true,'ยืนยันรับของจริง / ตรวจนับยอดยกมาแล้ว');
  putKey(keyId('receipt',reference),id);putKey(keyId('lot',item.id,lotCode),id);
  const r={id,itemId:item.id,item:itemSnap(item),code:lotCode,supplierLot:String(x.supplierLot||'').trim().slice(0,80),supplier:clean(x.supplier,'ผู้ขาย / ที่มายอดยกมา',160),reference,received,mfg,exp,qtyMills:qty,reservedMills:0,qa:'held',source:x.opening?'opening':'receive',createdBy:who,createdAt:now};
  save('lots',r);physical.push({lotId:id,itemId:item.id,inMills:qty,outMills:0,afterMills:qty,unit:item.unit,lotCode});result={id,reference};description=(x.opening?'ตั้งยอดยกมา ':'รับเข้า ')+reference+' / '+lotCode;
 }else if(action.kind==='plan'){
  const recipe=get('recipes',x.recipeId),product=get('items',recipe.productItemId),qty=mills(x.qty,product.precision),due=day(x.dueDate,'วันต้องการสินค้า');ensure(due>=today,'วันต้องการสินค้าต้องไม่ก่อนวันนี้');
  const lots=Object.values(ctx.lots||{}),allocations=allocateMaterials({lots},recipe,qty,due,today);
  for(const a of allocations){const l=get('lots',a.lotId);save('lots',{...l,reservedMills:l.reservedMills+a.qtyMills});}
  const productionType=x.productionType==='stock'?'stock':'order';
  const docNo=ref('PDO'),r={id,docNo,product:itemSnap(product),recipe:JSON.parse(JSON.stringify(recipe)),qtyMills:qty,dueDate:due,date:today,productionType,customer:productionType==='stock'?'ผลิตเก็บสต๊อก':clean(x.customer,'ลูกค้า',180),salesReference:String(x.salesReference||'').trim().slice(0,80),stage:'planned',allocations,issues:[],processes:[],batches:[],qa:[],closed:false,shippedMills:0,createdBy:who,createdAt:now};
  save('jobs',r);result={id,reference:docNo};description='จองวัสดุให้ '+docNo;
 }else if(action.kind==='issue'){
  const job=get('jobs',x.jobId);ensure(job.stage==='planned'&&!job.closed,'งานนี้ยังไม่พร้อมเบิก หรือเบิกแล้ว');const issuedDate=actualDate(x.date);
  ensure(Array.isArray(x.lines)&&x.lines.length===job.allocations.length,'กรอกจำนวนเบิกทุก LOT');const seen=new Set(),issues=[];
  for(const a of job.allocations){
   const input=x.lines.find(r=>r.lotId===a.lotId);ensure(input&&!seen.has(input.lotId),'LOT เบิกไม่ตรงรายการจอง');seen.add(input.lotId);
   const l=get('lots',a.lotId),qty=mills(input.qty,l.item.precision,true);ensure(issuedDate>=l.received,'วันที่เบิกต้องไม่ก่อนวันที่รับ LOT');ensure(released(l,today),'LOT ยังไม่ผ่าน QA หรือหมดอายุ');ensure(qty<=l.qtyMills-(l.reservedMills-a.qtyMills),'ยอดเบิกเกินของที่ใช้ได้');
   if(qty!==a.qtyMills)clean(x.varianceNote,'เหตุผลจำนวนจริงต่างจากแผน',240);
   save('lots',{...l,qtyMills:l.qtyMills-qty,reservedMills:l.reservedMills-a.qtyMills});if(qty){issues.push({...lotSnap(l),lotId:l.id,qtyMills:qty,date:issuedDate,actor:who});physical.push({lotId:l.id,itemId:l.itemId,inMills:0,outMills:qty,afterMills:l.qtyMills-qty,unit:l.item.unit,lotCode:l.code});}
  }
  ensure(issues.length,'ต้องมีการเบิกอย่างน้อยหนึ่งรายการ');save('jobs',{...job,stage:'issued',issues,issuedBy:who,issuedAt:now,varianceNote:String(x.varianceNote||'').slice(0,240)});result={id:job.id};description='เบิก / ชั่งจริง '+job.docNo;
 }else if(action.kind==='process'){
  const job=get('jobs',x.jobId);ensure(job.stage==='issued'&&!job.closed,'บันทึกกระบวนการได้ระหว่างงานผลิต');
  ensure(['PC09','PC10','PC11'].includes(x.form),'เลือกแบบบันทึก');ensure(x.verified===true,'ยืนยันข้อมูลจากการปฏิบัติงานจริง');
  const dateValue=actualDate(x.date),values=x.values||{};ensure(typeof values==='object'&&!Array.isArray(values),'ข้อมูลขั้นตอนไม่ถูกต้อง');
  const schema=PROCESS_FIELDS[x.form];
  const captured={};for(const field of schema){const val=values[field.id];if(field.type==='number'){const n=Number(val);ensure(String(val??'').trim()&&Number.isFinite(n),'กรอก'+field.label);captured[field.id]=n;}else{captured[field.id]=clean(val,field.label,100);if(field.type==='time')ensure(/^([01]\d|2[0-3]):[0-5]\d$/.test(captured[field.id]),'รูปแบบเวลาต้องเป็น HH:MM');}}
  if(captured.start&&captured.end)ensure(captured.start<=captured.end,'เวลาเริ่มต้องไม่หลังเวลาเสร็จ (แยกบันทึกหากข้ามวัน)');
  const r={id,jobId:job.id,jobNo:job.docNo,form:x.form,date:dateValue,values:captured,note:String(x.note||'').trim().slice(0,240),actor:who,createdAt:now};
  save('processes',r);save('jobs',{...job,processes:[...job.processes,{id,form:x.form,date:dateValue}]});result={id,jobId:job.id};description='บันทึก '+x.form+' / '+job.docNo;
 }else if(action.kind==='produce'){
  const job=get('jobs',x.jobId);ensure(job.stage==='issued'&&!job.closed,'ต้องเบิกวัตถุดิบก่อนรับผลผลิต');
  for(const form of job.recipe.requiredForms)ensure(job.processes.some(r=>r.form===form),'ยังไม่มีบันทึกขั้นตอน '+form+' ตามสูตร');
  const qty=mills(x.qty,job.product.precision),lotCode=code(x.lotCode),mfg=actualDate(x.mfg),exp=day(x.exp,'EXP'),received=actualDate(x.date);ensure(mfg<=received&&exp>=mfg,'ตรวจ MFG / EXP และวันที่รับจริง');ensure(job.issues.every(i=>received>=i.date),'รับผลผลิตต้องไม่ก่อนวันที่เบิกวัสดุจริง');ensure(x.verified===true,'ยืนยันจำนวนผลิตได้จริงแล้ว');
  const produced=job.batches.reduce((s,b)=>s+b.qtyMills,0);if(produced+qty>job.qtyMills)clean(x.varianceNote,'เหตุผลผลผลิตเกินแผน',240);
  putKey(keyId('lot',job.product.id,lotCode),id);
  const l={id,itemId:job.product.id,item:job.product,code:lotCode,supplierLot:'',supplier:job.docNo,reference:ref('FGR'),received,mfg,exp,qtyMills:qty,reservedMills:0,qa:'held',source:'produce',sourceJob:job.id,createdBy:who,createdAt:now};
  save('lots',l);save('jobs',{...job,batches:[...job.batches,{lotId:id,code:lotCode,qtyMills:qty,mfg,exp,received,actor:who}],lastProducedAt:now});
  physical.push({lotId:id,itemId:l.itemId,inMills:qty,outMills:0,afterMills:qty,unit:l.item.unit,lotCode});result={id,jobId:job.id,reference:l.reference};description='รับผลผลิตจริง '+lotCode+' / '+job.docNo;
 }else if(action.kind==='inspect'){
  const l=get('lots',x.lotId),item=get('items',l.itemId);ensure(l.qa!=='released','LOT นี้อนุมัติแล้ว');ensure(['released','held','rejected'].includes(x.decision),'เลือกผลการตรวจ');
  const values=x.values||{},note=clean(x.note,'ผลตรวจ / การแก้ไข',240);const sample=x.sampleQty?mills(x.sampleQty,0):0;
  if(x.decision==='released'){
   ensure(!l.exp||l.exp>=today,'LOT หมดอายุแล้ว ปล่อยใช้ / จัดส่งไม่ได้');ensure(x.verified===true,'ยืนยันผลตรวจจริงแล้ว');
   if(item.kind==='FG'){ensure(values.package===true&&values.label===true&&values.code===true&&values.seal==='pass'&&sample>0,'ยืนยันผลบรรจุ ฉลาก โค้ด และผลตรวจซีลให้ครบ');clean(x.samplingPlan,'เอกสารแผนสุ่มที่ QA อนุมัติ',120);}
   else{ensure(values.clean===true&&values.foreign===true&&values.spec===true,'ผลตรวจต้องผ่านข้อกำหนดที่เกี่ยวข้อง');if(item.inspection==='fresh')ensure(values.avl===true,'ยืนยันผู้ขายตาม AVL');if(item.needsAnalysis)clean(x.analysisRef,'หลักฐานผลวิเคราะห์',120);}
  }
  const inspectedDate=actualDate(x.date);ensure(inspectedDate>=l.received,'วันที่ตรวจต้องไม่ก่อนวันที่รับ LOT');
  const r={id,lotId:l.id,itemId:l.itemId,lotCode:l.code,item:l.item,sourceJob:l.sourceJob||'',date:inspectedDate,decision:x.decision,values,sampleCount:sample/1000,samplingPlan:String(x.samplingPlan||'').slice(0,120),analysisRef:String(x.analysisRef||'').slice(0,120),note,actor:who,createdAt:now};
  save('inspections',r);save('lots',{...l,qa:x.decision,lastInspection:id});if(l.sourceJob){const j=get('jobs',l.sourceJob);save('jobs',{...j,qa:[...j.qa,id]});}result={id,lotId:l.id};description='ตรวจ LOT '+l.code+' / '+x.decision;
 }else if(action.kind==='ship'){
  const job=get('jobs',x.jobId),reference=code(x.reference),checks=x.checks||{};ensure(x.verified===true,'ยืนยันจ่ายของจริงและตรวจรถแล้ว');
  ensure(VEHICLE_FIELDS.every(f=>['pass','fixed'].includes(checks[f.id])),'ตรวจรถให้ครบ และแก้รายการที่ไม่ผ่านก่อนจัดส่ง');if(Object.values(checks).includes('fixed'))clean(x.note,'รายละเอียดการแก้ไขก่อนจัดส่ง',240);
  ensure(Array.isArray(x.lines)&&x.lines.length>0&&x.lines.length<=40,'เลือก LOT จัดส่ง');const seen=new Set(),lines=[];
  for(const r of x.lines){ensure(!seen.has(r.lotId),'LOT ซ้ำในใบส่งของ');seen.add(r.lotId);const l=get('lots',r.lotId);ensure(l.sourceJob===job.id&&l.item.kind==='FG','LOT ไม่ตรงงานผลิต');ensure(released(l,today),'LOT ยังไม่ผ่าน QA หรือหมดอายุ');const q=mills(r.qty,l.item.precision);ensure(q<=available(l,today),'จำนวนส่งเกินของพร้อมจัดส่ง');save('lots',{...l,qtyMills:l.qtyMills-q});lines.push({...lotSnap(l),lotId:l.id,qtyMills:q,returnedMills:0});physical.push({lotId:l.id,itemId:l.itemId,inMills:0,outMills:q,afterMills:l.qtyMills-q,unit:l.item.unit,lotCode:l.code});}
  putKey(keyId('shipment',reference),id);const dateValue=actualDate(x.date);ensure(lines.every(l=>dateValue>=l.received),'วันที่ส่งต้องไม่ก่อนวันที่รับสินค้าจริง');ensure(/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time),'กรอกเวลาตรวจ / จัดส่ง');
  const r={id,reference,jobId:job.id,jobNo:job.docNo,customer:clean(x.customer??(job.productionType==='stock'?'':job.customer),'ลูกค้าที่จัดส่งจริง',180),lines,date:dateValue,time:x.time,destination:clean(x.destination,'สถานที่ส่ง',240),vehicle:clean(x.vehicle,'ทะเบียนรถ',80),driver:clean(x.driver,'พนักงานขนส่ง',100),invoice:String(x.invoice||'').slice(0,80),note:String(x.note||'').slice(0,240),checks,actor:who,createdAt:now};
  save('shipments',r);save('jobs',{...job,shippedMills:job.shippedMills+lines.reduce((n,l)=>n+l.qtyMills,0)});result={id,reference};description='จ่ายสินค้า / จัดส่ง '+reference;
 }else if(action.kind==='cancel'){
  const job=get('jobs',x.jobId);ensure(job.stage==='planned'&&!job.closed,'ยกเลิกได้ก่อนเบิกจริง');const note=clean(x.note,'เหตุผลยกเลิก',240);
  for(const a of job.allocations){const l=get('lots',a.lotId);ensure(l.reservedMills>=a.qtyMills,'ยอดจองไม่ตรง');save('lots',{...l,reservedMills:l.reservedMills-a.qtyMills});}
  save('jobs',{...job,stage:'cancelled',closed:true,cancelReason:note,cancelledBy:who});result={id:job.id};description='ยกเลิก / ปล่อยจอง '+job.docNo;
 }else if(action.kind==='quarantine'){
  const l=get('lots',x.lotId),note=clean(x.note,'เหตุผลกักกัน LOT',240);ensure(x.verified===true,'ยืนยันการกักกัน LOT');save('lots',{...l,qa:'held',holdReason:note,heldBy:who});result={id:l.id};description='กักกัน / หยุดใช้และจัดส่ง '+l.code+' / '+note;
 }else if(action.kind==='adjust'||action.kind==='stockOut'){
  const l=get('lots',x.lotId),note=clean(x.note,'เหตุผล / หลักฐาน',240);ensure(x.verified===true,'ยืนยันตรวจนับ / จ่ายของจริงแล้ว');
  const target=action.kind==='adjust'?mills(x.qty,l.item.precision,true):l.qtyMills-mills(x.qty,l.item.precision);
  ensure(target>=l.reservedMills&&target>=0,'ยอดใหม่ต้องไม่ต่ำกว่าของที่จอง');ensure(target!==l.qtyMills,'ไม่มีส่วนต่างให้บันทึก');
  const delta=target-l.qtyMills;save('lots',{...l,qtyMills:target});physical.push({lotId:l.id,itemId:l.itemId,inMills:Math.max(0,delta),outMills:Math.max(0,-delta),afterMills:target,unit:l.item.unit,lotCode:l.code});result={id:l.id};description=(action.kind==='adjust'?'ปรับยอดตรวจนับ ':'จ่ายออก / คืนผู้ขาย ')+l.code+' / '+note;
 }else if(action.kind==='return'){
  const shipment=get('shipments',x.shipmentId),source=shipment.lines.find(l=>l.lotId===x.lotId);ensure(source,'LOT ไม่ตรงใบส่งของ');const q=mills(x.qty,source.item.precision),note=clean(x.note,'เหตุผลรับคืน',240);ensure(q<=source.qtyMills-source.returnedMills,'รับคืนเกินยอดส่งที่ยังไม่เคยคืน');ensure(x.verified===true,'ยืนยันรับของคืนจริงแล้ว');
  const returnDate=actualDate(x.date);ensure(returnDate>=shipment.date,'วันที่รับคืนต้องไม่ก่อนวันที่จัดส่ง');
  const l={...source,id,itemId:source.itemId,item:source.item,code:source.code+'-RT-'+seq,qtyMills:q,reservedMills:0,qa:'held',received:returnDate,reference:ref('RTN'),source:'return',sourceShipment:shipment.id,createdBy:who,createdAt:now};
  delete l.returnedMills;delete l.lotId;save('lots',l);save('returns',{id,shipmentId:shipment.id,sourceLotId:source.lotId,lotId:id,qtyMills:q,date:l.received,note,actor:who});
  save('shipments',{...shipment,lines:shipment.lines.map(r=>r.lotId===source.lotId?{...r,returnedMills:r.returnedMills+q}:r)});
  physical.push({lotId:id,itemId:l.itemId,inMills:q,outMills:0,afterMills:q,unit:l.item.unit,lotCode:l.code});result={id};description='รับคืนอ้างอิง '+shipment.reference+' / '+source.code;
 }else if(action.kind==='close'){
  const job=get('jobs',x.jobId);ensure(job.stage==='issued'&&!job.closed&&job.batches.length,'บันทึกผลผลิตก่อนปิดงาน');ensure(x.verified===true,'ยืนยันกระทบยอดวัสดุแล้ว');ensure(Array.isArray(x.lines)&&x.lines.length===job.issues.length,'กรอกยอดใช้ / คืน / เสียหายทุก LOT');const reconciled=[];
  for(const issued of job.issues){
   const line=x.lines.find(r=>r.lotId===issued.lotId);ensure(line,'รายการ LOT ไม่ครบ');const precision=issued.item.precision,used=mills(line.used,precision,true),returned=mills(line.returned,precision,true),scrap=mills(line.scrap,precision,true);
   ensure(used+returned+scrap===issued.qtyMills,'ยอดใช้ + คืน + เสียหาย ต้องเท่ากับที่เบิก '+issued.code);
   if(returned){const original=get('lots',issued.lotId),returnId=id+'-'+reconciled.length,l={...original,id:returnId,code:original.code+'-MR-'+seq,reference:ref('MR'),received:actualDate(x.date),qtyMills:returned,reservedMills:0,qa:'held',source:'materialReturn',sourceJob:'',returnFromJob:job.id,sourceLotId:original.id,createdBy:who,createdAt:now};save('lots',l);physical.push({lotId:returnId,itemId:l.itemId,inMills:returned,outMills:0,afterMills:returned,unit:l.item.unit,lotCode:l.code});}
   reconciled.push({lotId:issued.lotId,usedMills:used,returnedMills:returned,scrapMills:scrap});
  }
  save('jobs',{...job,closed:true,reconciled,closedBy:who,closedAt:now,closeNote:clean(x.note,'ผลกระทบยอดวัสดุ',240)});result={id:job.id};description='ปิดยอดวัสดุ '+job.docNo;
 }else throw new Error('ไม่รู้จักรายการโรงงาน');
 for(const w of writes){if(w.collection==='lots'){const l=w.data;ensure(Number.isSafeInteger(l.qtyMills)&&Number.isSafeInteger(l.reservedMills)&&l.qtyMills>=l.reservedMills&&l.reservedMills>=0,'ยอด LOT ไม่สมดุล');}}
 const event={id,sequence:seq,kind:action.kind,date:x.date||today,description,physical,actor:who,createdAt:now,result};
 save('events',event);
 for(const w of writes)ensure(new TextEncoder().encode(JSON.stringify(w.data)).length<800000,'ข้อมูลรายการใหญ่เกินไป กรุณาแบ่งงาน / หลักฐาน');
 return {writes,event,result,meta:{revision:(meta.revision||0)+1,sequence:seq}};
}
export const PROCESS_FIELDS={
 PC09:[{id:'wash1',label:'ล้างครั้งที่ 1 / ผลจริง',type:'text'},{id:'wash2',label:'ล้างครั้งที่ 2 / ผลจริง',type:'text'},{id:'blade',label:'สภาพใบมีด',type:'text'},{id:'belt',label:'สภาพสายพาน',type:'text'},{id:'clean',label:'ความสะอาดเครื่อง',type:'text'},{id:'slice',label:'ความหนาสไลด์ / หน่วย',type:'text'},{id:'air',label:'การผึ่ง / ไม่ใช้พร้อมเหตุผล',type:'text'},{id:'dome',label:'การตากในโดม / ไม่ใช้พร้อมเหตุผล',type:'text'}],
 PC10:[{id:'start',label:'เวลาเริ่มอบ (HH:MM)',type:'time'},{id:'temperature',label:'อุณหภูมิที่วัดจริง (°C)',type:'number'},{id:'end',label:'เวลาอบเสร็จ (HH:MM)',type:'time'}],
 PC11:[{id:'water',label:'เวลาเริ่มเทน้ำ',type:'text'},{id:'mix',label:'เวลาเทส่วนผสม',type:'text'},{id:'boil',label:'การเคี่ยว / เวลา',type:'text'},{id:'finished',label:'เวลาเคี่ยวเสร็จ',type:'text'},{id:'cool',label:'พักให้เย็น',type:'text'},{id:'oven',label:'การอบ / ไม่ใช้พร้อมเหตุผล',type:'text'},{id:'coat',label:'การคลุก / ไม่ใช้พร้อมเหตุผล',type:'text'}]
};
export const VEHICLE_FIELDS=[{id:'oil',label:'น้ำมันเครื่อง'},{id:'water',label:'น้ำกลั่น'},{id:'tires',label:'ล้อรถ'},{id:'clean',label:'ความสะอาด'},{id:'pests',label:'สัตว์พาหะ'},{id:'stack',label:'การจัดเรียงสินค้า'},{id:'dress',label:'การแต่งกายพนักงาน'}];
