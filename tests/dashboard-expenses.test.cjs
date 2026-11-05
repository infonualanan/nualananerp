const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function setup(t,documents=[]){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://offline.test/'});
 t.after(()=>dom.window.close());
 const w=dom.window,$=id=>w.document.getElementById(id);
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.eval(html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1]);
 let source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;\s*$/gm,'');
 const start=source.indexOf('        // --- Firebase Configuration & Initialization ---'),end=source.indexOf('        // Login Feature',start);
 source=source.slice(0,start)+`const auth={},db={},appId='test';let currentUser={uid:'test-owner'},firebaseUnsubscribers=[];`+source.slice(end);
 w.eval(source+`\ndatabase=${JSON.stringify(documents)};window.dashboardTest={refresh:(list)=>{database=list;updateDashboard();},expenses:dashboardExpenses};updateDashboard();`);
 return {w,$};
}
const voucher=(docNo,grandTotal,extra={})=>({docNo,prefix:'PV',docName:'ใบจ่ายเงิน',status:'completed',currency:'THB',exchangeRate:1,grandTotal,items:[],...extra});

test('expenses count payment vouchers once without counting linked purchase or payroll documents',t=>{
 const pv=voucher('PV-001',10700,{refDocManual:'PO-001, PINV-001, PAYSLIP-001'});
 const rows=[pv,...['PO','VB','PINV','GRN','OEMR','PAYSLIP','RV','JV'].map(prefix=>voucher(prefix+'-001',10700,{prefix})),
  voucher('PV-002',999,{status:'cancelled'}),voucher('PV-003',888,{status:'draft'}),pv];
 const {w,$}=setup(t,rows);
 assert.equal(w.dashboardTest.expenses(rows).cents,1070000);
 assert.equal(w.dashboardTest.expenses(rows).count,1);
 assert.match($('dash-total-expenses').textContent,/10,700\.00/);
 assert.equal($('dash-expense-count').textContent,'ยอดสะสมทั้งหมด · 1 ใบ');
 $('dash-open-expenses').click();
 assert.equal($('tab-document-list').classList.contains('active'),true);
 assert.equal($('document-type-filter').value,'PV');
 assert.equal($('document-table-body').textContent.includes('PINV-001'),true); // Only the PV's reference is shown.
 assert.equal($('document-table-body').querySelectorAll('tr').length,4); // Includes draft/cancelled rows for inspection.
 w.toggleLanguage();
 assert.equal($('dash-expense-label').textContent,'Expenses per payment vouchers (PV)');
 assert.equal($('dash-expense-count').textContent,'All time · 1 voucher');
});
test('expense totals use satang and saved FX rates, flag invalid values, and refresh after changes',t=>{
 const rows=[voucher('PV-01',0.1),voucher('PV-02',0.2),voucher('PV-FX','10.01',{currency:'USD',exchangeRate:35.123456}),
  voucher('PV-NORATE',100,{currency:'USD',exchangeRate:undefined}),voucher('PV-NEG',-50)];
 const {w,$}=setup(t,rows),before=JSON.stringify(rows);
 const result=w.dashboardTest.expenses(rows);
 assert.equal(result.cents,35189);assert.equal(result.count,3);assert.equal(result.invalid,2);
 assert.match($('dash-total-expenses').textContent,/351\.89/);
 assert.equal($('dash-expense-warning').classList.contains('hidden'),false);
 assert.match($('dash-expense-warning').textContent,/PV 2 ใบ/);
 assert.equal(JSON.stringify(rows),before);
 w.dashboardTest.refresh([]);
 assert.match($('dash-total-expenses').textContent,/0\.00/);
 assert.equal($('dash-open-expenses').disabled,true);
 assert.equal($('dash-expense-warning').classList.contains('hidden'),true);
});
