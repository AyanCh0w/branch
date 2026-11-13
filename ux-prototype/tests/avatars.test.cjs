const {test}=require('node:test');
const assert=require('node:assert/strict');
test('Blobz avatars repeat for the same name and color and change with identity',async()=>{
 const {createAvatar}=await import('@blobz/avatar-core');
 const options={name:'Sam',palette:['#f1f3f6','#6685cf'],frame:'rounded'};
 const first=createAvatar(options).svg;
 assert.equal(first,createAvatar(options).svg);
 assert.notEqual(first,createAvatar({...options,name:'Alex'}).svg);
 assert.notEqual(first,createAvatar({...options,palette:['#f1f3f6','#dd7733']}).svg);
 assert.match(first,/<svg/);
});
