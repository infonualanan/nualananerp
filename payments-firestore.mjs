import {applyOperation, createLedger, operationPrefix, ledgerSummary, cancelPaymentDocument, isCancelledRecord} from './payments-core.mjs';
import {referenceKey,sourceOwnerKey,operationFingerprint,connectedPaymentSources,referenceAlreadyUsed,untrackedDocuments} from './accounting-common.mjs';
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
        const owners=await Promise.all(connectedPaymentSources(documents.find(d=>d.docNo===orderNo)||{docNo:orderNo},documents).map(async no=>({no,id:await sourceOwnerKey(no)})));session.check();
        return api.runTransaction(api.db,async tx=>{
            const snap=await tx.get(rootRef); session.check();
            if (!snap.exists()) throw new Error('ไม่พบเอกสารต้นทาง');
            const root=snap.data();
            if(root.paymentLedger && root.paymentLedger.mode!==mode) throw new Error('เอกสารนี้ถูกเปิดด้วยวิธีออกเอกสารอื่นแล้ว กรุณาตรวจรายการล่าสุด');
            const ledger=createLedger(root,mode,dueDate,api.today(),documents);
            const ownerRefs=owners.map(o=>session.ref('settings',o.id));
            for(const ref of ownerRefs){const owner=await tx.get(ref);session.check();if(owner.exists()&&owner.data().rootNo!==orderNo)throw new Error('เอกสารอ้างอิงนี้เปิดรับเงินผ่านต้นทางอื่นแล้ว กรุณาตรวจยอด');}
            if(documents.some(d=>d.docNo!==orderNo&&d.paymentLedger&&owners.some(o=>o.no===d.docNo)))throw new Error('มีต้นทางรับเงินอื่นอ้างอิงอยู่ ต้องกระทบยอดก่อน');
            if (!root.paymentLedger) tx.update(rootRef,{paymentLedger:ledger,isRevenue:false,status:'pending',paymentUpdatedAt:api.serverTimestamp()});
            for(const ref of ownerRefs)tx.set(ref,{rootNo:orderNo,recordedBy:session.uid},{merge:true});
            return {...root,paymentLedger:ledger};
        });
    }
    async function commit(orderNo,action) {
        if(!/^[a-zA-Z0-9-]{12,80}$/.test(action.requestId||''))throw new Error('รหัสรายการไม่ถูกต้อง');
        const session=scope(), rootRef=session.ref('documents',orderNo), today=api.today();
        const fingerprint=await operationFingerprint(action);session.check();
        const documents=await api.readServerDocuments();session.check();
        const correcting=['cancel','replace'].includes(action.kind);
        const postingKind=action.kind==='replace'?action.input.replacementKind:action.kind;
        const receivingId=postingKind==='payment'?await referenceKey(action.input.reference):null;session.check();
        return api.runTransaction(api.db,async tx=>{
            const snap=await tx.get(rootRef); session.check();
            if (!snap.exists()) throw new Error('ไม่พบเอกสารต้นทาง');
            const root=snap.data(), ledger=root.paymentLedger;
            if (!ledger) throw new Error('ยังไม่ได้เปิดรับชำระหลายงวด');
            const correctionDone=(ledger.corrections||[]).find(d=>d.requestId===action.requestId);
            const done=ledger.documents.find(d=>d.requestId===action.requestId)||correctionDone;
            if (done) {
                if(done.fingerprint&&done.fingerprint!==fingerprint)throw new Error('เลขรายการถูกใช้กับข้อมูลอื่นแล้ว');
                const cancelled=[];let document=null;
                for(const no of [...new Set([done.docNo,...ledger.documents.filter(d=>d.cancellation?.requestId===action.requestId).map(d=>d.docNo)].filter(Boolean))]){
                    const saved=await tx.get(session.ref('documents',no));session.check();if(!saved.exists())throw new Error('ไม่พบเอกสารที่บันทึกแล้ว กรุณาตรวจประวัติ');
                    if(no===done.docNo)document=saved.data();else cancelled.push(saved.data());
                }
                return {replayed:true,docNo:done.docNo,root,document,documents:cancelled,corrected:!!correctionDone};
            }
            if(untrackedDocuments(root,documents,action.kind).length)throw new Error('มีใบรับเงิน ใบกำกับ หรือใบเพิ่ม/ลดหนี้เดิมที่ต้องกระทบยอดก่อน');
            if ((ledger.revision||0)!==action.expectedRevision) throw new Error('มีรายการเปลี่ยนจากอีกเครื่อง กรุณากลับไปตรวจสอบยอดล่าสุดก่อนยืนยัน');
            let cancellation=null, workingRoot=root;
            if(correcting){
                const audit={requestId:action.requestId,fingerprint,at:action.now,by:session.uid};
                const targets=action.input.targetDocNo===orderNo&&!action.input.targetRequestId
                    ?ledger.documents.filter(d=>d.docNo&&!isCancelledRecord(d)).map(d=>d.docNo):[action.input.targetDocNo].filter(Boolean).filter(no=>no!==orderNo);
                const currentDocuments=[];
                for(const no of [...new Set(targets)]){const ref=session.ref('documents',no),target=await tx.get(ref);session.check();if(!target.exists())throw new Error('ไม่พบเอกสารที่ต้องการแก้ไข');currentDocuments.push(target.data());}
                cancellation=cancelPaymentDocument(root,currentDocuments,action.input,audit);workingRoot=cancellation.root;
                if(action.kind==='replace'){
                    const expected=cancellation.entry?.kind==='invoice'?'invoice':['receipt','advance'].includes(cancellation.entry?.kind)?'payment':'';
                    if(!expected||postingKind!==expected)throw new Error('ประเภทเอกสารทดแทนไม่ตรงกับเอกสารเดิม');
                }
            }
            const released=[];
            for(const p of cancellation?.reversedPayments||[]){const id=await referenceKey(p.reference),ref=session.ref('settings',id);const snap=await tx.get(ref);session.check();if(snap.exists()&&!isCancelledRecord(snap.data())&&!(snap.data().docNos||[]).includes(p.docNo))throw new Error('เลขอ้างอิงรับเงินไม่ตรงกับเอกสารที่ยกเลิก');released.push({id,ref,data:snap.exists()?snap.data():{},payment:p});}
            let receivingRef=null;
            if(receivingId){receivingRef=session.ref('settings',receivingId);const reference=await tx.get(receivingRef);session.check();const releasing=released.some(p=>p.id===receivingId);const latest=documents.map(d=>d.docNo===orderNo?workingRoot:d);if((reference.exists()&&!isCancelledRecord(reference.data())&&!releasing)||referenceAlreadyUsed(latest,action.input.reference,action.requestId))throw new Error('เลขอ้างอิงรับเงินนี้ใช้แล้ว กรุณาตรวจรายการซ้ำ');}
            const postingAction={...action,kind:postingKind,fingerprint};
            const prefix=action.kind==='cancel'?'':operationPrefix(workingRoot,postingAction), year=(postingKind==='payment'||postingKind==='invoice'&&action.input?.date?action.input.date:today).slice(0,4);
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
            const result=action.kind==='cancel'?{ledger:workingRoot.paymentLedger,document:null,docNo:'',summary:{receivedCents:0}}:applyOperation(workingRoot,postingAction,docNo,today);
            if(cancellation){
                result.ledger.corrections.at(-1).docNo=docNo;
                if(result.document){result.document.paymentCorrection={replaces:action.input.targetDocNo,reason:action.input.reason,requestId:action.requestId};result.document.remark+='\nออกแทน '+action.input.targetDocNo+' · เหตุผล: '+action.input.reason;}
                for(const d of cancellation.documents)if(docNo)d.paymentCancellation.replacedBy=docNo;
            }
            if (bytes({...root,paymentLedger:result.ledger})>850000 || (result.document&&bytes(result.document)>900000)) throw new Error('ข้อมูลเอกสารมีขนาดใหญ่เกินไป กรุณาลดขนาดหลักฐาน');
            session.check();
            const summary=ledgerSummary({...root,paymentLedger:result.ledger});
            const rootUpdate={paymentLedger:result.ledger,isRevenue:!!result.ledger.delivered,status:workingRoot.status==='cancelled'?'cancelled':summary.balance===0?'paid':summary.paid>0?'partial':'pending',paymentUpdatedAt:api.serverTimestamp()};
            if(workingRoot.paymentCancellation)rootUpdate.paymentCancellation=workingRoot.paymentCancellation;
            tx.update(rootRef,rootUpdate);
            for(const d of cancellation?.documents||[])tx.update(session.ref('documents',d.docNo),{status:'cancelled',paymentCancellation:d.paymentCancellation,isRevenue:false,isInputTax:false,paymentUpdatedAt:api.serverTimestamp()});
            if (result.document) {
                tx.set(outRef,{...result.document,createdAt:api.serverTimestamp(),recordedBy:session.uid});
                tx.set(counterRef,{[prefix]:number},{merge:true});
            }
            for(const p of released)if(p.id!==receivingId)tx.set(p.ref,{...p.data,status:'cancelled',cancelledBy:session.uid,cancellationRequestId:action.requestId});
            if(receivingRef)tx.set(receivingRef,{requestId:action.requestId,fingerprint,rootNos:[orderNo],docNos:[docNo],reference:action.input.reference,date:action.input.date,amountCents:result.summary.receivedCents,recordedBy:session.uid});
            return {...result,corrected:correcting,documents:cancellation?.documents||[],root:{...root,...rootUpdate}};
        });
    }
    return {activate,commit};
}
