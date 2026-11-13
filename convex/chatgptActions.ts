'use node';
import {action,internalAction} from './_generated/server';
import {internal} from './_generated/api';
import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {ISSUER,RESOURCE,configuration,discovery,transaction,authorizeURL,tokenRequest,tokenSet,catalog,providerError,hash,random,seal,unseal} from '../collaboration/chatgpt/protocol.cjs';
async function requireUser(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw Error('Sign in to connect ChatGPT.');return id;}
async function loadModels(token:string){const r=await fetch(RESOURCE+'/models',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(providerError(r.status));return catalog(await r.json());}
export const start=action({args:{browserHash:v.string(),returnPath:v.optional(v.string())},handler:async(ctx,a):Promise<any>=>{
 const userId=await requireUser(ctx),config=configuration(),doc=await discovery(),tx=transaction(config,a.browserHash,a.returnPath);
 await ctx.runMutation(internal.chatgpt.begin,{userId,stateHash:hash(tx.state),browserHash:a.browserHash,ciphertext:seal(tx,config.secret),expiresAt:tx.expiresAt});return {url:authorizeURL(config,doc,tx)};
}});
export const finish=action({args:{state:v.string(),browserSecret:v.string(),code:v.optional(v.string()),error:v.optional(v.string())},handler:async(ctx,a):Promise<any>=>{
 if(a.state.length>512||a.browserSecret.length>512||a.code&&a.code.length>8192)throw Error('Invalid sign-in');
 const config=configuration(),row=await ctx.runMutation(internal.chatgpt.consume,{stateHash:hash(a.state),browserHash:hash(a.browserSecret)}),tx=unseal(row.ciphertext,config.secret);
 if(a.error||!a.code)throw Error('ChatGPT connection was not approved. You can try again.');
 if(tx.clientId!==config.clientId||tx.redirectUri!==config.redirectUri)throw Error('Connection settings changed. Try again.');
 const doc=await discovery(),response=await fetch(doc.token_endpoint,tokenRequest(config,{grant_type:'authorization_code',code:a.code,code_verifier:tx.verifier,redirect_uri:tx.redirectUri,resource:RESOURCE}));
 if(!response.ok)throw Error('ChatGPT sign-in could not finish. Try connecting again.');
 const data=await response.json();if(typeof data.id_token!=='string')throw Error('ChatGPT identity was not verified');
 const {payload}=await jwtVerify(data.id_token,createRemoteJWKSet(new URL(doc.jwks_uri)),{issuer:ISSUER,audience:config.clientId,requiredClaims:['sub','exp','iat'],clockTolerance:5});
 if(payload.nonce!==tx.nonce||!payload.sub)throw Error('ChatGPT identity was not verified');
 const tokens=tokenSet(data),models=await loadModels(tokens.accessToken);
 if(!models.length)throw Error('No models are available for this ChatGPT plan.');
 await ctx.runMutation(internal.chatgpt.connect,{transactionId:row._id,userId:row.userId,connectionId:row.connectionId,ciphertext:seal(tokens,config.secret),subject:payload.sub,clientId:config.clientId,label:typeof payload.email==='string'?payload.email:typeof payload.name==='string'?payload.name:'ChatGPT account',models,expiresAt:tokens.expiresAt});
 return {returnPath:tx.returnPath};
}});
async function credentials(ctx:any,userId:any,connectionId?:any):Promise<any>{
 const config=configuration();
 for(let attempt=0;attempt<80;attempt++){
 const row=await ctx.runQuery(internal.chatgpt.get,{userId});if(!row||connectionId&&row._id!==connectionId)throw Error('Your ChatGPT connection changed. Send again or reconnect in AI settings.');
 if(row.clientId!==config.clientId)throw Error('Reconnect ChatGPT in AI settings.');
 const tokens=unseal(row.ciphertext,config.secret);if(tokens.expiresAt>Date.now()+60000)return {row,tokens};
 const lease=random();if(!await ctx.runMutation(internal.chatgpt.lock,{id:row._id,revision:row.revision,lease})){await new Promise(r=>setTimeout(r,200));continue;}
 try{
 if(!tokens.refreshToken)throw Error('Reconnect ChatGPT in AI settings.');
 const doc=await discovery(),r=await fetch(doc.token_endpoint,tokenRequest(config,{grant_type:'refresh_token',refresh_token:tokens.refreshToken,resource:RESOURCE}));if(!r.ok)throw Error('Your ChatGPT session needs a new sign-in. Reconnect in AI settings.');
 const renewed=tokenSet(await r.json(),tokens);await ctx.runMutation(internal.chatgpt.renewed,{id:row._id,lease,ciphertext:seal(renewed,config.secret),expiresAt:renewed.expiresAt});return {row,tokens:renewed};
 }finally{await ctx.runMutation(internal.chatgpt.unlock,{id:row._id,lease});}
 }throw Error('ChatGPT is reconnecting. Please try again shortly.');
}
export const refreshModels=action({args:{},handler:async(ctx):Promise<void>=>{const userId=await requireUser(ctx),{row,tokens}=await credentials(ctx,userId);await ctx.runMutation(internal.chatgpt.setModels,{id:row._id,models:await loadModels(tokens.accessToken)});}});
export const disconnect=action({args:{},handler:async(ctx):Promise<any>=>{
 const userId=await requireUser(ctx),row=await ctx.runMutation(internal.chatgpt.remove,{userId});if(!row)return {revoked:true};
 try{const config=configuration(),tokens=unseal(row.ciphertext,config.secret);if(!tokens.refreshToken)return {revoked:true};const doc=await discovery();if(!doc.revocation_endpoint)throw Error();const r=await fetch(doc.revocation_endpoint,tokenRequest(config,{token:tokens.refreshToken,token_type_hint:'refresh_token'}));return {revoked:r.ok};}catch{return {revoked:false};}
}});
export const resolve=internalAction({args:{userId:v.id('users'),connectionId:v.id('chatgptConnections'),model:v.string()},handler:async(ctx,a):Promise<any>=>{const {row,tokens}=await credentials(ctx,a.userId,a.connectionId);if(!row.models.some((m:any)=>m.slug===a.model))throw Error('This model is no longer available. Choose another model in AI settings.');return {token:tokens.accessToken,model:a.model,provider:'chatgpt'};}});
export const forServer=action({args:{boardId:v.id('boards'),token:v.string(),secret:v.string()},handler:async(ctx,a):Promise<any>=>{
 if(!process.env.CHATGPT_ENCRYPTION_KEY||a.secret!==process.env.CHATGPT_ENCRYPTION_KEY)throw Error('Server access denied');
 const userId=await ctx.runQuery(internal.chatgpt.authorizeBoard,{boardId:a.boardId,token:a.token}),row=await ctx.runQuery(internal.chatgpt.get,{userId});
 if(!row)return null;return ctx.runAction(internal.chatgptActions.resolve,{userId,connectionId:row._id,model:row.selectedModel});
}});
