const {pathToFileURL}=require('node:url');
const path=require('node:path');
const clone=v=>structuredClone(v);
exports.modules=Promise.all(['factory-core.mjs','factory-firestore.mjs','factory-ui.mjs'].map(n=>import(pathToFileURL(path.join(__dirname,'..',n)).href)));
exports.fixture=async()=>{
 const [core,adapter,ui]=await exports.modules;
 const records=new Map(),versions=new Map();let user='owner',counter=0,deny=false,ackLoss=false,getHook=null;
 const key=(c,id)=>user+'/'+c+'/'+id;
 const snap=ref=>({exists:()=>records.has(ref),data:()=>clone(records.get(ref))});
 const api={
  db:{},getUserId:()=>user,getActor:()=>({name:'ผู้ใช้ทดสอบ'}),today:()=> '2026-10-30',now:()=> '2026-10-30T08:00:00.000Z',
  newId:()=> 'request-'+String(++counter).padStart(8,'0'),userDoc:(c,id)=>key(c,id),serverTimestamp:()=> 'server-time',
  getDocFromServer:async ref=>snap(ref),
  readCollection:async c=>[...records.entries()].filter(([k])=>k.startsWith(user+'/'+c+'/')).map(([k,v])=>({...clone(v),id:k.split('/').at(-1)})),
  getProducts:()=>[{id:'p1',code:'P001',name:'สินค้าทดสอบ',unit:'ซอง',price:25}],getDocuments:()=>[{docNo:'SO-TEST',prefix:'SO',customerName:'ลูกค้าทดสอบ'}],getCompany:()=>({nameTh:'บริษัททดสอบ',logo:''}),
  watchMeta:()=>()=>{},
  runTransaction:async(_db,fn)=>{
   for(let attempt=0;attempt<12;attempt++){
    const reads=new Map(),writes=[];let hasWrites=false;
    const tx={get:async ref=>{if(hasWrites)throw new Error('Read after write');const ver=versions.get(ref)||0;reads.set(ref,ver);const value=snap(ref);if(getHook){const hook=getHook;getHook=null;hook();}await Promise.resolve();return value;},
     set:(ref,value)=>{hasWrites=true;writes.push([ref,clone(value)]);}};
    const result=await fn(tx);
    if(deny)throw Object.assign(new Error('permission denied'),{code:'permission-denied'});
    if([...reads].some(([ref,version])=>(versions.get(ref)||0)!==version))continue;
    for(const [ref,value]of writes){records.set(ref,value);versions.set(ref,(versions.get(ref)||0)+1);}
    if(ackLoss){ackLoss=false;throw new Error('response lost after commit');}
    return result;
   }throw new Error('transaction contention');
  }
 };
 const store=adapter.createFactoryStore(api);
 async function run(kind,input,requestId){const loaded=await store.load();return store.commit({kind,input,requestId:requestId||api.newId(),expectedRevision:loaded.meta.revision});}
 async function bootstrap({rawQty='50',bagQty='2000',requiredForms=[]}={}){
  const raw=(await run('item',{code:'RM001',name:'วัตถุดิบทดสอบ',unit:'กก.',kind:'RAW',precision:3,inspection:'fresh',needsAnalysis:true})).id;
  const bag=(await run('item',{code:'PK001',name:'ถุงทดสอบ',unit:'ใบ',kind:'PACK',precision:0})).id;
  const fg=(await run('item',{code:'P001',name:'สินค้าทดสอบ',unit:'ซอง',kind:'FG',precision:0,productCode:'P001'})).id;
  const recipe=(await run('recipe',{productItemId:fg,revision:'01',outputQty:'1000',approvalReference:'QP-TEST',approved:true,requiredForms,materials:[{itemId:raw,qty:'20'},{itemId:bag,qty:'1000'}]})).id;
  const a=(await run('receive',{itemId:raw,reference:'GRN-RAW',lotCode:'RAW-A',supplierLot:'S-A',supplier:'ผู้ขายทดสอบ',date:'2026-10-29',qty:rawQty,exp:'2027-01-01',verified:true})).id;
  const b=(await run('receive',{itemId:bag,reference:'GRN-BAG',lotCode:'BAG-A',supplier:'ผู้ขายทดสอบ',date:'2026-10-29',qty:bagQty,verified:true})).id;
  for(const id of[a,b])await run('inspect',{lotId:id,date:api.today(),decision:'released',values:{clean:true,foreign:true,spec:true,avl:true},analysisRef:'COA-TEST',note:'ตรวจตามเกณฑ์ทดสอบผ่าน',verified:true});
  return {raw,bag,fg,recipe,rawLot:a,bagLot:b};
 }
 async function plan(seed,qty='1000'){return run('plan',{recipeId:seed.recipe,qty,dueDate:'2026-11-02',customer:'ลูกค้าทดสอบ',candidateLotIds:[seed.rawLot,seed.bagLot]});}
 return {core,ui,api,store,run,bootstrap,plan,records,versions,setUser:v=>user=v,setDeny:v=>deny=v,setAckLoss:v=>ackLoss=v,setGetHook:v=>getHook=v,record:(c,id)=>clone(records.get('owner/factory_'+c+'/'+id))};
};
