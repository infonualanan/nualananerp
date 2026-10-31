export const normalizeReference=value=>String(value||'').normalize('NFKC').trim().toUpperCase();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export async function digest(value){
 const data=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(canonical(value)));
 const hash=await crypto.subtle.digest('SHA-256',data);
 return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export const referenceKey=async reference=>'receipt-reference-'+await digest(normalizeReference(reference));
export const sourceOwnerKey=async docNo=>'receivable-owner-'+await digest(String(docNo));
export const operationFingerprint=action=>digest({kind:action.kind,input:action.input||{},issuer:action.issuer||null,proof:action.proof||null});
export const documentRefs=d=>String(d.refDocManual||'').split(',').map(x=>x.trim()).filter(Boolean);
export function connectedPaymentSources(root,documents){
 const candidates=documents.filter(d=>['SO','INV'].includes(d.prefix)&&!d.paymentManaged&&!d.billingManaged),known=new Set(candidates.map(d=>d.docNo)),graph=new Map(),ids=new Set([root.docNo]),queue=[root.docNo];known.add(root.docNo);
 for(const d of candidates)for(const id of documentRefs(d))if(known.has(id)){if(!graph.has(d.docNo))graph.set(d.docNo,new Set());if(!graph.has(id))graph.set(id,new Set());graph.get(d.docNo).add(id);graph.get(id).add(d.docNo);}
 for(let n=0;n<queue.length;n++)for(const id of graph.get(queue[n])||[])if(!ids.has(id)){ids.add(id);queue.push(id);}
 return [...ids].sort();
}
export function untrackedDocuments(root,documents,kind='payment'){
 const ids=new Set([root.docNo,...(root.paymentLedger?.documents||[]).map(d=>d.docNo).filter(Boolean)]);
 const extra=connectedPaymentSources(root,documents);extra.forEach(id=>ids.add(id));
 return documents.filter(d=>!d.paymentManaged&&!d.billingManaged&&d.docNo!==root.docNo&&documentRefs(d).some(id=>ids.has(id))&&
  (['RE','RV','RETAX','TINV','ABB','CI','EVAT','CN','DN'].includes(d.prefix)||(d.prefix==='DO'&&kind!=='delivery'&&!root.paymentLedger?.delivered)));
}
export function referenceAlreadyUsed(documents,reference,requestId=''){
 const key=normalizeReference(reference);
 return documents.filter(d=>d.paymentLedger).some(d=>(d.paymentLedger.payments||[]).some(p=>normalizeReference(p.reference)===key&&p.id!==requestId));
}
