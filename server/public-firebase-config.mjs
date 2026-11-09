// Only Firebase browser SDK fields may leave this endpoint. No business records or admin keys.
const allowed=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId','measurementId'];
const required=['apiKey','authDomain','projectId','appId'];
export function publicFirebaseConfig(value){
 const raw=JSON.parse(value||'null');
 if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.keys(raw).some(key=>!allowed.includes(key)))throw new Error('Invalid Firebase web configuration');
 if(required.some(key=>typeof raw[key]!=='string'||!raw[key].trim()))throw new Error('Missing Firebase web configuration');
 if(Object.values(raw).some(v=>typeof v!=='string'||v.length>500))throw new Error('Invalid Firebase web configuration');
 return Object.fromEntries(allowed.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]]));
}
export function createPublicFirebaseConfigHandler(getConfig=()=>process.env.ERP_FIREBASE_WEB_CONFIG){
 return function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'});}
  try{return res.status(200).json({firebaseConfig:publicFirebaseConfig(getConfig())});}
  catch{return res.status(503).json({error:'firebase_configuration_unavailable'});}
 };
}
