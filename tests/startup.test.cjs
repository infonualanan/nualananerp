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
 const w=dom.window;w.__firebase_config=JSON.stringify({apiKey:'test-web-config',authDomain:'test.invalid',projectId:'test-project',appId:'test-app'});w.eval(startup);return {w,$:id=>w.document.getElementById(id)};
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
// Synthetic accounts and receipts only; this test never reads production Firebase.
test('dashboard vault subscription follows the signed-in account and rejects late snapshots/errors from the old account',async t=>{
 const {w,$}=setup(t),watches=[];let notify,writes=0;
 w.closeErpMenu=()=>{};w.initializeApp=()=>({});w.getAuth=()=>({});w.getFirestore=()=>({});
 w.onAuthStateChanged=(auth,next)=>{notify=next;};w.doc=(...a)=>a.join('/');w.collection=(...a)=>a.join('/');
 w.getDoc=async()=>({exists:()=>true,data:()=>({})});w.getDocFromServer=w.getDoc;w.getDocsFromServer=async()=>({docs:[]});
 w.onSnapshot=(ref,optionsOrNext,nextOrError,error)=>{const options=typeof optionsOrNext!=='function',watch={ref,next:options?nextOrError:optionsOrNext,error:options?error:nextOrError,stopped:false};watches.push(watch);return()=>{watch.stopped=true;};};
 w.setDoc=async()=>{writes++;};w.deleteDoc=async()=>{writes++;};
 const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 w.eval(source);notify({uid:'account-a'});await new Promise(r=>setTimeout(r,10));
 const a=watches.find(x=>x.ref.includes('account-a')&&x.ref.endsWith('/accounting_vault'));assert.ok(a);
 const snap=value=>({docs:[{id:'file-a',data:()=>({status:'reviewed',data:{documentType:'receipt',documentNo:'RECEIPT-A',reviewed:true,currency:'THB',grandTotal:value,sellerName:'Supplier'}})}]});
 a.next(snap('1234.56'));assert.match($('dash-total-expenses').textContent,/1,234\.56/);
 notify({uid:'account-b'});await new Promise(r=>setTimeout(r,10));assert.equal(a.stopped,true);
 const b=watches.find(x=>x.ref.includes('account-b')&&x.ref.endsWith('/accounting_vault'));assert.ok(b);
 b.next({docs:[]});assert.match($('dash-total-expenses').textContent,/0\.00/);
 a.next(snap('99999'));a.error(new Error('late error'));assert.match($('dash-total-expenses').textContent,/0\.00/);
 assert.equal($('dash-expense-warning').classList.contains('hidden'),true);
 assert.doesNotMatch($('dash-expense-rows').textContent,/RECEIPT-A/);assert.equal(writes,0);
});

test('hosted Firebase configuration loads before auth and source defaults contain no business seed records',async t=>{
 const {w,$}=setup(t);delete w.__firebase_config;let notify,seenConfig,writes=0;
 const cfg={apiKey:'test-web-config',authDomain:'test.invalid',projectId:'test-project',appId:'test-app'};
 w.fetch=async(url,options)=>{assert.equal(url,'/api/firebase-config');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({firebaseConfig:cfg})};};
 w.initializeApp=c=>{seenConfig=c;return {}};w.getAuth=()=>({});w.getFirestore=()=>({});w.onAuthStateChanged=(a,next)=>{notify=next;};
 w.setDoc=async()=>{writes++};
 const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 w.eval(source+'\nwindow.seedSnapshot=initialUserData;');assert.equal(w.document.documentElement.dataset.erpStartup,'loading');
 await new Promise(r=>setTimeout(r,5));assert.equal(seenConfig.projectId,'test-project');assert.equal(typeof notify,'function');notify(null);
 assert.equal(w.document.documentElement.dataset.erpStartup,'ready');assert.equal($('login-screen').style.display,'flex');
 for(const name of ['products','customers','employees','savedRemarks'])assert.equal(w.seedSnapshot[name].length,0,name);
 for(const key of ['nameTh','nameEn','taxId','addressTh','addressEn','phone','email'])assert.equal(w.seedSnapshot.companyProfile[key],'',key);
 assert.doesNotMatch(html,/AIza[A-Za-z0-9_-]{20,}/);assert.equal(writes,0);
});
test('unavailable or malformed hosted configuration shows a retry instead of enabling a broken login',async t=>{
 for(const response of [{ok:false,json:async()=>({})},{ok:true,json:async()=>({firebaseConfig:{projectId:'incomplete'}})}]){
  const {w,$}=setup(t);delete w.__firebase_config;let initCalls=0;w.fetch=async()=>response;w.initializeApp=()=>{initCalls++;return {}};
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');w.eval(source);
  await new Promise(r=>setTimeout(r,5));assert.equal(initCalls,0);assert.equal(w.document.documentElement.dataset.erpStartup,'failed');
  assert.equal($('app-startup-retry').hidden,false);assert.equal($('btn-login-submit').disabled,true);
 }
});
