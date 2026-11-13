'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {encrypt,decrypt}=require('../workspace-key.cjs');
const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const hash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
function configuration(env=process.env){
 const clientId=env.CHATGPT_CLIENT_ID,redirectUri=env.CHATGPT_REDIRECT_URI,secret=env.CHATGPT_ENCRYPTION_KEY;
 if(env.CHATGPT_HOSTED_APPROVED!=='true'||!clientId||!redirectUri||!/^oaiapp_[\w-]+$/.test(clientId||'')||!secret||!/^[a-f\d]{64}$/i.test(secret))throw Error('ChatGPT connection is not available yet. Use Branch default for now.');
 const url=new URL(redirectUri);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Invalid ChatGPT callback configuration');
 const method=env.CHATGPT_TOKEN_AUTH_METHOD||'none';if(!['none','client_secret_basic'].includes(method)||method==='client_secret_basic'&&!env.CHATGPT_CLIENT_SECRET)throw Error('Invalid ChatGPT client configuration');
 return {clientId,redirectUri,secret,method,clientSecret:env.CHATGPT_CLIENT_SECRET};
}
async function discovery(fetchImpl=fetch){const r=await fetchImpl(ISSUER+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('ChatGPT sign-in is unavailable. Try again.');const d=await r.json();if(d.issuer!==ISSUER)throw Error('Invalid ChatGPT issuer');for(const k of ['authorization_endpoint','token_endpoint','jwks_uri','revocation_endpoint'])if(d[k]&&new URL(d[k]).origin!==ISSUER)throw Error('Invalid ChatGPT endpoint');if(!d.authorization_endpoint||!d.token_endpoint||!d.jwks_uri)throw Error('Incomplete ChatGPT configuration');return d;}
function transaction(config,browserHash,returnPath='/app'){
 if(!/^[a-f\d]{64}$/.test(browserHash))throw Error('Invalid browser session');
 if(!/^\/app(?:\?[^#]*)?$/.test(returnPath)||returnPath.length>1000)returnPath='/app';
 const state=random(),verifier=random(),nonce=random();return {state,verifier,nonce,browserHash,returnPath,clientId:config.clientId,redirectUri:config.redirectUri,expiresAt:Date.now()+600000};
}
function authorizeURL(config,doc,tx){const url=new URL(doc.authorization_endpoint);url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:tx.redirectUri,response_type:'code',scope:SCOPES,resource:RESOURCE,state:tx.state,nonce:tx.nonce,code_challenge:hashChallenge(tx.verifier),code_challenge_method:'S256'}).toString();return url.href;}
const hashChallenge=value=>createHash('sha256').update(value).digest('base64url');
function tokenRequest(config,fields){const headers={'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'};if(config.method==='client_secret_basic'){const enc=v=>new URLSearchParams({v}).toString().slice(2);headers.Authorization='Basic '+Buffer.from(enc(config.clientId)+':'+enc(config.clientSecret)).toString('base64');}return {method:'POST',headers,body:new URLSearchParams({client_id:config.clientId,...fields}),signal:AbortSignal.timeout(15000)};}
function tokenSet(data,previous){
 const scopes=typeof data.scope==='string'?data.scope.split(/\s+/):previous?.scopes||[];
 if(!scopes.includes('chatgpt.tokens.use.direct')||!scopes.includes('resource.invoke'))throw Error('ChatGPT plan access was not granted. Reconnect and enable plan usage.');
 if(typeof data.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw Error('Invalid ChatGPT token response');
 return {accessToken:data.access_token,refreshToken:data.refresh_token||previous?.refreshToken||null,scopes,expiresAt:Date.now()+data.expires_in*1000};
}
function catalog(data){if(!Array.isArray(data.models))throw Error('ChatGPT models could not be loaded.');return data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&typeof m.display_name==='string').map(m=>({slug:m.slug,name:m.display_name}));}
const {planRequest,providerError}=require('./requests.cjs');
const seal=(value,secret)=>encrypt(JSON.stringify(value),secret);
const unseal=(value,secret)=>{try{return JSON.parse(decrypt(value,secret));}catch{throw Error('ChatGPT connection could not be unlocked. Reconnect in AI settings.');}};
module.exports={ISSUER,RESOURCE,configuration,discovery,transaction,authorizeURL,tokenRequest,tokenSet,catalog,planRequest,providerError,hash,random,seal,unseal};
