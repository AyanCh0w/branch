import { createAvatar } from '@blobz/avatar-core';
const cache=new Map();
export function avatarURL(name='Member',color='#6685cf') {
 color=/^#[0-9a-f]{6}$/i.test(color)?color:'#6685cf';
 const key=JSON.stringify([name,color]);if(cache.has(key))return cache.get(key);
 const {svg}=createAvatar({name:name||'Member',palette:['#f1f3f6',color],frame:'rounded'});
 const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
 if(cache.size>300)cache.clear();cache.set(key,url);return url;
}
