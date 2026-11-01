const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const startup=html.match(/<script id="erp-startup-behavior">([\s\S]*?)<\/script>/)[1];
function setup(t){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'});
 t.after(()=>dom.window.close());
 const w=dom.window;w.eval(startup);return {w,$:id=>w.document.getElementById(id)};
}
test('ERP shell styles and icons are same-origin and need no parser-blocking CDN scripts',t=>{
 const {w}=setup(t);
 const parsed=new JSDOM(html);t.after(()=>parsed.window.close());
 assert.equal(parsed.window.document.querySelectorAll('head script[src]').length,0);
 for(const link of w.document.querySelectorAll('link[rel="stylesheet"]')){
  assert.match(link.getAttribute('href'),/^\.\//);
  assert.ok(fs.statSync(path.resolve(root,link.getAttribute('href'))).size>0);
 }
 const css=fs.readFileSync(path.join(root,'assets/erp-tailwind-3.4.17.css'),'utf8');
 for(const selector of ['.hidden{display:none}', '.flex{display:flex}', '.bg-emerald-500{', '.bg-blue-500{'])assert.ok(css.includes(selector),selector);
 const icons=fs.readFileSync(path.join(root,'assets/phosphor-2.1.2.css'),'utf8');
 assert.doesNotMatch(icons,/https?:\/\//);
 assert.match(icons,/font-display:swap/);
 assert.ok(fs.statSync(path.join(root,'assets/phosphor-regular-2.1.2.woff2')).size>1000);
});
test('failed authentication module stays visible with a retry and recovers when auth finishes',t=>{
 const {w,$}=setup(t);
 assert.equal(w.document.documentElement.dataset.erpStartup,'loading');assert.equal($('btn-login-submit').disabled,true);
 const script=w.document.createElement('script');script.type='module';w.document.body.append(script);script.dispatchEvent(new w.Event('error'));
 assert.equal(w.document.documentElement.dataset.erpStartup,'failed');assert.equal($('app-startup-retry').hidden,false);assert.equal($('app-startup-status').hidden,false);
 w.erpSetStartupState('ready');
 assert.equal($('btn-login-submit').disabled,false);assert.equal($('app-startup-status').hidden,true);assert.equal($('app-startup-retry').hidden,true);
 script.dispatchEvent(new w.Event('error'));assert.equal(w.document.documentElement.dataset.erpStartup,'ready');
});
test('complete ERP startup wires login and restores an existing session without business writes',async t=>{
 for(const user of [null,{uid:'existing-user',email:'existing@example.com'}]){
  const {w,$}=setup(t);let notify,authError,writes=0,signIns=0;
  w.closeErpMenu=()=>{};
  w.initializeApp=()=>({});w.getAuth=()=>({});w.getFirestore=()=>({});
  w.onAuthStateChanged=(auth,next,error)=>{notify=next;authError=error;};
  w.doc=(...a)=>a.join('/');w.collection=(...a)=>a.join('/');
  w.getDoc=async()=>({exists:()=>true,data:()=>({})});w.getDocFromServer=w.getDoc;
  w.getDocsFromServer=async()=>({docs:[]});w.onSnapshot=()=>()=>{};
  w.setDoc=async()=>{writes++;};w.deleteDoc=async()=>{writes++;};
  w.signInWithEmailAndPassword=async()=>{signIns++;};w.createUserWithEmailAndPassword=async()=>{throw new Error('no registration');};w.signOut=async()=>{};
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
  w.eval(source);w.document.dispatchEvent(new w.Event('DOMContentLoaded',{bubbles:true}));
  notify(user);await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(w.document.documentElement.dataset.erpStartup,'ready');
  assert.equal($('main-app').style.display,user?'flex':'none');assert.equal($('login-screen').style.display,user?'none':'flex');assert.equal(writes,0);
  assert.equal($('tab-dashboard').classList.contains('active'),true);
  assert.equal(w.document.querySelectorAll('.tab-content.active').length,1);
  if(user){
   w.switchTab('customers');assert.equal($('tab-customers').classList.contains('active'),true);
   notify(null);notify(user);await new Promise(resolve=>setTimeout(resolve,1));
   assert.equal($('tab-dashboard').classList.contains('active'),true,'signing back in selects a visible start page');
   assert.equal(w.document.querySelectorAll('.tab-content.active').length,1);assert.equal(writes,0);
  }
  if(!user){$('login-username').value='existing@example.com';$('login-password').value='test-only-password';$('login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,1));assert.equal(signIns,1);}
  assert.equal(typeof authError,'function');
 }
});
