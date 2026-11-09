const {test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../server/public-firebase-config.mjs');
// Synthetic browser settings only. No production SDK settings or business data in fixtures.
const web={apiKey:'test-web-config',authDomain:'test.invalid',projectId:'test-project',appId:'test-app',measurementId:'test-measurement'};
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return v}};}
test('public config endpoint returns only valid browser SDK settings without caching',async()=>{
 const {createPublicFirebaseConfigHandler}=await modulePromise,res=response();
 createPublicFirebaseConfigHandler(()=>JSON.stringify(web))({method:'GET'},res);
 assert.equal(res.code,200);assert.deepEqual(res.body,{firebaseConfig:web});assert.equal(res.headers['Cache-Control'],'no-store');
});
test('missing, malformed and admin configuration never reaches a browser response',async()=>{
 const {createPublicFirebaseConfigHandler}=await modulePromise;
 for(const value of [undefined,'bad json','[]','null',JSON.stringify({projectId:'test'}),JSON.stringify({...web,private_key:'test-secret-must-not-leak'}),JSON.stringify({...web,apiKey:17})]){
  const res=response();createPublicFirebaseConfigHandler(()=>value)({method:'GET'},res);
  assert.equal(res.code,503);assert.deepEqual(res.body,{error:'firebase_configuration_unavailable'});assert.doesNotMatch(JSON.stringify(res.body),/test-secret|apiKey/);
 }
});
test('public configuration endpoint is read-only and does not read config on other methods',async()=>{
 const {createPublicFirebaseConfigHandler}=await modulePromise;let reads=0;
 const handler=createPublicFirebaseConfigHandler(()=>{reads++;return JSON.stringify(web)});
 for(const method of ['POST','PUT','DELETE']){const res=response();handler({method},res);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET');}
 assert.equal(reads,0);
});
