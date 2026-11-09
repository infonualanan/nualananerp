import {getVercelOidcToken} from '@vercel/oidc';
import {verifyFirebaseToken} from '../server/firebase-token.mjs';
import {createCustomerReader} from '../server/customer-reader.mjs';
export default createCustomerReader({verifyToken:verifyFirebaseToken,getGatewayToken:()=>getVercelOidcToken(),allowedUids:()=>String(process.env.OCR_ALLOWED_UIDS||'').split(',').map(v=>v.trim()).filter(Boolean),model:process.env.OCR_MODEL||'openai/gpt-4.1-mini'});
