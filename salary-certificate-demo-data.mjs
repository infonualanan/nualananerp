import {blankDraft} from './salary-certificate-core.mjs';
export const demoEmployees=[
    {id:'demo-employee',code:'DEMO-001',name:'พนักงานตัวอย่าง A',position:'เจ้าหน้าที่บัญชี (ตัวอย่าง)',joinDate:'2023-06-01',status:'active',salary:30000},
    {id:'demo-md',code:'DEMO-MD',name:'ผู้รับรองตัวอย่าง A',position:'กรรมการผู้จัดการ',joinDate:'2020-01-01',status:'active',salary:0},
    {id:'demo-gm',code:'DEMO-GM',name:'ผู้รับรองตัวอย่าง B',position:'ผู้จัดการทั่วไป',joinDate:'2021-01-01',status:'active',salary:0}
];
export const demoCompany={nameTh:'บริษัท ตัวอย่าง จำกัด',nameEn:'EXAMPLE COMPANY LIMITED',addressTh:'ที่อยู่ตัวอย่างสำหรับทดลองแบบฟอร์ม (ข้อมูลสมมติ)',taxId:'',branch:'สำนักงานใหญ่ (ตัวอย่าง)',phone:'',email:'',logo:''};
export function demoDraft(today){return {...blankDraft(today),employeeId:'demo-employee',purpose:'ใช้ประกอบการยื่นคำขอสินเชื่อ (ข้อมูลสมมติ)',recipient:'ผู้เกี่ยวข้อง',baseSalary:'30000',allowances:[{label:'ค่าตำแหน่ง (ตัวอย่าง)',amount:'2500'}],paymentMethod:'bank',signerId:'demo-md'};}
