const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const seed=[
 {id:'sale',code:'P-001',name:'ขิงหยองขาย',tradeUsage:'sale',unit:'ซอง',price:50,priceBasis:'INC'},
 {id:'purchase',code:'P-002',name:'ซองบรรจุซื้อเข้า',tradeUsage:'purchase',unit:'ใบ',price:2,priceBasis:'EXC'},
 {id:'both',code:'G-001',name:'ขิงสดซื้อและขาย',tradeUsage:'both',unit:'KG',price:25,priceBasis:'INC'},
 {id:'legacy',code:'K-001',name:'รายการเดิมยังไม่แยก',unit:'KG',price:30,priceBasis:'INC'}
];
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(t,initial=seed){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'});t.after(()=>dom.window.close());
 const w=dom.window,$=id=>w.document.getElementById(id),records=new Map(initial.map(p=>['products/'+p.id,structuredClone(p)])),writes=[];let fail=false;
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 w.fakeSet=async(ref,value,options)=>{if(fail)throw new Error('test connection failure');const data=JSON.parse(JSON.stringify(value));writes.push({ref,data});records.set(ref,options?.merge?{...records.get(ref),...data}:data);};
 w.fakeAll=async name=>({docs:[...records].filter(([key])=>key.startsWith(name+'/')).map(([key,value])=>({id:key.slice(name.length+1),data:()=>structuredClone(value)}))});
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 const start=source.indexOf('        // --- Firebase Configuration & Initialization ---'),end=source.indexOf('        // Login Feature',start);
 source=source.slice(0,start)+`const auth={},db={},appId='test';let currentUser={uid:'test-owner'},firebaseUnsubscribers=[];const getUserCol=name=>name,getUserDoc=(name,id)=>name+'/'+id;const setDoc=window.fakeSet,getDocsFromServer=window.fakeAll,deleteDoc=async()=>{},serverTimestamp=()=>null;`+source.slice(end);
 w.eval(source+`\nproducts=${JSON.stringify(initial)};customers=[{id:'test-party',code:'C001',name:'คู่ค้าทดสอบ'}];savedRemarks=[];remarksLoaded=true;remarksDataUserId='test-owner';companyProfile={nameTh:'บริษัททดสอบ',taxId:'0000000000000',addressTh:'ที่อยู่',phone:''};$('login-screen').style.display='none';$('main-app').style.display='flex';renderProducts();renderCustomerDropdown(false);window.catalogTest={replace:(list,refresh=true)=>{products=list;if(refresh){renderProducts();renderProductDropdowns();}},setDocs:list=>database=list,getDocs:()=>database};`);
 const change=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
 const submit=()=>{$('add-product-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 const confirm=async()=>{$('product-unit-confirm').click();await tick();await tick();};
 const sync=()=>w.catalogTest.replace([...records.values()].filter(p=>p.id));
 const listed=()=>[...$('products-table-body').querySelectorAll('[data-product-edit]')].map(x=>decodeURIComponent(x.dataset.productEdit));
 const choices=()=>[...$('items-container').querySelectorAll('[data-product-option]')].map(x=>decodeURIComponent(x.dataset.productOption));
 return {w,$,records,writes,change,submit,confirm,sync,listed,choices,setFail:value=>fail=value};
}
test('catalog filters combine item use, code category and search while legacy items remain explicitly unclassified',async t=>{
 const e=await setup(t),{w,$,change,listed}=e;assert.equal(listed().length,4);assert.equal($('new-prod-usage').value,'sale');
 assert.match($('products-table-body').textContent,/ยังไม่ระบุประเภท/);change($('product-usage-filter'),'sale');assert.deepEqual(listed().sort(),['both','sale']);
 change($('product-usage-filter'),'purchase');assert.deepEqual(listed().sort(),['both','purchase']);change($('product-category-filter'),'P');assert.deepEqual(listed(),['purchase']);
 change($('product-search'),'ซองบรรจุ');assert.deepEqual(listed(),['purchase']);change($('product-search'),'ไม่พบ');assert.equal(listed().length,0);assert.equal($('products-table-body').querySelector('td').colSpan,6);
 change($('product-search'),'');change($('product-category-filter'),'');change($('product-usage-filter'),'unclassified');assert.deepEqual(listed(),['legacy']);
 change($('product-usage-filter'),'both');assert.deepEqual(listed(),['both']);w.toggleLanguage();assert.equal($('product-usage-filter').value,'both');assert.match($('products-table-body').textContent,/Buy and sell/);
 assert.equal(e.writes.length,0);assert.equal(e.records.get('products/legacy').tradeUsage,undefined);
});
test('purchase classification saves with unit and VAT confirmation and reopens from the persisted record in a second session',async t=>{
 const e=await setup(t),{w,$,change}=e;w.editProduct('sale');change($('new-prod-usage'),'purchase');e.submit();assert.ok($('product-unit-dialog').open);assert.match($('product-unit-description').textContent,/สินค้าซื้อเข้า/);await e.confirm();
 const saved=e.records.get('products/sale');assert.equal(saved.tradeUsage,'purchase');assert.equal(saved.code,'P-001');assert.equal(saved.price,50);assert.equal(saved.priceBasis,'INC');assert.equal(saved.unit,'ซอง');assert.equal(e.writes.length,1);assert.ok(e.writes.every(x=>x.ref.startsWith('products/')));
 const second=await setup(t,[...e.records.values()]);second.w.editProduct('sale');assert.equal(second.$('new-prod-usage').value,'purchase');
 second.w.cancelEditProduct();assert.equal(second.$('new-prod-usage').value,'sale');
 change($('new-prod-code'),'RAW-NEW');change($('new-prod-name'),'ขิงซื้อเข้าใหม่');change($('new-prod-unit'),'KG');change($('new-prod-price'),'12.50');change($('new-prod-usage'),'purchase');e.submit();await e.confirm();
 assert.equal(e.writes.at(-1).data.tradeUsage,'purchase');assert.equal(e.writes.at(-1).data.price,12.5);assert.notEqual(e.writes.at(-1).data.id,'sale');
});
test('sales and purchase document choices use the matching catalog plus shared and legacy items, preserving draft rows on a type switch',async t=>{
 const e=await setup(t),{w,$,change,choices}=e;w.switchTab('create-doc');$('items-container').innerHTML='';w.addLineItem();
 for(const type of ['QT','SO','INV','CN','EQT','CI','EVAT']){change($('doc-type'),type);w.checkDocType();assert.deepEqual(choices().sort(),['both','legacy','sale'],type);}
 $('items-container').querySelector('[data-product-option="sale"]').click();const row=$('items-container').firstElementChild;change(row.querySelector('.item-qty'),'3');change(row.querySelector('.item-price'),'47');
 for(const type of ['PR','PO','GRN','VB','PINV','SDN','SCN']){change($('doc-type'),type);w.checkDocType();assert.deepEqual(choices().sort(),['both','legacy','purchase'],type);}
 assert.equal(row.querySelector('.item-code').value,'P-001');assert.equal(row.querySelector('.item-qty').value,'3');assert.equal(row.querySelector('.item-price').value,'47');assert.match($('doc-product-usage-hint').textContent,/สินค้าซื้อเข้า/);
 change($('doc-type'),'MI');w.checkDocType();assert.equal(choices().length,4);change($('doc-type'),'PO');w.checkDocType();$('items-container').querySelector('[data-product-option="both"]').click();assert.equal(row.querySelector('.item-code').value,'G-001');assert.equal(row.querySelector('.item-price-basis').value,'NONE');
 change($('doc-type'),'SO');w.checkDocType();assert.ok(choices().includes('both'));assert.equal(row.querySelector('.item-code').value,'G-001');assert.equal(e.writes.length,0);
});
test('classification changes never rewrite saved documents or remove historical products from copied drafts',async t=>{
 const e=await setup(t),{w,$,change}=e;const old={docNo:'PO-HISTORICAL',prefix:'PO',docName:'PO',customerName:'คู่ค้าทดสอบ',currency:'THB',items:[{code:'P-001',name:'ชื่อ ณ วันออก',qty:2,unit:'ซอง',price:50,total:100,taxRate:0}],subtotal:100,vat:0,grandTotal:100,remark:''};const before=JSON.stringify(old);w.catalogTest.setDocs([old]);
 w.editProduct('legacy');assert.equal($('new-prod-usage').value,'');change($('new-prod-price'),'31');e.submit();await e.confirm();assert.equal(e.records.get('products/legacy').tradeUsage,'');
 w.editProduct('sale');change($('new-prod-usage'),'sale');e.submit();await e.confirm();assert.equal(JSON.stringify(old),before);assert.ok(e.writes.every(x=>x.ref.startsWith('products/')));
 w.editDocument(old.docNo);$('custom-confirm-ok').click();const row=$('items-container').firstElementChild;assert.equal(row.querySelector('.item-code').value,'P-001');assert.equal(row.querySelector('.item-name').value,'ชื่อ ณ วันออก');assert.equal($('live-grand').textContent,'100.00');assert.equal(JSON.stringify(old),before);assert.equal(e.choices().includes('sale'),false);
});
test('failed saves, changed confirmations and another-device classification changes keep the form without overwriting cloud data',async t=>{
 const e=await setup(t),{w,$,change}=e;w.editProduct('purchase');change($('new-prod-usage'),'both');e.submit();change($('new-prod-usage'),'sale');await e.confirm();assert.equal(e.writes.length,0);assert.equal(e.records.get('products/purchase').tradeUsage,'purchase');
 change($('new-prod-usage'),'both');e.setFail(true);e.submit();await e.confirm();assert.equal(e.writes.length,0);assert.equal($('new-prod-usage').value,'both');assert.equal($('new-prod-code').value,'P-002');assert.equal($('btn-save-prod').disabled,false);
 e.setFail(false);e.submit();e.records.get('products/purchase').tradeUsage='sale';await e.confirm();assert.equal(e.writes.length,0);assert.equal(e.records.get('products/purchase').tradeUsage,'sale');assert.equal($('new-prod-usage').value,'both');
});
test('a stale product option cannot select a product reclassified to the opposite document side',async t=>{
 const e=await setup(t),{w,$}=e;w.switchTab('create-doc');$('doc-type').value='SO';w.checkDocType();$('items-container').innerHTML='';w.addLineItem();
 const option=$('items-container').querySelector('[data-product-option="sale"]');w.catalogTest.replace(seed.map(p=>p.id==='sale'?{...p,tradeUsage:'purchase'}:p),false);option.click();
 assert.equal($('items-container').querySelector('.item-code').value,'');assert.equal(e.choices().includes('sale'),false);assert.equal(e.writes.length,0);
});
