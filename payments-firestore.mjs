import {applyOperation, createLedger, operationPrefix, ledgerSummary} from './payments-core.mjs';
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
export function createPaymentStore(api) {
    const scope = () => {
        const uid = api.getUserId();
        if (!uid) throw new Error('กรุณาเข้าสู่ระบบก่อน');
        const check = () => { if (api.getUserId() !== uid) throw new Error('บัญชีผู้ใช้เปลี่ยน กรุณาเปิดรายการใหม่'); };
        return {uid, check, ref:(collection,id)=>{check();return api.userDoc(collection,id);}};
    };
    async function activate(orderNo, mode, dueDate) {
        const session=scope(), rootRef=session.ref('documents',orderNo);
        const documents=await api.readServerDocuments(); session.check();
        return api.runTransaction(api.db,async tx=>{
            const snap=await tx.get(rootRef); session.check();
            if (!snap.exists()) throw new Error('ไม่พบเอกสารต้นทาง');
            const root=snap.data();
            if(root.paymentLedger && root.paymentLedger.mode!==mode) throw new Error('เอกสารนี้ถูกเปิดด้วยวิธีออกเอกสารอื่นแล้ว กรุณาตรวจรายการล่าสุด');
            const ledger=createLedger(root,mode,dueDate,api.today(),documents);
            if (!root.paymentLedger) tx.update(rootRef,{paymentLedger:ledger,isRevenue:false,status:'pending',paymentUpdatedAt:api.serverTimestamp()});
            return {...root,paymentLedger:ledger};
        });
    }
    async function commit(orderNo,action) {
        const session=scope(), rootRef=session.ref('documents',orderNo), today=api.today();
        return api.runTransaction(api.db,async tx=>{
            const snap=await tx.get(rootRef); session.check();
            if (!snap.exists()) throw new Error('ไม่พบเอกสารต้นทาง');
            const root=snap.data(), ledger=root.paymentLedger;
            if (!ledger) throw new Error('ยังไม่ได้เปิดรับชำระหลายงวด');
            const done=ledger.documents.find(d=>d.requestId===action.requestId);
            if (done) return {replayed:true,docNo:done.docNo,root};
            if ((ledger.revision||0)!==action.expectedRevision) throw new Error('มีรายการเปลี่ยนจากอีกเครื่อง กรุณากลับไปตรวจสอบยอดล่าสุดก่อนยืนยัน');
            const prefix=operationPrefix(root,action), year=(action.kind==='payment'?action.input.date:today).slice(0,4);
            let docNo='', counterRef=null, number=0, outRef=null;
            if (prefix) {
                counterRef=session.ref('settings','payment-sequence-'+year);
                const counter=await tx.get(counterRef); session.check();
                number=Number(counter.exists()?counter.data()[prefix]||0:0);
                if (!Number.isSafeInteger(number)||number<0) throw new Error('เลขลำดับเอกสารไม่ถูกต้อง');
                // Dedicated P series cannot collide with the legacy numeric sequence.
                for(let attempts=0;attempts<5;attempts++) {
                    number++; docNo=prefix+'-'+year+'-P'+String(number).padStart(6,'0');outRef=session.ref('documents',docNo);
                    const existing=await tx.get(outRef); session.check();
                    if (!existing.exists()) break;
                    if (attempts===4) throw new Error('เลขที่เอกสารซ้ำ กรุณาตรวจสอบเลขลำดับ');
                }
            }
            const result=applyOperation(root,action,docNo,today);
            if (bytes({...root,paymentLedger:result.ledger})>850000 || (result.document&&bytes(result.document)>900000)) throw new Error('ข้อมูลเอกสารมีขนาดใหญ่เกินไป กรุณาลดขนาดหลักฐาน');
            session.check();
            const summary=ledgerSummary({...root,paymentLedger:result.ledger});
            tx.update(rootRef,{paymentLedger:result.ledger,isRevenue:result.ledger.delivered,status:summary.balance===0?'paid':summary.paid>0?'partial':'pending',paymentUpdatedAt:api.serverTimestamp()});
            if (result.document) {
                tx.set(outRef,{...result.document,createdAt:api.serverTimestamp(),recordedBy:session.uid});
                tx.set(counterRef,{[prefix]:number},{merge:true});
            }
            return {...result,root:{...root,paymentLedger:result.ledger,isRevenue:result.ledger.delivered}};
        });
    }
    return {activate,commit};
}
