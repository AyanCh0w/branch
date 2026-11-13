const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
function master(value){if(!/^[a-f0-9]{64}$/i.test(value||''))throw Error('Workspace key storage is not configured.');return Buffer.from(value,'hex');}
function encrypt(key,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master(secret),iv);return [iv.toString('base64'),Buffer.concat([cipher.update(key,'utf8'),cipher.final()]).toString('base64'),cipher.getAuthTag().toString('base64')].join('.');}
function decrypt(value,secret){try{const [iv,data,tag]=value.split('.');const cipher=createDecipheriv('aes-256-gcm',master(secret),Buffer.from(iv,'base64'));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8');}catch{throw Error('Could not unlock the workspace API key.');}}
module.exports={encrypt,decrypt};
