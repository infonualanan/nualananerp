const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const modules=Promise.all([import('../server/vault-file.mjs'),import('../server/document-reader.mjs'),import('../file-limits.mjs')]);
const pdf=size=>{const b=Buffer.alloc(size,32);b.write('%PDF-1.7\n');return b;};
const hash=b=>createHash('sha256').update(b).digest('hex');
const string=x=>({stringValue:x}),int=x=>({integerValue:String(x)});
function response(fields,status=200){return {ok:status===200,status,json:async()=>({fields})};}
async function loaderFixture(bytes=pdf(10000000),change={}){
 const [loader,,limits]=await modules,id=hash(bytes);let calls=0,active=0,maxActive=0;
 const f=loader.createVaultFileLoader({fetchImpl:async(url,options)=>{
  calls++;assert.equal(options.headers.Authorization,'Bearer firebase-id-token');assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/nualananerp-1/databases/(default)/documents/artifacts/default-app-id/users/owner/'));active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setImmediate(r));active--;
  if(url.includes('/accounting_vault/'))return response({source:{mapValue:{fields:{mimeType:string('application/pdf'),filename:string('large.pdf'),hash:string(id),size:int(bytes.length),chunks:int(Math.ceil(bytes.length/limits.FILE_CHUNK_BYTES)),...change.manifest}}}});
  const index=Number(new URL(url).pathname.split('_').at(-1)),part=bytes.subarray(index*limits.FILE_CHUNK_BYTES,(index+1)*limits.FILE_CHUNK_BYTES);
  return change.chunk?change.chunk(index,part,id):response({fileId:string(id),index:int(index),bytes:{bytesValue:part.toString('base64')}});
 }});
 return {load:()=>f({uid:'owner',token:'firebase-id-token',fileId:id}),f,id,get calls(){return calls;},get maxActive(){return maxActive;}};
}
test('PDF limit is exactly 10 MB while image limit and source signature stay enforced',async()=>{const [,,l]=await modules;assert.equal(l.fileLimit('application/pdf'),10000000);assert.equal(l.fileLimit('image/png'),2500000);assert.equal(l.fileLimit('text/html'),0);assert.ok(l.matchesFileType(pdf(10),'application/pdf'));assert.equal(l.matchesFileType(pdf(10),'image/png'),false);});
test('server restores a complete 10 MB original with at most four parallel private chunk reads',async()=>{const bytes=pdf(10000000),f=await loaderFixture(bytes),file=await f.load();assert.equal(file.mimeType,'application/pdf');assert.equal(file.filename,'large.pdf');assert.equal(Buffer.from(file.data,'base64').length,10000000);assert.equal(hash(Buffer.from(file.data,'base64')),f.id);assert.equal(f.calls,24);assert.ok(f.maxActive<=4);});
test('oversized, incomplete, tampered and mislabelled originals never become readable PDF inputs',async()=>{
 for(const change of [{manifest:{size:int(10000001)}},{manifest:{chunks:int(24)}},{manifest:{mimeType:string('image/png')}},{chunk:(i,part,id)=>response({fileId:string(id),index:int(i),bytes:{bytesValue:(i?part:Buffer.alloc(part.length)).toString('base64')}})},{chunk:(i,part,id)=>response({fileId:string(id),index:int(i+1),bytes:{bytesValue:part.toString('base64')}})}]){const f=await loaderFixture(pdf(3000000),change);await assert.rejects(f.load());}
});
test('file references cannot select another account path, URL or source collection',async()=>{const f=await loaderFixture(pdf(100));for(const input of [{uid:'../other',fileId:f.id},{uid:'owner',fileId:'https://evil.example/doc.pdf'},{uid:'owner',fileId:'a/../../b'}])await assert.rejects(f.f({...input,token:'firebase-id-token'}));assert.equal(f.calls,0);});
test('10 MB PDF travels through the API as a short reference and an idempotent retry never reads or bills twice',async()=>{
 const [,{createDocumentReader,extractionSchema}]=await modules,bytes=pdf(10000000),id=hash(bytes);let reads=0,bills=0;
 const extraction=Object.fromEntries(extractionSchema.required.map(k=>[k,k==='readable'?true:k==='items'||k==='warnings'?[]:null]));extraction.grandTotal='7088.75';
 const handler=createDocumentReader({verifyToken:async()=>({uid:'owner'}),allowedUids:()=>['owner'],getGatewayToken:async()=> 'private-oidc',loadVaultFile:async input=>{reads++;assert.deepEqual(input,{uid:'owner',token:'firebase.token',fileId:id});return {mimeType:'application/pdf',filename:'10mb.pdf',data:bytes.toString('base64')};},fetchImpl:async(url,options)=>{bills++;const sent=JSON.parse(options.body).input[1].content[1];assert.equal(sent.type,'input_file');assert.equal(Buffer.from(sent.file_data.split(',')[1],'base64').length,10000000);return {ok:true,json:async()=>({output_text:JSON.stringify(extraction)})};}});
 const body={fileId:id,requestId:'large-pdf-request-001',uid:'another-account'};assert.ok(JSON.stringify(body).length<300);
 async function request(input=body){let status,out;await handler({method:'POST',headers:{authorization:'Bearer firebase.token'},body:input},{setHeader(){},status(n){status=n;return this;},json(x){out=x;}});return {status,out};}
 const a=await request(),b=await request();assert.equal(a.status,200);assert.equal(a.out.fileHash,id);assert.deepEqual(a,b);assert.equal(reads,1);assert.equal(bills,1);
 const changed=await request({...body,fileId:'a'.repeat(64)});assert.equal(changed.status,409);assert.equal(reads,1);
});
test('a referenced PDF over 10 MB and a reference with inline data cannot reach AI',async()=>{
 const [,{createDocumentReader}]=await modules,bytes=pdf(10000001);let bills=0;
 const handler=createDocumentReader({verifyToken:async()=>({uid:'owner'}),allowedUids:()=>['owner'],getGatewayToken:async()=> 'oidc',loadVaultFile:async()=>({mimeType:'application/pdf',filename:'too-large.pdf',data:bytes.toString('base64')}),fetchImpl:async()=>{bills++;}});
 for(const body of [{fileId:hash(bytes),requestId:'too-large-reference-001'},{fileId:hash(bytes),requestId:'ambiguous-reference-001',data:'extra'}]){let status;await handler({method:'POST',headers:{authorization:'Bearer firebase.token'},body},{setHeader(){},status(n){status=n;return this;},json(){}});assert.ok([400,413].includes(status));}assert.equal(bills,0);
});
