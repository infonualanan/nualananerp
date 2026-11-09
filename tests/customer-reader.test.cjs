const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const mod=import('../server/customer-reader.mjs'),core=import('../customer-intake-core.mjs');
const image=fs.readFileSync(path.join(__dirname,'../assets/ocr-connection-test.png')).toString('base64');
// Synthetic fixtures only, with deliberately non-production contact identifiers.
const candidate=(extra={})=>({name:'บริษัทตัวอย่าง AI จำกัด',contactName:null,email:'contact@example.invalid',phone:null,taxId:null,registrationNo:null,branch:null,address:'ที่อยู่ทดสอบ',role:'company',warnings:[],...extra});
const extraction=(rows=[candidate()])=>({readable:true,candidates:rows,warnings:[]});
async function fixture(overrides={}){const {createCustomerReader}=await mod;let calls=0,last;
 const handler=createCustomerReader({verifyToken:async token=>{assert.equal(token,'firebase.token');return {uid:'test-owner'}},allowedUids:()=>['test-owner'],getGatewayToken:async()=> 'private-oidc',fetchImpl:async(url,options)=>{calls++;last={url,options};return {ok:true,json:async()=>({status:'completed',model:'openai/gpt-4.1-mini',output_text:JSON.stringify(extraction())})}},...overrides});
 async function call(change={}){let status,body;const headers={};await handler({method:'POST',headers:{authorization:'Bearer firebase.token',origin:'https://erp.example',host:'erp.example'},body:{text:'ข้อมูลบริษัทสมมติ',requestId:'customer-request-0001'},...change},{setHeader(k,v){headers[k]=v},status(n){status=n;return this},json(v){body=v;return v}});return {status,body,headers};}
 return {call,get calls(){return calls},get last(){return last}};
}
test('customer AI checks authentication and existing account allowlist before provider access',async()=>{
 for(const [overrides,change,status] of [[{},{headers:{}},401],[{verifyToken:async()=>{throw Error('expired')}},{},401],[{allowedUids:()=>[]},{},503],[{allowedUids:()=>['another-user']},{},403]]){const f=await fixture(overrides),r=await f.call(change);assert.equal(r.status,status);assert.equal(f.calls,0);assert.equal(r.headers['Cache-Control'],'no-store');}
});
test('text extraction uses current gateway integration, strict schema, and never returns credentials',async()=>{
 const f=await fixture(),r=await f.call();assert.equal(r.status,200);assert.equal(r.body.extraction.candidates[0].address,'ที่อยู่ทดสอบ');assert.equal(f.last.url,'https://ai-gateway.vercel.sh/v1/responses');
 const sent=JSON.parse(f.last.options.body);assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(sent.text.format.schema.additionalProperties,false);assert.equal(sent.input[1].content.length,1);
 assert.equal(f.last.options.headers.Authorization,'Bearer private-oidc');assert.doesNotMatch(JSON.stringify(r.body),/private-oidc|firebase.token/);
});
test('image plus pasted text stay in one source request; PDF and spoofed images are rejected',async()=>{
 const f=await fixture(),r=await f.call({body:{requestId:'customer-request-img',text:'บริษัท A',image:{mimeType:'image/png',data:image}}});assert.equal(r.status,200);
 const sent=JSON.parse(f.last.options.body);assert.equal(sent.input[1].content[1].type,'input_image');assert.equal(sent.input[1].content[1].detail,'high');assert.ok(sent.input[1].content[1].image_url.endsWith(image));
 for(const mimeType of ['application/pdf','text/html','image/jpeg']){const g=await fixture(),x=await g.call({body:{requestId:'customer-image-bad',image:{mimeType,data:image}}});assert.equal(x.status,415);assert.equal(g.calls,0);}
});
test('oversized, empty and malformed inputs cannot consume AI credits',async()=>{
 for(const body of [{text:'',requestId:'customer-empty-001'},{text:'x'.repeat(16001),requestId:'customer-text-limit'},{text:'test',requestId:'bad'},{image:{mimeType:'image/png',data:'?'},requestId:'customer-bad-base64'}]){const f=await fixture(),r=await f.call({body});assert.ok([400,413].includes(r.status));assert.equal(f.calls,0);}
});
test('multiple companies remain separate and unknown fields are not invented or copied across identifiers',async()=>{
 const {normalizeCustomerExtraction,customerFillPlan}=await core;
 const r=normalizeCustomerExtraction(extraction([candidate({name:'Buyer',role:'buyer',taxId:null,registrationNo:'TEST-REG-A'}),candidate({name:'Seller',role:'seller',address:'Seller address'})]));
 assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].taxId,null);assert.equal(r.candidates[0].registrationNo,'TEST-REG-A');assert.equal(r.candidates[1].address,'Seller address');
 const plan=customerFillPlan({name:'User typed name',phone:'User phone',branch:'สำนักงานใหญ่'},candidate({phone:'AI phone'}));assert.equal(plan.updates.name,undefined);assert.equal(plan.updates.phone,undefined);assert.equal(plan.updates.branch,undefined);assert.ok(plan.kept.includes('name'));
 const empty=customerFillPlan({branch:'สำนักงานใหญ่'},candidate(),'empty',true);assert.equal(empty.updates.branch,'');
});
test('same input and request can replay without another provider call; changed source cannot reuse it',async()=>{
 const f=await fixture(),a=await f.call(),b=await f.call();assert.deepEqual(a.body,b.body);assert.equal(f.calls,1);
 const c=await f.call({body:{requestId:'customer-request-0001',text:'different company'}});assert.equal(c.status,409);assert.equal(c.body.code,'request_changed');assert.equal(f.calls,1);
});
test('in-flight requests cannot create duplicate provider calls',async()=>{
 let started,finish;const began=new Promise(r=>started=r),done=new Promise(r=>finish=r);let bills=0;
 const f=await fixture({fetchImpl:async()=>{bills++;started();await done;return {ok:true,json:async()=>({output_text:JSON.stringify(extraction())})}}});
 const first=f.call();await began;const second=await f.call();assert.equal(second.status,409);assert.equal(second.body.code,'read_in_progress');assert.equal(bills,1);finish();assert.equal((await first).status,200);
});
test('billing, refusal, incomplete and invalid AI output remain explicit instead of fabricated form data',async()=>{
 for(const response of [{ok:false,status:402,json:async()=>({error:{code:'insufficient_funds',message:'private-details'}})},{ok:true,json:async()=>({status:'incomplete'})},{ok:true,json:async()=>({output:[{content:[{type:'refusal'}]}]})},{ok:true,json:async()=>({output_text:JSON.stringify(extraction([{name:'missing fields'}]))})}]){
  const f=await fixture({fetchImpl:async()=>response}),r=await f.call();assert.ok([422,502,503].includes(r.status));assert.ok(!r.body.extraction);assert.doesNotMatch(JSON.stringify(r.body),/private-details/);
 }
});
test('cross-origin requests and rapid distinct attempts are stopped before extra reads',async()=>{
 const f=await fixture(),bad=await f.call({headers:{authorization:'Bearer firebase.token',host:'erp.example',origin:'https://another.example'}});assert.equal(bad.status,403);assert.equal(f.calls,0);
 for(let i=0;i<6;i++)assert.equal((await f.call({body:{text:'บริษัทตัวอย่าง',requestId:'customer-sequence-'+i}})).status,200);
 assert.equal((await f.call({body:{text:'test',requestId:'customer-sequence-7'}})).status,429);assert.equal(f.calls,6);
});
test('metadata status does not perform AI extraction and missing fields remain null',async()=>{
 const f=await fixture(),r=await f.call({method:'GET'});assert.equal(r.status,200);assert.equal(r.body.ready,true);assert.equal(f.calls,0);
 const {normalizeCustomerExtraction}=await core,r2=normalizeCustomerExtraction(extraction([candidate({email:'not an email',phone:'๐๑-๒๓',name:null})]));assert.equal(r2.candidates[0].email,null);assert.equal(r2.candidates[0].phone,'01-23');assert.equal(r2.candidates[0].name,null);
});
