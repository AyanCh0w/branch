const {test}=require('node:test');
const assert=require('node:assert/strict');
const {videoId,httpsURL}=require('../media.js');
test('recognizes supported YouTube link formats',()=>{
 for(const url of ['https://www.youtube.com/watch?v=M7lc1UVf-VE&t=5','https://youtu.be/M7lc1UVf-VE','https://m.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube-nocookie.com/embed/M7lc1UVf-VE','https://youtube.com/live/M7lc1UVf-VE']) assert.equal(videoId(url),'M7lc1UVf-VE');
});
test('rejects deceptive hosts, unsupported protocols and invalid IDs',()=>{
 for(const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://youtube.com@evil.test/watch?v=M7lc1UVf-VE','javascript://youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com/watch?v=short','not a url']) assert.equal(videoId(url),null);
});
test('source links accept only HTTPS',()=>{
 assert.equal(httpsURL('https://commons.wikimedia.org/wiki/File:Example.jpg'),'https://commons.wikimedia.org/wiki/File:Example.jpg');
 for(const url of ['javascript:alert(1)','data:text/html,test','http://example.com','/relative']) assert.equal(httpsURL(url),null);
});
