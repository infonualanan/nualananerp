const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const modulePromise=import('../customer-intake-ui.mjs'),corePromise=import('../customer-intake-core.mjs');
const tick=()=>new Promise(r=>setTimeout(r,5));
const candidate=(extra={})=>({name:'บริษัทตัวอย่าง AI จำกัด',contactName:'ผู้ติดต่อสมมติ',email:'contact@example.invalid',phone:'TEST-PHONE',taxId:null,registrationNo:'TEST-REGISTRATION',branch:null,address:'ที่อยู่ตัวอย่าง',role:'company',warnings:[],...extra});
const response=(rows=[candidate()])=>({ok:true,json:async()=>({extraction:{readable:true,candidates:rows,warnings:[]}})});
async function fixture(t,options={}){
 const {createCustomerIntake}=await modulePromise,{CUSTOMER_FIELDS}=await corePromise;
 const dom=new JSDOM('<section id="root"></section>',{url:'https://erp.test'});t.after(()=>dom.window.close());let form={branch:'สำนักงานใหญ่',...options.form},owner='owner',calls=[],applies=0,revoked=[],saving=false,editing=false;
 const root=dom.window.document.getElementById('root'),q=s=>root.querySelector(s);
 const controller=createCustomerIntake(root,{getUser:()=>owner?{uid:owner,getIdToken:async()=> 'firebase.token'}:null,getForm:()=>({...form}),applyFields:values=>{applies++;Object.assign(form,values)},isSaving:()=>saving,isEditing:()=>editing,
  fetch:async(...args)=>{calls.push(args);return options.fetch?options.fetch(...args):response()},prepareImage:async()=>({mimeType:'image/png',data:'c3ludGhldGlj',resized:false}),createObjectURL:()=> 'blob:test-image',revokeObjectURL:value=>revoked.push(value)});
 t.after(()=>controller.destroy());
 const input=value=>{q('[data-ai-text]').value=value;q('[data-ai-text]').dispatchEvent(new dom.window.Event('input',{bubbles:true}))};
 async function read(){q('[data-ai-read]').click();for(let i=0;i<200&&controller.busy;i++)await tick();assert.equal(controller.busy,false,'AI operation completes before assertions');}
 return {root,q,controller,input,read,get form(){return form},get calls(){return calls},get applies(){return applies},revoked,setForm:v=>Object.assign(form,v),setUser:v=>owner=v,setSaving:v=>saving=v,setEditing:v=>{editing=v;controller.refresh()},dom};
}
test('one company fills a new form but never writes a customer record',async t=>{
 const f=await fixture(t);f.input('บริษัทสมมติ ที่อยู่ อีเมล');await f.read();assert.equal(f.form.name,'บริษัทตัวอย่าง AI จำกัด');assert.equal(f.form.address,'ที่อยู่ตัวอย่าง');assert.equal(f.form.branch,'');assert.equal(f.form.registrationNo,'TEST-REGISTRATION');assert.equal(f.applies,1);
 const [url,options]=f.calls[0];assert.equal(url,'/api/customer-read');assert.equal(options.headers.Authorization,'Bearer firebase.token');assert.equal(JSON.parse(options.body).text,'บริษัทสมมติ ที่อยู่ อีเมล');assert.match(f.q('[data-ai-status]').textContent,/กดบันทึกเอง/);
});
test('existing manual values wait for an explicit fill or replace action',async t=>{
 const f=await fixture(t,{form:{name:'ชื่อที่พิมพ์เอง',phone:'หมายเลขเดิม'}});f.input('ข้อมูลต้นฉบับ');await f.read();assert.equal(f.applies,0);assert.equal(f.form.name,'ชื่อที่พิมพ์เอง');
 f.q('[data-ai-fill]').click();assert.equal(f.form.name,'ชื่อที่พิมพ์เอง');assert.equal(f.form.phone,'หมายเลขเดิม');assert.equal(f.form.address,'ที่อยู่ตัวอย่าง');
 f.q('[data-ai-replace]').click();assert.equal(f.form.name,'บริษัทตัวอย่าง AI จำกัด');assert.equal(f.form.phone,'TEST-PHONE');
});
test('manual changes while AI is reading are preserved',async t=>{
 let finish;const pending=new Promise(r=>finish=r),f=await fixture(t,{fetch:()=>pending});f.input('ต้นฉบับ');f.q('[data-ai-read]').click();await tick();f.setForm({name:'พิมพ์ระหว่างรอ'});finish(response());await tick();assert.equal(f.form.name,'พิมพ์ระหว่างรอ');assert.equal(f.applies,0);assert.match(f.q('[data-ai-status]').textContent,/เก็บข้อมูลที่คุณพิมพ์/);
});
test('multiple companies require choosing one and never merge buyer/seller data',async t=>{
 const f=await fixture(t,{fetch:async()=>response([candidate({name:'Buyer',address:'Buyer address',role:'buyer'}),candidate({name:'Seller',address:'Seller address',role:'seller'})])});f.input('เอกสารมีสองบริษัท');await f.read();assert.equal(f.applies,0);
 const select=f.q('[data-ai-choice]');select.value='1';select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));assert.equal(f.form.name,'Seller');assert.equal(f.form.address,'Seller address');
});
test('AI failures preserve source and manual form entries',async t=>{
 const f=await fixture(t,{form:{name:'manual'},fetch:async()=>({ok:false,json:async()=>({error:'เครดิตยังไม่พร้อม'})})});f.input('ต้นฉบับยังอยู่');await f.read();assert.equal(f.form.name,'manual');assert.equal(f.q('[data-ai-text]').value,'ต้นฉบับยังอยู่');assert.match(f.q('[data-ai-status]').textContent,/เครดิตยังไม่พร้อม/);assert.equal(f.applies,0);assert.equal(f.q('[data-ai-read]').disabled,false);
});
test('retries for an unchanged source reuse a request ID; changing source makes a new request',async t=>{
 const f=await fixture(t,{fetch:async()=>({ok:false,json:async()=>({error:'temporary'})})});f.input('ต้นฉบับ A');await f.read();await f.read();assert.equal(JSON.parse(f.calls[0][1].body).requestId,JSON.parse(f.calls[1][1].body).requestId);
 f.input('ต้นฉบับ B');await f.read();assert.notEqual(JSON.parse(f.calls[2][1].body).requestId,JSON.parse(f.calls[0][1].body).requestId);
});
test('late AI results cannot populate another account or a destroyed form',async t=>{
 let finish;const pending=new Promise(r=>finish=r),f=await fixture(t,{fetch:()=>pending});f.input('ต้นฉบับ');f.q('[data-ai-read]').click();await tick();f.setUser('another-owner');f.controller.destroy();finish(response());await tick();assert.equal(f.applies,0);assert.equal(f.root.children.length,0);
});
test('clipboard image input is explicit, previewed locally and released on reset',async t=>{
 const f=await fixture(t),paste=new f.dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{items:[{kind:'file',getAsFile:()=>({name:'synthetic.png'})}]}});f.root.dispatchEvent(paste);await tick();assert.equal(f.q('[data-ai-preview]').hidden,false);
 await f.read();assert.equal(JSON.parse(f.calls[0][1].body).image.mimeType,'image/png');f.controller.reset();assert.deepEqual(f.revoked,['blob:test-image']);assert.equal(f.q('[data-ai-preview]').hidden,true);
});
test('editing existing customers and saving disable AI application without blocking the normal form',async t=>{
 const f=await fixture(t);f.setEditing(true);assert.equal(f.root.hidden,true);f.setEditing(false);f.setSaving(true);f.controller.refresh();assert.equal(f.q('[data-ai-read]').disabled,true);assert.equal(f.calls.length,0);
});
test('unreadable data is not replaced with sample company details and extracted HTML stays inert',async t=>{
 const f=await fixture(t,{fetch:async()=>({ok:true,json:async()=>({extraction:{readable:false,candidates:[],warnings:[]}})})});f.input('อ่านไม่ได้');await f.read();assert.equal(f.applies,0);assert.match(f.q('[data-ai-status]').textContent,/ยังไม่พบข้อมูล/);
 const g=await fixture(t,{fetch:async()=>response([candidate({name:'<img src=x onerror=alert(1)>'})])});g.input('ต้นฉบับ');await g.read();assert.equal(g.root.querySelectorAll('dl img').length,0);assert.equal(g.form.name,'<img src=x onerror=alert(1)>');
});
