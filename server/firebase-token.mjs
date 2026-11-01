import {createRemoteJWKSet,decodeProtectedHeader,jwtVerify} from 'jose';

const PROJECT_ID='nualananerp-1';
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),{timeoutDuration:10000,cacheMaxAge:3600000,cooldownDuration:30000});

// Firebase ID-token constraints: signature, RS256/kid, project, expiry and past auth/issue times.
export function createFirebaseVerifier(keys=googleKeys,clock=()=>Date.now()){
 return async token=>{
  const header=decodeProtectedHeader(token);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>200)throw new Error('Invalid Firebase token header');
  const now=Math.floor(clock()/1000),{payload}=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:'https://securetoken.google.com/'+PROJECT_ID,audience:PROJECT_ID,requiredClaims:['exp','iat','sub','auth_time'],currentDate:new Date(now*1000)});
  if(payload.aud!==PROJECT_ID||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||!Number.isFinite(payload.iat)||payload.iat>now||payload.iat<0||!Number.isFinite(payload.auth_time)||payload.auth_time>now||payload.auth_time<0)throw new Error('Invalid Firebase token claims');
  return {uid:payload.sub};
 };
}
export const verifyFirebaseToken=createFirebaseVerifier();
