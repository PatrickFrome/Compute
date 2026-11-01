import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {Duplex} from 'node:stream';
import {createHash,createHmac,timingSafeEqual,randomBytes,randomUUID} from 'node:crypto';
// Actual source with ONLY in-memory net. Opens no OS endpoint; not socket proof.
export async function inMemoryNativeBroker(t){
 let server;const connections=new Set();
 class Endpoint extends Duplex{
  _read(){} _write(bytes,_encoding,done){this.peer.push(Buffer.from(bytes));done();}
  _destroy(error,done){if(this.peer&&!this.peer.destroyed)this.peer.destroy();connections.delete(this);done(error);}
 }
 const net={createServer(handler){server=new EventEmitter();server.listen=(_endpoint,done)=>queueMicrotask(done);server.close=done=>queueMicrotask(done);
   server.on('connection',handler);return server;},createConnection(){const client=new Endpoint(),remote=new Endpoint();client.peer=remote;remote.peer=client;
   connections.add(client);connections.add(remote);queueMicrotask(()=>server.emit('connection',remote));return client;}};
 const source=await fs.readFile(new URL('../../src/native-coding-agent-mcp-broker.mjs',import.meta.url),'utf8');
 const exports=new Function('net','createHash','createHmac','timingSafeEqual','randomBytes','randomUUID',source.replace(/^import .*;\r?\n/gm,'').replace(/export /g,'')+
  '\nreturn {createNativeCodingAgentMcpBroker,connectNativeCodingAgentMcpBroker};')(net,createHash,createHmac,timingSafeEqual,randomBytes,randomUUID);
 t.after(()=>{for(const endpoint of connections)endpoint.destroy();});return exports;
}
