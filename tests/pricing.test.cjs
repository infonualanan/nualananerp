// Financial pricing checks use isolated DOM/records; no production Firebase calls.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const config=moduleSource.slice(moduleSource.indexOf('        const docTypeNames ='),moduleSource.indexOf('        const translations ='));
const context=vm.createContext({currentLang:'th'});vm.runInContext(config,context);
const calculate=(items,prefix='PO')=>JSON.parse(JSON.stringify(context.calculateDocumentPricing(items,prefix)));
const line=(overrides={})=>({code:'C001',name:'ฉลาก PP',unit:'แผ่น A3',price:25,qty:265,discVal:0,priceBasis:'EXC',...overrides});
const sumCents=(items,key)=>items.reduce((s,i)=>s+Math.round(i[key]*100),0);

test('25 baht excluded price produces the supplier quotation amount without taking VAT out of 25',()=>{
 const r=calculate([line()]);assert.equal(r.subtotal,6625);assert.equal(r.vat,463.75);assert.equal(r.grandTotal,7088.75);
 assert.equal(r.items[0].price,25);assert.equal(r.items[0].displayTotal,6625);assert.equal(r.items[0].total,7088.75);assert.equal(r.items[0].taxRate,7);
});
test('included prices keep the agreed total and discounts apply before VAT',()=>{
 const inc=calculate([line({priceBasis:'INC'})]);assert.equal(inc.grandTotal,6625);assert.equal(inc.subtotal,6191.59);assert.equal(inc.vat,433.41);
 const exc=calculate([line({discVal:10})]);assert.equal(exc.subtotal,5962.5);assert.equal(exc.vat,417.38);assert.equal(exc.grandTotal,6379.88);
 const full=calculate([line({discVal:100})]);assert.equal(full.grandTotal,0);assert.equal(full.vat,0);
});
test('the eight quotation quantities and cumulative satang allocation reconcile',()=>{
 const r=calculate([45,45,45,30,30,15,15,40].map(qty=>line({qty})));assert.equal(r.grandTotal,7088.75);assert.equal(r.vat,463.75);
 for(const basis of ['INC','EXC']){
  const cents=calculate(Array.from({length:107},()=>line({price:0.01,qty:1,priceBasis:basis})));
  assert.equal(sumCents(cents.items,'itemVat'),Math.round(cents.vat*100));assert.equal(sumCents(cents.items,'total'),Math.round(cents.grandTotal*100));
  assert.equal(sumCents(cents.items,'itemBeforeVat')+sumCents(cents.items,'itemVat'),sumCents(cents.items,'total'));
 }
 assert.equal(calculate([line({price:0.25,qty:2})]).vat,0.04);
});
test('mixed price bases and legacy G products keep tax treatment distinct',()=>{
 const r=calculate([line({price:35,qty:1,priceBasis:'INC'}),line({qty:1}),line({code:'G001',qty:1})]);
 assert.equal(r.grandTotal,86.75);assert.equal(r.vat,4.04);assert.equal(r.items[2].taxRate,0);
 assert.equal(calculate([line({priceBasis:'NONE'})]).grandTotal,6625);
 assert.equal(context.productPriceBasis({price:25}),'INC');
});
test('export, payroll and stock documents do not acquire domestic VAT; purchase documents do',()=>{
 for(const prefix of ['EQT','PI','CI','EVAT','PL','STI','STO','RV','PV','PAYSLIP']){const r=calculate([line()],prefix);assert.equal(r.vat,0,prefix);assert.equal(r.grandTotal,6625,prefix);}
 for(const prefix of ['PR','PO','GRN','QT','SO','INV','PINV'])assert.equal(calculate([line()],prefix).vat,463.75,prefix);
 assert.equal(calculate([line({price:1000,qty:1}),line({price:-30,qty:1})],'PAYSLIP').grandTotal,970);
 assert.equal(calculate([line({qty:0.5})]).grandTotal,13.38);
});
test('invalid or excessive prices, quantities and discounts cannot create monetary snapshots',()=>{
 for(const change of [{price:-1},{price:'25.001'},{price:'abc'},{price:'1e9'},{price:1000000001},{qty:0},{qty:-1},{qty:1000001},{discVal:-1},{discVal:100.01}])assert.throws(()=>calculate([line(change)]));
});

const wait=()=>new Promise(r=>setImmediate(r));
async function setup(t){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'dangerously',pretendToBeVisual:true,url:'https://offline.test/'});t.after(()=>dom.window.close());
 const w=dom.window,$=id=>w.document.getElementById(id);w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 const product={id:'sticker',code:'C001',name:'ฉลาก PP Sticker (A3)',unit:'แผ่น A3',price:25,priceBasis:'EXC'};
 const writes=[],records=new Map([['products/sticker',structuredClone(product)]]);let fail=false;
 w.fakeSet=async(ref,data,options)=>{if(fail)throw new Error('permission-denied');const copy=JSON.parse(JSON.stringify(data));writes.push({ref,data:copy});records.set(ref,options?.merge?{...records.get(ref),...copy}:copy);};
 w.fakeAll=async name=>({docs:[...records].filter(([key])=>key.startsWith(name+'/')).map(([key,value])=>({id:key.slice(name.length+1),data:()=>structuredClone(value)}))});
 let code=moduleSource.replace(/^\s*import .*?;\s*$/gm,'');const start=code.indexOf('        // --- Firebase Configuration & Initialization ---'),end=code.indexOf('        // Login Feature',start);
 code=code.slice(0,start)+`const auth={},db={},appId='test';let currentUser={uid:'test-user'},firebaseUnsubscribers=[];const getUserCol=name=>name,getUserDoc=(name,id)=>name+'/'+id;const setDoc=window.fakeSet,getDocsFromServer=window.fakeAll,deleteDoc=async()=>{},serverTimestamp=()=>null;`+code.slice(end);
 w.eval(code+`\nproducts=${JSON.stringify([product])};customers=[{id:'supplier',name:'โรงพิมพ์ตัวอย่าง',code:'V001',address:'ที่อยู่ทดสอบ'}];savedRemarks=[];remarksLoaded=true;remarksDataUserId='test-user';companyProfile={nameTh:'นวลอนันต์',taxId:'0000000000000',addressTh:'ที่อยู่',phone:''};$('login-screen').style.display='none';$('main-app').style.display='flex';renderProducts();renderCustomerDropdown(false);switchTab('create-doc');window.pricingTest={getProducts:()=>products,setProducts:value=>{products=value;renderProducts();renderProductDropdowns();},setDocs:value=>{database=value;},getDocs:()=>database};`);
 $('doc-type').value='PO';$('customer-select').value='supplier';w.checkDocType();$('items-container').innerHTML='';w.addLineItem();
 const input=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
 const select=()=>{const row=$('items-container').lastElementChild;row.querySelector('[data-product-option]').click();input(row.querySelector('.item-qty'),'265');return row;};
 const save=async()=>{$('create-doc-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();await wait();return writes.filter(x=>x.ref.startsWith('documents/')).at(-1)?.data;};
 return {w,$,input,select,save,writes,records,product,setFail:v=>fail=v};
}
test('real ERP product selection, override, persistence and A4 output share one calculation',async t=>{
 const e=await setup(t),{w,$,input}=e;let row=e.select();assert.equal(row.querySelector('.item-price-basis').value,'EXC');assert.equal($('live-grand').textContent,'7,088.75');assert.equal(row.querySelector('.item-row-total').textContent,'6,625.00');
 input($('global-price-basis'),'INC');assert.equal($('live-grand').textContent,'6,625.00');assert.equal(w.pricingTest.getProducts()[0].priceBasis,'EXC');
 input($('global-price-basis'),'EXC');const saved=await e.save();assert(saved);assert.equal(saved.pricingVersion,1);assert.equal(saved.documentPriceBasis,'EXC');assert.equal(saved.vatEnabled,true);assert.equal(saved.grandTotal,7088.75);assert.equal(saved.vat,463.75);
 w.pricingTest.setDocs([saved]);w.previewDocument(saved.docNo);assert.match($('preview-col-price').textContent,/ยังไม่รวม VAT/);assert.match($('preview-items-body').textContent,/6,625\.00/);assert.equal($('preview-grandtotal').textContent,'7,088.75 THB');assert.equal($('preview-vat-row').classList.contains('hidden'),false);
 const old=JSON.stringify(saved);w.pricingTest.setProducts([{...e.product,price:200,priceBasis:'INC'}]);w.previewDocument(saved.docNo);assert.equal(JSON.stringify(saved),old);assert.equal($('preview-grandtotal').textContent,'7,088.75 THB');
 w.closePreview();w.editDocument(saved.docNo);$('custom-confirm-ok').click();row=$('items-container').firstElementChild;assert.equal(row.querySelector('.item-price').value,'25');assert.equal(row.querySelector('.item-price-basis').value,'EXC');assert.equal($('live-grand').textContent,'7,088.75');
});
test('old PO snapshots and copied drafts keep their original amount and no-VAT treatment',async t=>{
 const e=await setup(t),{w,$}=e;const old={docNo:'PO-OLD',prefix:'PO',docName:'PO',customerName:'โรงพิมพ์ตัวอย่าง',items:[line({priceBasis:undefined,total:6625,itemBeforeVat:6191.588785046729,itemVat:433.411214953271})],subtotal:6625,vat:0,grandTotal:6625,currency:'THB',remark:''};
 const snapshot=JSON.stringify(old);w.pricingTest.setDocs([old]);w.previewDocument(old.docNo);assert.equal($('preview-grandtotal').textContent,'6,625.00 THB');assert.equal($('preview-vat-row').classList.contains('hidden'),true);
 w.closePreview();w.editDocument(old.docNo);$('custom-confirm-ok').click();assert.equal($('live-grand').textContent,'6,625.00');assert.equal($('items-container').firstElementChild.querySelector('.item-price-basis').value,'NONE');assert.equal(JSON.stringify(old),snapshot);
});
test('product price basis saves through the existing unit confirmation without modifying issued documents',async t=>{
 const e=await setup(t),{w,$,input}=e;w.editProduct('sticker');assert.equal($('new-prod-price-basis').value,'EXC');assert.match($('product-price-preview').textContent,/26\.75/);
 input($('new-prod-price-basis'),'INC');assert.match($('product-price-preview').textContent,/25\.00/);
 $('add-product-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal($('product-unit-dialog').open,true);assert.match($('product-unit-description').textContent,/รวม VAT แล้ว/);$('product-unit-confirm').click();await wait();await wait();
 const write=e.writes.find(x=>x.ref==='products/sticker');assert(write);assert.equal(write.data.priceBasis,'INC');assert.equal(write.data.price,25);assert.equal(write.data.code,'C001');assert.equal(e.writes.some(x=>x.ref.startsWith('documents/')),false);
});
test('export and G-item controls preserve no-VAT behavior; document errors and failed writes retain the draft',async t=>{
 const e=await setup(t),{w,$,input}=e;const row=e.select();$('doc-type').value='EQT';w.checkDocType();assert.equal($('live-grand').textContent,'6,625.00');assert.equal($('global-price-basis').disabled,true);
 $('doc-type').value='PO';w.checkDocType();assert.equal($('live-grand').textContent,'7,088.75');assert.equal($('global-price-basis').disabled,false);
 input(row.querySelector('.item-price'),'-1');assert.equal($('live-grand').textContent,'—');await e.save();assert.equal(e.writes.length,0);assert.equal(row.querySelector('.item-price').value,'-1');
 input(row.querySelector('.item-price'),'25');e.setFail(true);await e.save();assert.equal(e.writes.length,0);assert.equal(row.querySelector('.item-price').value,'25');assert.equal($('doc-save-button').disabled,false);
 e.setFail(false);w.pricingTest.setProducts([{...e.product,code:'G001'}]);row.querySelector('[data-product-option]').click();assert.equal(row.querySelector('.item-price-basis').value,'NONE');assert.equal(row.querySelector('.item-price-basis').type,'hidden');assert.equal($('live-vat').textContent,'0.00');
});
test('excluded-price SO snapshots remain valid for installment payments and linked tax documents',async t=>{
 const e=await setup(t),{w,$}=e;e.select();$('doc-type').value='SO';w.checkDocType();const saved=await e.save();
 const core=await import(pathToFileURL(path.join(__dirname,'..','payments-core.mjs')).href);saved.docNo='SO-2026-TEST';saved.inputDate='2026-10-30';saved.paymentLedger=core.createLedger(saved,'domestic-vat7','2026-11-15','2026-10-30',[]);
 const invoice=core.applyOperation(saved,{kind:'invoice',requestId:'invoice-request-001'},'INV-2026-P000001','2026-10-30',[]).document;
 assert.equal(invoice.items[0].priceBasis,'EXC');assert.equal(invoice.items[0].price,25);assert.equal(invoice.items[0].total,7088.75);
 w.pricingTest.setDocs([invoice]);w.previewDocument(invoice.docNo);assert.match($('preview-col-price').textContent,/ยังไม่รวม VAT/);assert.equal($('preview-grandtotal').textContent,'7,088.75 THB');
 const delivery=core.applyOperation(saved,{kind:'delivery',requestId:'delivery-request-001'},'TINV-2026-P000001','2026-10-30',[]).document;
 w.pricingTest.setDocs([delivery]);w.previewDocument(delivery.docNo);assert.match($('preview-col-price').textContent,/ยังไม่รวม VAT/);assert.equal($('preview-grandtotal').textContent,'7,088.75 THB');assert.equal(delivery.vat,463.75);
});
test('a tax invoice deducting an advance from excluded-price goods prints reconciled before-VAT line amounts',async t=>{
 const e=await setup(t),{w,$}=e;e.select();$('doc-type').value='SO';w.checkDocType();const saved=await e.save();saved.docNo='SO-2026-TEST';saved.inputDate='2026-10-30';
 const core=await import(pathToFileURL(path.join(__dirname,'..','payments-core.mjs')).href);
 saved.paymentLedger=core.createLedger(saved,'domestic-vat7','2026-11-15','2026-10-30',[]);
 const advance=core.applyOperation(saved,{kind:'payment',requestId:'advance-request-001',now:'test',input:{amount:'4253.25',date:'2026-10-30',method:'โอนธนาคาร',reference:'BANK-TEST',verified:true,dueDate:'2026-11-15',proofNote:'ตรวจแล้ว'}},'RETAX-2026-P000001','2026-10-30',[]);
 saved.paymentLedger=advance.ledger;
 const final=core.applyOperation(saved,{kind:'delivery',requestId:'delivery-request-002'},'TINV-2026-P000001','2026-10-30',[advance.document]).document;
 assert.equal(final.subtotal,2650);assert.equal(final.vat,185.5);assert.equal(final.grandTotal,2835.5);
 w.pricingTest.setDocs([final]);w.previewDocument(final.docNo);assert.match($('preview-col-amt').textContent,/ก่อน VAT/);
 const rows=[...$('preview-items-body').rows];assert.match(rows[0].cells[7].textContent,/6,625\.00/);assert.match(rows[1].cells[7].textContent,/-3,975\.00/);
 assert.match(rows[0].cells[5].textContent,/ยังไม่รวม VAT/);assert.match(rows[1].cells[5].textContent,/รวม VAT แล้ว/);assert.equal($('preview-grandtotal').textContent,'2,835.50 THB');
});
test('one header choice updates all eight partly edited legacy PO rows without changing prices or the saved source',async t=>{
 const e=await setup(t),{w,$,input}=e;
 const items=[45,45,45,30,30,15,15,40].map((qty,index)=>line({qty,code:'C'+String(index+1).padStart(3,'0'),priceBasis:index<3?'EXC':'NONE'}));
 const old={...calculate(items),status:'pending',docNo:'PO-PARTLY-EDITED',prefix:'PO',docName:'PO',customerName:'โรงพิมพ์ตัวอย่าง',currency:'THB',remark:''};
 const sourceSnapshot=JSON.stringify(old);w.pricingTest.setDocs([old]);w.editDocument(old.docNo);$('custom-confirm-ok').click();
 assert.equal($('global-price-basis').value,'');assert.equal($('live-grand').textContent,'6,861.25');
 assert.equal(w.document.querySelectorAll('#items-container select.item-price-basis').length,0);
 assert.equal($('global-price-basis').closest('#item-column-head').id,'item-column-head');
 assert.equal($('global-price-basis').querySelectorAll('option:not([hidden])').length,2);
 input($('global-price-basis'),'EXC');
 const rows=[...$('items-container').children];assert.equal(rows.length,8);
 for(const row of rows){assert.equal(row.querySelector('.item-price').value,'25');assert.equal(row.querySelector('.item-price-basis').value,'EXC');}
 assert.equal($('live-subtotal').textContent,'6,625.00');assert.equal($('live-vat').textContent,'463.75');assert.equal($('live-grand').textContent,'7,088.75');
 input($('global-price-basis'),'INC');assert.equal($('live-grand').textContent,'6,625.00');assert.equal($('live-vat').textContent,'433.41');
 input($('global-price-basis'),'EXC');const saved=await e.save();assert.equal(saved.documentPriceBasis,'EXC');assert.equal(saved.items.length,8);assert(saved.items.every(item=>item.priceBasis==='EXC'&&item.price===25&&item.taxRate===7));
 assert.equal(JSON.stringify(old),sourceSnapshot);w.pricingTest.setDocs([saved]);w.previewDocument(saved.docNo);assert.match($('preview-col-price').textContent,/ยังไม่รวม VAT/);assert.equal($('preview-grandtotal').textContent,'7,088.75 THB');
});
test('the whole-document basis stays selected for additions, product selection and language changes, with G still exempt',async t=>{
 const e=await setup(t),{w,$,input}=e;
 input($('global-price-basis'),'EXC');w.pricingTest.setProducts([{...e.product,priceBasis:'INC'}]);e.select();
 assert.equal($('global-price-basis').value,'EXC');assert.equal($('live-grand').textContent,'7,088.75');assert.equal(w.pricingTest.getProducts()[0].priceBasis,'INC');
 w.addLineItem();const second=$('items-container').lastElementChild;second.querySelector('[data-product-option]').click();assert.equal(second.querySelector('.item-price-basis').value,'EXC');assert.equal($('live-grand').textContent,'7,115.50');
 w.addLineItem({code:'G001',name:'G legacy',qty:1,unit:'PCS',price:100});w.calculateLiveTotal();const g=$('items-container').lastElementChild;
 assert.equal(g.querySelector('.item-price-basis').value,'NONE');assert.equal($('live-grand').textContent,'7,215.50');
 w.toggleLanguage();assert.equal($('global-price-basis').value,'EXC');assert.match($('global-price-basis').selectedOptions[0].textContent,/VAT excluded/);assert.equal(g.querySelector('.item-price-basis').value,'NONE');
 input($('global-price-basis'),'INC');assert.equal($('live-grand').textContent,'6,750.00');assert.equal(g.querySelector('.item-price-basis').value,'NONE');
});
test('a copied historical no-VAT PO changes all taxable rows only after an explicit header choice, and reset clears that choice',async t=>{
 const e=await setup(t),{w,$,input}=e;
 const old={docNo:'PO-OLD-GLOBAL',prefix:'PO',docName:'PO',customerName:'โรงพิมพ์ตัวอย่าง',items:[line({priceBasis:undefined,total:6625})],subtotal:6625,vat:0,grandTotal:6625,currency:'THB',remark:''};
 w.pricingTest.setDocs([old]);w.editDocument(old.docNo);$('custom-confirm-ok').click();assert.equal($('global-price-basis').value,'');assert.equal($('live-grand').textContent,'6,625.00');
 input($('global-price-basis'),'EXC');assert.equal($('live-grand').textContent,'7,088.75');
 const saved=await e.save();assert.equal(saved.documentPriceBasis,'EXC');assert.equal(old.grandTotal,6625);assert.equal(old.vat,0);
 assert.equal($('global-price-basis').value,'INC');assert.equal($('global-price-basis').dataset.mode,'catalog');
});
test('quotation import restores the single header basis and new rows inherit it',async t=>{
 const e=await setup(t),{w,$,input}=e;
 const quote={...calculate([line()],'QT'),documentPriceBasis:'EXC',docNo:'QT-GLOBAL',prefix:'QT',customerName:'โรงพิมพ์ตัวอย่าง',remark:''};
 w.pricingTest.setDocs([quote]);input($('global-price-basis'),'INC');$('ref-qt-select').value=quote.docNo;w.pullDataFromQuotation();
 assert.equal($('global-price-basis').value,'EXC');assert.equal($('live-grand').textContent,'7,088.75');
 w.addLineItem({code:'C002',name:'เพิ่มหลังดึงใบเสนอราคา',qty:1,unit:'PCS',price:25});w.calculateLiveTotal();assert.equal($('items-container').lastElementChild.querySelector('.item-price-basis').value,'EXC');assert.equal($('live-grand').textContent,'7,115.50');
});
test('a G product does not choose the VAT price basis before the first taxable product',async t=>{
 const e=await setup(t),{w,$}=e;
 w.pricingTest.setProducts([{...e.product,code:'G001',priceBasis:'INC'}]);const first=e.select();assert.equal(first.querySelector('.item-price-basis').value,'NONE');
 w.pricingTest.setProducts([e.product]);w.addLineItem();$('items-container').lastElementChild.querySelector('[data-product-option]').click();
 assert.equal($('global-price-basis').value,'EXC');assert.equal(first.querySelector('.item-price-basis').value,'NONE');assert.equal($('items-container').lastElementChild.querySelector('.item-price-basis').value,'EXC');
});
