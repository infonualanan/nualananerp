const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function setup(t){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'});
 t.after(()=>dom.window.close());
 const w=dom.window,$=id=>w.document.getElementById(id),records=new Map();
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 w.fakeTransaction=async(_db,action)=>{
  const staged=[];
  const result=await action({get:async ref=>({exists:()=>records.has(ref)}),set:(ref,data)=>staged.push([ref,JSON.parse(JSON.stringify(data))])});
  for(const entry of staged)records.set(...entry);
  return result;
 };
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 const start=source.indexOf('        // --- Firebase Configuration & Initialization ---'),end=source.indexOf('        // Login Feature',start);
 source=source.slice(0,start)+`const auth={},db={},appId='test';let currentUser={uid:'test-owner'},firebaseUnsubscribers=[];const getUserDoc=(name,id)=>name+'/'+id;const runTransaction=window.fakeTransaction,serverTimestamp=()=>null;`+source.slice(end);
 w.eval(source+`\ncustomers=[{id:'oem-party',code:'C001',name:'ลูกค้าทดสอบ OEM',email:'example@example.invalid'}];savedRemarks=[];remarksLoaded=true;remarksDataUserId='test-owner';companyProfile={nameTh:'โรงงานทดสอบ',addressTh:'ที่อยู่ทดสอบ',taxId:'0000000000000',phone:''};window.oemTest={pdf:createDocumentPdfSource,docs:list=>database=list};`);
 w.handleMenuClick('OEMR','create');$('customer-select').value='oem-party';
 $('doc-date').value='2025-01-15';
 const submit=async()=>{$('create-doc-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();};
 const line=({name='กล้วยน้ำว้าดิบ',qty='300',unit='กก.',lot='',condition='',price='99'}={})=>{
  const row=$('items-container').lastElementChild;
  for(const [key,value] of Object.entries({'item-name':name,'item-qty':qty,'item-unit':unit,'oem-line-lot':lot,'oem-line-condition':condition,'item-price':price}))row.querySelector('.'+key).value=value;
  return row;
 };
 return {w,$,records,submit,line};
}

test('OEM material receipts capture actual lots and quantities, and show a non-financial customer copy',async t=>{
 const {w,$,records,submit,line}=setup(t);
 assert.equal($('create-doc-form').classList.contains('oem-receipt-form'),true);
 assert.equal($('live-amount-summary').classList.contains('hidden'),true);
 const row=line({lot:'BN-01',condition:'ลังปกติ'});assert.equal(row.querySelector('.item-price').disabled,true);
 w.addLineItem();line({lot:'BN-02',qty:'198.5',condition:'พบกล่องยุบ 1 กล่อง'});
 $('doc-ref-manual').value='DN-CUST-017';$('oem-job-ref').value='OEM-BANANA-005';$('oem-sender').value='ผู้ส่งทดสอบ';$('oem-receiver').value='ผู้รับทดสอบ';
 await submit();
 const doc=records.get('documents/OEMR-2025-001');
 assert.equal(records.size,1);assert.equal(doc.prefix,'OEMR');
 assert.deepEqual(doc.items.map(i=>[i.qty,i.unit,i.customerLot,i.receiptCondition]),[[300,'กก.','BN-01','ลังปกติ'],[198.5,'กก.','BN-02','พบกล่องยุบ 1 กล่อง']]);
 assert.deepEqual(doc.items.map(i=>[i.price,i.total]),[[0,0],[0,0]]);
 assert.equal(doc.grandTotal,0);assert.equal(doc.vatEnabled,false);assert.equal(doc.isInputTax,false);assert.equal(doc.isRevenue,false);assert.equal(doc.creditTerm,'');
 const ordinary={...doc,docNo:'INV-2025-004',prefix:'INV',docName:'Invoice',isRevenue:true,grandTotal:107,vatEnabled:true};
 w.oemTest.docs([doc,ordinary]);
 const source=w.oemTest.pdf(doc.docNo);
 assert.equal(source.querySelector('#preview-amount-summary').classList.contains('hidden'),true);
 assert.equal(source.querySelector('#preview-credit-row').classList.contains('hidden'),true);
 assert.equal(source.querySelector('#preview-col-amt').classList.contains('hidden'),true);
 assert.match(source.querySelector('#preview-oem-summary').textContent,/OEM-BANANA-005/);
 assert.match(source.querySelector('#preview-items-body').textContent,/BN-02.*พบกล่องยุบ 1 กล่อง/);
 assert.equal(source.querySelector('#preview-lbl-stamp-auth').textContent,'ผู้รับทดสอบ');
 w.previewDocument(doc.docNo);w.draftAIEmail();assert.match($('ai-email-body').value,/ยืนยันการรับวัตถุดิบ/);assert.doesNotMatch($('ai-email-body').value,/THB|ยอดชำระ/);
 w.previewDocument(ordinary.docNo);
 assert.equal($('preview-amount-summary').classList.contains('hidden'),false);
 assert.equal($('preview-oem-summary').classList.contains('hidden'),true);
 w.closePreview();w.editDocument(doc.docNo);$('custom-confirm-ok').click();
 assert.equal($('doc-ref-manual').value,'DN-CUST-017');assert.equal($('oem-job-ref').value,'OEM-BANANA-005');
 assert.equal($('items-container').lastElementChild.querySelector('.oem-line-lot').value,'BN-02');
});

test('OEM receipts require an actual positive quantity and do not overwrite an already-issued number',async t=>{
 const {w,$,records,submit,line}=setup(t);
 line({qty:'0'});await submit();assert.equal(records.size,0);
 line();$('doc-date').value='2099-01-15';await submit();assert.equal(records.size,0);
 $('doc-date').value='2025-01-15';
 const previous={docNo:'OEMR-2025-001',sentinel:'older receipt'};
 records.set('documents/'+previous.docNo,previous);
 await submit();
 assert.deepEqual(records.get('documents/'+previous.docNo),previous);
 assert.equal(records.get('documents/OEMR-2025-002').items[0].qty,300);
});
