const {pathToFileURL}=require('node:url'),path=require('node:path'),assert=require('node:assert/strict');
const names=['payments-core.mjs','payments-firestore.mjs','billing-core.mjs','billing-firestore.mjs'];
exports.modules=Promise.all(names.map(n=>import(pathToFileURL(path.join(__dirname,'..',n)).href)));
exports.fixture=async()=>{
 const [payments,single,core,adapter]=await exports.modules,records=new Map(),versions=new Map();
 let uid='accountant',serial=0,deny=false,ackLoss=false,readHook=null;
 const api={db:{},today:()=> '2026-10-31',now:()=> '2026-10-31T10:00:00Z',getUserId:()=>uid,getActor:()=>({name:'บัญชีทดสอบ'}),
  newId:()=> 'accounting-request-'+String(++serial).padStart(8,'0'),userDoc:(c,id)=>uid+'/'+c+'/'+id,serverTimestamp:()=> 'server-time',
  getCompany:()=>({nameTh:'บริษัทผู้ออกทดสอบ',addressTh:'ที่อยู่บริษัท',taxId:'0105550000001',branch:'00000',logo:''}),isCompanyReady:()=>true,
  getDocFromServer:async ref=>({exists:()=>records.has(ref),data:()=>structuredClone(records.get(ref))}),
  readServerDocuments:async()=>[...records].filter(([k])=>k.startsWith(uid+'/documents/')).map(([,d])=>structuredClone(d)),
  readCollection:async name=>[...records].filter(([k])=>k.startsWith(uid+'/'+name+'/')).map(([k,d])=>({...structuredClone(d),id:k.split('/').at(-1)})),
  runTransaction:async(_db,fn)=>{
   for(let attempt=0;attempt<14;attempt++){
    const reads=new Map(),writes=[];let writing=false;
    const tx={get:async ref=>{assert.equal(writing,false,'all reads precede writes');const val=structuredClone(records.get(ref));reads.set(ref,versions.get(ref)||0);if(readHook){const h=readHook;readHook=null;h();}await Promise.resolve();return {exists:()=>val!==undefined,data:()=>val};},
     set:(ref,data,options)=>{writing=true;writes.push([ref,data,!!options?.merge]);},update:(ref,data)=>{writing=true;writes.push([ref,data,true]);}};
    const result=await fn(tx);
    if([...reads].some(([k,v])=>(versions.get(k)||0)!==v))continue;
    if(deny)throw Object.assign(new Error('permission denied'),{code:'permission-denied'});
    for(const [ref,data,merge]of writes){records.set(ref,structuredClone(merge?{...records.get(ref),...data}:data));versions.set(ref,(versions.get(ref)||0)+1);}
    if(ackLoss){ackLoss=false;throw new Error('response lost after commit');}
    return result;
   }throw new Error('transaction contention');
  }};
 const store=adapter.createBillingStore(api),singleStore=single.createPaymentStore(api);
 function put(c,id,data){records.set('accountant/'+c+'/'+id,structuredClone(data));}
 function get(c,id){return structuredClone(records.get('accountant/'+c+'/'+id));}
 function root(no,amount,mode='domestic-vat7',date='2026-10-01',due='2026-10-20'){
  const total=Math.round(amount*100),net=mode==='domestic-vat7'?Math.round(total*100/107):total;
  const r={docNo:no,prefix:'INV',docName:'ใบแจ้งหนี้',inputDate:date,rawDate:date+'T12:00:00+07:00',customerId:'C001',customerName:'บริษัทลูกค้าทดสอบ',customerTaxId:'0105550000002',customerBranch:'00000',customerAddr:'ที่อยู่ลูกค้า',customerEmail:'',grandTotal:amount,subtotal:net/100,vat:(total-net)/100,currency:'THB',items:[{code:'P001',name:'สินค้าทดสอบ',qty:1,unit:'รายการ',price:amount,total:amount}],status:'pending'};
  r.paymentLedger=payments.createLedger(r,mode,due,date,[]);return r;
 }
 function seed(){
  let first=root('INV-2026-001',60000);
  let initial=payments.applyOperation(first,{kind:'payment',requestId:'initial-payment-0001',now:'2026-10-05T12:00:00Z',input:{amount:'36000',date:'2026-10-05',reference:'INITIAL-1',method:'โอนธนาคาร',dueDate:'2026-10-20',verified:true,proofNote:'หลักฐานเริ่มต้น'}},'RETAX-2026-P000001',api.today());
  first.paymentLedger=initial.ledger;put('documents',first.docNo,first);put('documents',initial.document.docNo,initial.document);
  const second=root('INV-2026-002',15000,'domestic-vat7','2026-10-10','2026-11-10');put('documents',second.docNo,second);
  let third=root('INV-2026-003',10000,'receipt','2026-09-01','2026-10-01');
  initial=payments.applyOperation(third,{kind:'payment',requestId:'initial-payment-0003',now:'2026-10-12T12:00:00Z',input:{amount:'5000',date:'2026-10-12',reference:'INITIAL-3',method:'โอนธนาคาร',dueDate:'2026-10-20',verified:true,proofNote:'หลักฐานเริ่มต้น'}},'RE-2026-P000001',api.today());third.paymentLedger=initial.ledger;put('documents',third.docNo,third);put('documents',initial.document.docNo,initial.document);
 }
 async function action(kind,input){
  const loaded=await store.load(),r=core.receivables(loaded.documents,api.today(),api.today()).rows;
  const ids=input.ids||[];const body={...input};delete body.ids;
  if(ids.length)body.rows=r.filter(row=>ids.includes(row.rootNo)).map(core.rowExpectation);
  return {kind,input:body,requestId:api.newId(),expectedRevision:loaded.revision,issuer:api.getCompany(),now:api.now()};
 }
 async function issueBill(ids=['INV-2026-001','INV-2026-002'],more={}){
  return store.commit(await action('bill',{ids,dueDate:'2026-11-10',note:'',...more}));
 }
 async function batch(allocations={'INV-2026-001':'24000','INV-2026-002':'6000'},more={}){
  const amount=Object.values(allocations).reduce((s,v)=>s+Number(v),0);
  return action('payment',{ids:Object.keys(allocations),allocations,amount:String(amount),date:api.today(),reference:'BANK-NEW',method:'โอนธนาคาร',dueDate:'2026-11-15',proofNote:'ตรวจรายการธนาคารแล้ว',verified:true,...more});
 }
 return {api,core,payments,store,singleStore,records,versions,put,get,root,seed,action,issueBill,batch,setDeny:v=>deny=v,setAckLoss:v=>ackLoss=v,setUser:v=>uid=v,setReadHook:v=>readHook=v};
};
