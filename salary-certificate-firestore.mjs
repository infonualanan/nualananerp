import {createContent,sourceStamp,certificateNumber,sameCertificateContent} from './salary-certificate-core.mjs';
export function createSalaryIssuer(adapter) {
    return async function issue(request) {
        const uid=adapter.getUserId(); if(!uid||uid!==request.uid)throw new Error('บัญชีผู้ใช้เปลี่ยน กรุณาเปิดฟอร์มใหม่');
        if(!/^[\w-]{8,100}$/.test(request.id))throw new Error('รหัสคำขอไม่ถูกต้อง');
        const guard=()=>{if(adapter.getUserId()!==uid)throw new Error('บัญชีผู้ใช้เปลี่ยน กรุณาเปิดฟอร์มใหม่');};
        const ref=adapter.userDoc('hr_salary_certificates',request.id);
        const employeeRef=adapter.userDoc('employees',request.draft.employeeId), signerRef=adapter.userDoc('employees',request.draft.signerId);
        const companyRef=adapter.userDoc('settings','companyProfile');
        const counterRef=adapter.userDoc('hr_certificate_counters',String(Number(request.draft.issueDate.slice(0,4))+543));
        const requestCopy=JSON.parse(JSON.stringify(request));
        const result=await adapter.runTransaction(adapter.db,async tx=>{
            guard();
            const previous=await tx.get(ref); guard();
            if(previous.exists()) {
                const data=previous.data();
                if(!sameCertificateContent(data.content,requestCopy.content)||data.createdBy?.uid!==uid)throw new Error('คำขอเดิมมีข้อมูลต่างกัน กรุณาตรวจประวัติหนังสือ');
                return {...data,id:request.id};
            }
            const [e,s,c,count]=await Promise.all([tx.get(employeeRef),tx.get(signerRef),tx.get(companyRef),tx.get(counterRef)]); guard();
            if(!e.exists()||!s.exists()||!c.exists())throw new Error('ข้อมูลต้นทางไม่ครบ กรุณาตรวจฐานข้อมูล');
            const sources={employees:[{...e.data(),id:requestCopy.draft.employeeId},...(employeeRef.path===signerRef.path?[]:[{...s.data(),id:requestCopy.draft.signerId}])],company:c.data(),today:adapter.today()};
            const content=createContent(requestCopy.draft,sources);
            if(sourceStamp(sources,requestCopy.draft)!==requestCopy.sourceStamp || !sameCertificateContent(content,requestCopy.content))throw new Error('ข้อมูลบริษัท พนักงาน หรือผู้รับรองเปลี่ยนแล้ว กรุณากลับไปตรวจทานใหม่');
            if(requestCopy.draft.reviewed!==true)throw new Error('กรุณายืนยันการตรวจทานข้อมูล');
            const last=count.exists()?count.data().last:0;
            if(!Number.isSafeInteger(last)||last<0)throw new Error('เลขลำดับหนังสือไม่ถูกต้อง');
            const sequence=last+1,number=certificateNumber(content.issueDate,sequence);
            const record={id:request.id,number,content,status:'issued-awaiting-signature',createdBy:{uid,name:String(adapter.getActor()?.name??'').slice(0,200)},createdISO:new Date().toISOString(),createdAt:adapter.serverTimestamp()};
            if(new TextEncoder().encode(JSON.stringify(record)).length>850000)throw new Error('ข้อมูลหนังสือมีขนาดใหญ่เกินไป กรุณาย่อโลโก้บริษัท');
            guard(); tx.set(counterRef,{last:sequence,updatedAt:adapter.serverTimestamp()});tx.set(ref,record);return record;
        });
        guard(); return result;
    };
}
