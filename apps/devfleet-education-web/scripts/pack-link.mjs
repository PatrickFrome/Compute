// Deterministic ZIP of reviewed extension files only; no profiles or credentials.
import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),names=['manifest.json','engine.mjs','worker.mjs','content.js','README.txt'];
function crc32(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
const bodies=[],central=[];let offset=0;
for(const name of names){const b=await fs.readFile(path.join(root,'browser-link',name)),n=Buffer.from(name),crc=crc32(b);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);bodies.push(h,n,b);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x0800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+b.length;}
const tail=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(tail.length,12);end.writeUInt32LE(offset,16);
await fs.mkdir(path.join(root,'public/downloads'),{recursive:true});await fs.writeFile(path.join(root,'public/downloads/education-chat-link.zip'),Buffer.concat([...bodies,tail,end]));console.log('Extension ZIP: 5 reviewed files');
