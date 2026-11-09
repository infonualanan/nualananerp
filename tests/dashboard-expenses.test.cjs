// All identifiers, parties and amounts below are synthetic test fixtures; no business records are used.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const company={taxId:'TEST-COMPANY-TAX'};
function setup(t,documents=[],vault=[]){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'});
 t.after(()=>dom.window.close());
 const w=dom.window,$=id=>w.document.getElementById(id);
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 const start=source.indexOf('        // --- Firebase Configuration & Initialization ---'),end=source.indexOf('        // Login Feature',start);
 source=source.slice(0,start)+`const auth={},db={},appId='test';let currentUser={uid:'test-owner'},firebaseUnsubscribers=[];`+source.slice(end);
 w.eval(source+`\nwindow.dashboardTest={refresh:(list,vault=[],state='ready')=>{database=list;dashboardVaultRecords=vault;dashboardVaultState=state;companyProfile=${JSON.stringify(company)};updateDashboard();},expenses:(list,vault=[])=>dashboardExpenses(list,vault,${JSON.stringify(company)}),statuses:()=>{updateAllStatuses();return database;},reset:resetUserData};`);
 w.dashboardTest.refresh(documents,vault);
 return {w,$};
}
const doc=(prefix,number,grandTotal,extra={})=>({docNo:prefix+'-'+number,prefix,docName:prefix,status:'completed',currency:'THB',exchangeRate:1,grandTotal,items:prefix==='PAYSLIP'?[{code:'SALARY',total:grandTotal}]:[],customerName:'Supplier A',customerTaxId:'TEST-SUPPLIER-A-TAX',customerBranch:'00000',...extra});
const vault=(id,type,grandTotal,extra={})=>({id,status:'reviewed',data:{documentType:type,documentNo:id,documentDate:'2026-11-01',currency:'THB',grandTotal,sellerName:'Supplier A',sellerTaxId:'TEST-SUPPLIER-A-TAX',sellerBranch:'00000',buyerTaxId:company.taxId,reviewed:true,...extra}});

test('dashboard includes purchase invoices, bills, vouchers, payroll and supplier adjustments; excludes PO and sales',t=>{
 const rows=[doc('PINV','1',10700),doc('VB','1',2100),doc('PV','1',3000),doc('PAYSLIP','1',18000),doc('SDN','1',500),doc('SCN','1',1000),
 ...['PO','PR','GRN','OEMR','TINV','RE','RETAX','RV','JV','WHT','STI','PDO'].map(p=>doc(p,'exclude',99999))];
 const {w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,3330000);assert.equal(r.count,6);assert.equal(r.invalid,0);
 assert.match($('dash-total-expenses').textContent,/33,300\.00/);
 assert.equal($('dash-expense-label').textContent,'รายจ่ายตามเอกสารฝั่งซื้อ/จ่าย (รวมภาษี)');
 $('dash-open-expenses').click();assert.equal($('dash-open-expenses').getAttribute('aria-expanded'),'true');
 assert.equal($('dash-expense-details').classList.contains('hidden'),false);
 assert.equal($('dash-expense-rows').querySelectorAll('tr').length,6);
 assert.doesNotMatch($('dash-expense-rows').textContent,/PO-exclude|RE-exclude/);
 $('dash-open-expenses').click();assert.equal($('dash-expense-details').classList.contains('hidden'),true);
 w.toggleLanguage();assert.equal($('dash-expense-label').textContent,'Purchase/payment documents (including tax)');
 assert.equal($('dash-expense-count').textContent,'All time · 6 documents');
});
test('linked invoices, partial vouchers and payroll settlements count once; a shared PO does not merge separate invoices',t=>{
 const a=doc('PINV','1',10000),rows=[a,a,doc('VB','1',10000,{refDocManual:'PINV-1'}),doc('PV','1',6000,{refDocManual:'VB-1'}),doc('PV','2',4000,{refDocManual:'PINV-1'}),
 doc('PAYSLIP','1',20000),doc('PV','salary',20000,{refDocManual:'PAYSLIP-1'}),doc('PINV','2',4000,{refDocManual:'PO-common'}),doc('PINV','3',6000,{refDocManual:'PO-common'}),doc('PO','common',10000)];
 const {w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,4000000);assert.equal(r.count,4);assert.equal(r.duplicates,4);assert.equal(r.invalid,0);
 assert.match($('dash-expense-count').textContent,/ไม่นับซ้ำ 4 ใบ/);
 assert.match($('dash-expense-rows').textContent,/นับผ่านเอกสารอ้างอิงแล้ว/);
 assert.equal(r.rows.find(x=>x.docNo==='PV-1').covers[0],'erp:PINV-1');
});
test('receipt to voucher to invoice chains count only invoices, including cyclic settlement references',t=>{
 const rows=[doc('PINV','1',10000),doc('PINV','2',5000),doc('PV','1',15000,{refDocManual:'PINV-1, PINV-2'}),doc('PV','partial',6000,{refDocManual:'PINV-1, RC-partial'})];
 const files=[vault('RC-paid','receipt',15000,{referenceNo:'PV-1'}),vault('RC-partial','receipt',6000,{referenceNo:'PV-partial'})];
 const {w}=setup(t,rows,files),r=w.dashboardTest.expenses(rows,files);
 assert.equal(r.cents,1500000);assert.equal(r.count,2);assert.equal(r.duplicates,4);assert.equal(r.invalid,0);
 assert.deepEqual(Array.from(r.rows.find(x=>x.docNo==='RC-paid').covers).sort(),['erp:PINV-1','erp:PINV-2']);
});
test('reviewed supplier vault documents are included and matched to ERP supplier invoice identity',t=>{
 const rows=[doc('PINV','1',1000,{vendorInvNo:'INV-999',customerBranch:'สำนักงานใหญ่'})],files=[vault('copy','tax_invoice','1,000.00',{documentNo:'INV-999'}),
 vault('receipt','receipt',1000,{referenceNo:'PINV-1'}),vault('bill','invoice',1500),vault('cash','receipt',250),vault('misc','other',90),vault('credit','credit_note',100),vault('debit','debit_note',40),
 {...vault('draft','receipt',999),status:'draft'},vault('not-reviewed','tax_invoice',999,{reviewed:false}),vault('sales','receipt_tax',999,{sellerTaxId:company.taxId}),vault('wrong-buyer','receipt',999,{buyerTaxId:'TEST-OTHER-BUYER-TAX'}),vault('PO-upload','purchase_order',99999)];
 const {w,$}=setup(t,rows,files),before=JSON.stringify([rows,files]),r=w.dashboardTest.expenses(rows,files);
 assert.equal(r.cents,278000);assert.equal(r.count,6);assert.equal(r.duplicates,2);assert.equal(r.invalid,1);
 assert.equal(r.rows.find(x=>x.docNo==='draft').state,'unreviewed');assert.equal(r.rows.find(x=>x.docNo==='sales').state,'sales');
 assert.equal(JSON.stringify([rows,files]),before);assert.match($('dash-expense-rows').textContent,/คลังเอกสารแนบ/);
 w.dashboardTest.refresh([],files.filter(x=>x.id==='cash'));assert.match($('dash-total-expenses').textContent,/250\.00/);
});
test('satang and saved exchange rates stay exact; malformed amounts and missing FX are flagged',t=>{
 const rows=[doc('PV','01',0.1),doc('PV','02',0.2),doc('PV','FX','10.01',{currency:'USD',exchangeRate:35.123456}),
 doc('PV','NORATE',100,{currency:'USD',exchangeRate:undefined}),doc('PV','NEG',-50),doc('PV','BAD','1,2,3')];
 const {w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,35189);assert.equal(r.count,3);assert.equal(r.invalid,3);
 assert.match($('dash-total-expenses').textContent,/351\.89/);assert.match($('dash-expense-warning').textContent,/ยังไม่รวม 3 ใบ/);
 w.dashboardTest.refresh([]);assert.match($('dash-total-expenses').textContent,/0\.00/);assert.equal($('dash-open-expenses').disabled,true);
 assert.equal($('dash-expense-warning').classList.contains('hidden'),true);
});
test('ambiguous linked totals are held for review, and equal invoice numbers from different suppliers stay separate',t=>{
 const rows=[doc('PINV','1',1000),doc('VB','1',1200,{refDocManual:'PINV-1'}),doc('PV','1',1500,{refDocManual:'PINV-1'}),
 doc('PINV','2',2000,{vendorInvNo:'REUSED'}),doc('PINV','3',3000,{vendorInvNo:'REUSED',customerTaxId:'TEST-SUPPLIER-B-TAX',customerName:'Supplier B'})];
 const {w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,600000);assert.equal(r.count,3);assert.equal(r.invalid,2);
 assert.equal(r.rows.find(x=>x.docNo==='VB-1').state,'review');assert.match($('dash-expense-rows').textContent,/ยอดอ้างอิงไม่ตรง/);
});
test('cancelled and draft expense statuses survive table refresh and language changes',t=>{
 const rows=['PINV','PAYSLIP','VB','PV','SCN','SDN'].flatMap(p=>[doc(p,'cancelled',1000,{status:'cancelled',refDocManual:'RE-paid'}),doc(p,'draft',1000,{status:'draft'})]);
 rows.push(doc('RE','paid',1000,{refDocManual:'PINV-cancelled, PAYSLIP-draft'}));const {w,$}=setup(t,rows);
 w.updateDocumentTable();w.toggleLanguage();assert.equal(w.dashboardTest.expenses(rows).count,0);
 const after=w.dashboardTest.statuses();for(const r of after.filter(x=>x.prefix!=='RE'))assert.ok(['cancelled','draft'].includes(r.status),r.docNo);
 assert.match($('dash-total-expenses').textContent,/0\.00/);
});
test('vault loading/errors mark totals incomplete and account reset clears expense details',t=>{
 const {w,$}=setup(t,[doc('PV','1',50)],[vault('cash','receipt',20)]);
 w.dashboardTest.refresh([doc('PV','1',50)],[],'loading');assert.match($('dash-expense-warning').textContent,/ยอดนี้ยังไม่ครบ/);
 w.dashboardTest.refresh([doc('PV','1',50)],[],'error');assert.match($('dash-expense-warning').textContent,/โหลดคลังเอกสารไม่สำเร็จ/);
 w.dashboardTest.refresh([doc('PV','1',50)],[vault('cash','receipt',20)]);$('dash-open-expenses').click();w.dashboardTest.reset();
 assert.equal($('dash-expense-rows').children.length,0);assert.equal($('dash-expense-details').classList.contains('hidden'),true);
 assert.equal($('dash-open-expenses').getAttribute('aria-expanded'),'false');
});

test('PO alone remains awaiting documents and contributes zero; details remain available',t=>{
 const rows=[doc('PO','1',10000)],{w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,0);assert.equal(r.count,0);assert.equal(r.purchaseOrders.length,1);assert.equal(r.purchaseOrders[0].state,'waiting');
 assert.match($('dash-po-summary').textContent,/PO รอเอกสารผู้ขาย 1 ใบ/);assert.equal($('dash-open-expenses').disabled,false);
 $('dash-open-expenses').click();assert.match($('dash-po-details').textContent,/PO-1.*รอเอกสารผู้ขาย/);
});
test('linked invoices contribute only their documented amounts, never the full PO or separate copies per PO',t=>{
 const rows=[doc('PO','1',10000),doc('PO','2',20000),doc('PINV','1',4000,{refDocManual:'PO-1, PO-2'}),doc('GRN','1',10000),doc('PO','cancelled',10000,{status:'cancelled'})];
 const {w,$}=setup(t,rows);w.updateDocumentTable();const r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,400000);assert.equal(r.count,1);assert.equal(r.purchaseOrders.length,2);
 for(const order of r.purchaseOrders){assert.equal(order.state,'supported');assert.deepEqual(Array.from(order.proofKeys),['erp:PINV-1']);}
 assert.equal($('dash-po-summary').textContent,'');assert.match($('dash-po-details').textContent,/PINV-1/);
 assert.equal(rows.find(r=>r.docNo==='PO-cancelled').status,'cancelled');
});
test('only reviewed supplier evidence supports PO; unreviewed, cancelled and wrong-supplier documents do not',t=>{
 const rows=[doc('PO','1',10000),doc('PINV','cancelled',10000,{status:'cancelled',refDocManual:'PO-1'}),doc('PINV','other',4000,{refDocManual:'PO-1',customerTaxId:'TEST-SUPPLIER-B-TAX'})];
 const file=vault('RC-1','receipt',2500,{referenceNo:'PO-1'}),{w}=setup(t,rows);
 assert.equal(w.dashboardTest.expenses(rows,[{...file,status:'draft'}]).purchaseOrders[0].state,'waiting');
 const r=w.dashboardTest.expenses(rows,[file]);assert.equal(r.purchaseOrders[0].state,'supported');
 assert.deepEqual(Array.from(r.purchaseOrders[0].proofKeys),['vault:RC-1']);assert.equal(r.cents,650000);
});
test('receipt and PV naming only a shared PO wait for invoice matching rather than double-counting',t=>{
 const rows=[doc('PO','1',10000),doc('PINV','1',4000,{refDocManual:'PO-1'}),doc('PV','1',2000,{refDocManual:'PO-1'})],file=vault('RC-1','receipt',4000,{referenceNo:'PO-1'}),{w,$}=setup(t,rows,[file]);
 const held=w.dashboardTest.expenses(rows,[file]);assert.equal(held.cents,400000);assert.equal(held.invalid,2);
 assert.equal(held.rows.find(r=>r.docNo==='RC-1').state,'po-review');assert.match($('dash-expense-rows').textContent,/กรุณาระบุเลขใบซื้อที่ชำระ/);
 const matchedRows=rows.map(d=>d.prefix==='PV'?{...d,refDocManual:'PINV-1, PO-1'}:d),matchedFile={...file,data:{...file.data,referenceNo:'PINV-1, PO-1'}};
 const matched=w.dashboardTest.expenses(matchedRows,[matchedFile]);assert.equal(matched.cents,400000);assert.equal(matched.invalid,0);assert.equal(matched.duplicates,2);
});

test('payroll expenses count saved earnings before advances, even when saved subtotal already contains the advance deduction',t=>{
 const rows=[15000,12000,9000].map((advance,i)=>doc('PAYSLIP','gross-'+i,30000-advance,{subtotal:30000-advance,items:[{code:'SALARY',total:30000},{name:'เบิกล่วงหน้า',total:-advance}]})),before=JSON.stringify(rows);
 const {w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,9000000);assert.equal(r.count,3);assert.equal(r.invalid,0);assert.equal(JSON.stringify(rows),before,'calculating expense totals must not change saved net pay');
 assert.match($('dash-total-expenses').textContent,/90,000\.00/);assert.match($('dash-expense-guidance').textContent,/ก่อนหักเบิก\/รายการหัก/);assert.doesNotMatch($('dash-expense-guidance').textContent,/เงินเดือนสุทธิ/);
 const row=$('dash-expense-rows').querySelector('tr').children[2];assert.match(row.textContent,/30,000\.00/);assert.match(row.textContent,/เบิก\/รายการหักรวม: 15,000\.00/);assert.match(row.textContent,/ยอดจ่ายสุทธิ: 15,000\.00/);
 w.toggleLanguage();assert.match($('dash-expense-rows').textContent,/Gross earnings before deductions/);assert.match($('dash-expense-guidance').textContent,/gross payroll before advances and deductions/);
});

test('payroll includes bonuses and overtime after line discounts while stored deductions and legacy fractional net pay remain separate',t=>{
 const slip=doc('PAYSLIP','earnings',16554.434,{subtotal:17611.10,ssoAmt:880.555,whtAmt:176.111,items:[{code:'SALARY',total:30000},{name:'Bonus',total:'2,500.00'},{name:'OT after discount',price:1234.56,discVal:10,total:1111.10,displayTotal:1111.10},{name:'Advance',total:-16000}]}),{w,$}=setup(t,[slip]),r=w.dashboardTest.expenses([slip]);
 assert.equal(r.cents,3361110);assert.equal(r.rows[0].payroll.netCents,1655443);assert.equal(r.rows[0].payroll.deductionsCents,1705667);assert.equal(slip.grandTotal,16554.434);
 assert.match($('dash-expense-rows').textContent,/ยอดจ่ายสุทธิ: 16,554\.43/);
});

test('full salary advances and linked payroll payment vouchers never add salary expenses twice',t=>{
 const rows=[doc('PAYSLIP','full',0,{subtotal:0,items:[{total:18000},{total:-18000}]}),doc('PV','advance-full',18000,{refDocManual:'PAYSLIP-full'}),
 doc('PAYSLIP','partial',14000,{subtotal:14000,items:[{total:24000},{total:-10000}]}),doc('PV','advance-partial',10000,{refDocManual:'PAYSLIP-partial'}),doc('PV','net',14000,{refDocManual:'PAYSLIP-partial'})];
 const {w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);assert.equal(r.cents,4200000);assert.equal(r.count,2);assert.equal(r.duplicates,3);assert.equal(r.invalid,0);assert.equal(r.rows.find(x=>x.docNo==='PAYSLIP-full').payroll.netCents,0);assert.match($('dash-expense-rows').textContent,/ยอดจ่ายสุทธิ: 0\.00/);
});

test('missing or malformed payroll earnings are flagged instead of guessing gross salary from net pay, subtotal or employee defaults',t=>{
 const rows=[doc('PAYSLIP','missing',12000,{subtotal:12000,items:[]}),doc('PAYSLIP','bad',12000,{items:[{total:'not-money'}]}),doc('PAYSLIP','fraction',12000,{items:[{total:'12000.001'}]})],{w,$}=setup(t,rows),r=w.dashboardTest.expenses(rows);
 assert.equal(r.cents,0);assert.equal(r.count,0);assert.equal(r.invalid,3);assert.match($('dash-expense-rows').textContent,/ตรวจรายการรายได้ก่อนหักในสลิป/);assert.equal($('dash-expense-warning').classList.contains('hidden'),false);
});

test('payroll satang and FX conversions stay exact and available gross earnings do not invent missing net pay',t=>{
 const fx=doc('PAYSLIP','fx','1.06',{currency:'USD',exchangeRate:'36.25',items:[{total:1.01},{total:'0.20'},{total:-0.15}]}),{w,$}=setup(t,[fx]),r=w.dashboardTest.expenses([fx]);
 assert.equal(r.cents,4386);assert.equal(r.rows[0].payroll.grossCents,4386);assert.equal(r.rows[0].payroll.netCents,3843);assert.equal(r.rows[0].payroll.deductionsCents,543);
 const noNet=doc('PAYSLIP','no-net','',{items:[{total:1000}]});w.dashboardTest.refresh([noNet]);const known=w.dashboardTest.expenses([noNet]);assert.equal(known.cents,100000);assert.equal(known.rows[0].payroll.netCents,null);assert.match($('dash-expense-rows').textContent,/ตรวจยอดจ่ายสุทธิจากสลิปต้นฉบับ/);
});
