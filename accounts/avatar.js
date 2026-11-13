import { createAvatar } from '@blobz/avatar-core';
const cache=new Map();
export function avatarURL(name='Member',color='#6685cf',transparent=false) {
 color=/^#[0-9a-f]{6}$/i.test(color)?color:'#6685cf';
 const key=JSON.stringify([name,color,transparent]);if(cache.has(key))return cache.get(key);
 const {svg}=createAvatar({name:name||'Member',palette:[transparent?'transparent':'#f1f3f6',color],frame:'rounded'});
 // Blobz enlarges the figure inside a clipped 80px frame. Leave room for
 // tilted bodies and their highlights so the artwork stays inside the frame.
 const framedSvg=svg.replace(/(translate\(40 42\) rotate\([^)]*\) )scale\(1\.15\)/, '$1scale(0.95)');
 const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(framedSvg);
 if(cache.size>300)cache.clear();cache.set(key,url);return url;
}
