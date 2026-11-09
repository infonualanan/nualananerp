export const MAX_CUSTOMER_TEXT=16000;
export const CUSTOMER_FIELDS={name:{label:'ชื่อบริษัท/องค์กร',id:'new-cust-name',limit:300},contactName:{label:'ชื่อผู้ติดต่อ',id:'new-cust-contact',limit:150},email:{label:'อีเมล',id:'new-cust-email',limit:254},phone:{label:'โทรศัพท์',id:'new-cust-phone',limit:160},taxId:{label:'เลขผู้เสียภาษี',id:'new-cust-tax',limit:80},registrationNo:{label:'เลขทะเบียนนิติบุคคล',id:'new-cust-registration',limit:80},branch:{label:'สาขา',id:'new-cust-branch',limit:100},address:{label:'ที่อยู่',id:'new-cust-address',limit:2000}};
const stringOrNull=()=>({type:['string','null']});
export const customerExtractionSchema={type:'object',additionalProperties:false,properties:{readable:{type:'boolean'},candidates:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(Object.keys(CUSTOMER_FIELDS).map(k=>[k,stringOrNull()])),role:{type:'string',enum:['company','buyer','seller','unknown']},warnings:{type:'array',items:{type:'string'}}},required:[...Object.keys(CUSTOMER_FIELDS),'role','warnings']}},warnings:{type:'array',items:{type:'string'}}},required:['readable','candidates','warnings']};
const ensure=(ok)=>{if(!ok)throw new Error('ผลอ่านข้อมูลลูกค้าไม่สมบูรณ์ กรุณาลองใหม่');};
const clean=x=>x.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
const digits=x=>x.replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-3664));
function warnings(v){ensure(Array.isArray(v)&&v.length<=20&&v.every(x=>typeof x==='string'&&x.length<=500));return v.map(clean).filter(Boolean);}
export function normalizeCustomerExtraction(raw){
 ensure(raw&&typeof raw.readable==='boolean'&&Array.isArray(raw.candidates)&&raw.candidates.length<=5);
 const result={readable:raw.readable,warnings:warnings(raw.warnings),candidates:[]};
 for(const value of raw.candidates){
  ensure(value&&['company','buyer','seller','unknown'].includes(value.role));
  const row={role:value.role,warnings:warnings(value.warnings)};
  for(const [key,meta] of Object.entries(CUSTOMER_FIELDS)){
   const v=value[key];ensure(v===null||typeof v==='string');ensure(v===null||v.length<=meta.limit);
   row[key]=v===null?null:clean(v)||null;
  }
  for(const key of ['taxId','registrationNo'])if(row[key]){row[key]=digits(row[key]);if(/^[\d\s-]+$/.test(row[key]))row[key]=row[key].replace(/[\s-]/g,'');}
  if(row.phone)row.phone=digits(row.phone);
  if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)){row.email=null;row.warnings.push('อีเมลอ่านไม่ชัด กรุณาตรวจจากต้นฉบับ');}
  if(row.taxId&&/^\d+$/.test(row.taxId)&&row.taxId.length!==13)row.warnings.push('เลขผู้เสียภาษีที่อ่านได้ไม่ครบ 13 หลัก กรุณาตรวจว่าเป็นเลขต่างประเทศหรืออ่านผิด');
  row.warnings=[...new Set(row.warnings)].slice(0,20);
  if(Object.keys(CUSTOMER_FIELDS).some(key=>row[key]))result.candidates.push(row);
 }
 if(!result.readable)result.candidates=[];
 return result;
}
export function customerFillPlan(current,candidate,mode='empty',pristine=false){
 const updates={},kept=[];
 for(const key of Object.keys(CUSTOMER_FIELDS)){
  const value=candidate[key];if(value==null||!String(value).trim())continue;
  const existing=String(current[key]||'').trim(),defaultBranch=pristine&&key==='branch'&&existing==='สำนักงานใหญ่';
  if(mode==='replace'||!existing||defaultBranch)updates[key]=value;else if(existing!==value)kept.push(key);
 }
 if(pristine&&!candidate.branch&&current.branch==='สำนักงานใหญ่')updates.branch='';
 return {updates,kept};
}
