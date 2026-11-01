import {getVercelOidcToken} from '@vercel/oidc';
import {readFile} from 'node:fs/promises';
import {createDocumentReader} from '../server/document-reader.mjs';
import {verifyFirebaseToken} from '../server/firebase-token.mjs';
export default createDocumentReader({
 verifyToken:verifyFirebaseToken,
 getGatewayToken:()=>getVercelOidcToken(),
 allowedUids:()=>String(process.env.OCR_ALLOWED_UIDS||'').split(',').map(x=>x.trim()).filter(Boolean),
 model:process.env.OCR_MODEL||'openai/gpt-4.1-mini',
 sampleFile:async()=>({mimeType:'image/png',filename:'connection-test.png',data:(await readFile(new URL('../assets/ocr-connection-test.png',import.meta.url))).toString('base64')})
});
