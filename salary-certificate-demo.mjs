import {createSalaryCertificateController} from './salary-certificate-ui.mjs';
import {demoCompany,demoEmployees,demoDraft} from './salary-certificate-demo-data.mjs';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const company=structuredClone(demoCompany),employees=structuredClone(demoEmployees);

const data=new Map([['settings/companyProfile',company],...employees.map(e=>['employees/'+e.id,e])]);
let notify=()=>{},queue=Promise.resolve();
const snapshot=key=>({exists:()=>data.has(key),data:()=>structuredClone(data.get(key))});
const records=()=>[...data.entries()].filter(([key])=>key.startsWith('hr_salary_certificates/')).map(([,record])=>structuredClone(record));
const host=document.getElementById('salary-demo');
const controller=createSalaryCertificateController(host,{
    demo:true,initialDraft:demoDraft(today()),db:{},getUserId:()=> 'demo-only-account',getEmployees:()=>employees,getCompany:()=>company,isReady:()=>true,today,newId:()=>crypto.randomUUID(),getActor:()=>({name:'ผู้ทดลอง (ข้อมูลสมมติ)'}),serverTimestamp:()=>new Date().toISOString(),userDoc:(collection,id)=>({path:collection+'/'+id}),
    getDocFromServer:async ref=>snapshot(ref.path),
    runTransaction:async(_db,callback)=>{const task=queue.then(async()=>{const writes=[];const result=await callback({get:async ref=>snapshot(ref.path),set:(ref,value)=>writes.push([ref.path,structuredClone(value)])});for(const [key,value]of writes)data.set(key,value);queueMicrotask(()=>notify(records()));return result;});queue=task.catch(()=>{});return task;},
    watchRecords:(next)=>{notify=next;queueMicrotask(()=>next(records()));return()=>{notify=()=>{};};},
    openEmployees:()=>document.getElementById('demo-employee-help').showModal()
});
document.getElementById('demo-close-help').onclick=()=>document.getElementById('demo-employee-help').close();
document.getElementById('demo-toggle-signers').onchange=event=>{for(const e of employees.filter(e=>e.id!=='demo-employee')){e.status=event.target.checked?'resigned':'active';data.set('employees/'+e.id,structuredClone(e));}controller.refresh();};
