import fs from 'node:fs/promises';
import path from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const fail = () => { throw new Error('github_chat_journal_unverified'); };

export async function assertPhysicalDirectory(directory) {
  if (!path.isAbsolute(directory || '') || /^(?:\\\\|\/\/)/.test(directory)) fail();
  let current = path.parse(directory).root;
  for (const part of path.relative(current,directory).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail();
  }
  return fs.realpath(directory);
}

export async function readPrivateRelayFile(filename, maxBytes = 64 * 1024) {
  await assertPhysicalDirectory(path.dirname(filename));
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>maxBytes
      || (process.platform!=='win32' && (before.mode & 0o077)!==0)) fail();
  const bytes = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  if (before.ino!==after.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs || bytes.length!==before.size) fail();
  return bytes;
}

// This journal is a delivery fence, never a task store or lease authority.
// PostgreSQL remains the owner of admitted goals, commands, leases and receipts.
// Claim is flushed BEFORE admission. A claim without an outcome after a crash
// produces AMBIGUOUS_NO_RETRY; lookup/progress, not another dispatch, reconciles it.
export class GithubChatRelayJournal {
  #directory;
  constructor(directory) { this.#directory=directory; }
  async initialize() {
    await assertPhysicalDirectory(path.dirname(this.#directory));
    await fs.mkdir(this.#directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    this.#directory=await assertPhysicalDirectory(this.#directory);
    return this;
  }
  #file(requestId,suffix) {
    if (!uuid.test(requestId||'')) fail();
    return path.join(this.#directory,`${requestId}.${suffix}.json`);
  }
  async #write(filename,value) {
    await assertPhysicalDirectory(this.#directory);
    const handle=await fs.open(filename,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync(); }
    finally { await handle.close(); }
  }
  async #read(filename) {
    try { return JSON.parse((await readPrivateRelayFile(filename,2*1024*1024)).toString('utf8')); }
    catch(error) { if(error.code==='ENOENT')return null;throw error; }
  }
  async claim(requestId,bodySha256) {
    if (!sha.test(bodySha256||'')) fail();
    const value={schema:'metaengine.github-chat-delivery-claim.v1',request_id:requestId,body_sha256:bodySha256};
    try { await this.#write(this.#file(requestId,'claim'),value);return {claimed:true,outcome:null}; }
    catch(error) { if(error.code!=='EEXIST')throw error; }
    const existing=await this.#read(this.#file(requestId,'claim'));
    if (!existing || JSON.stringify(existing)!==JSON.stringify(value)) fail();
    const outcome=await this.#read(this.#file(requestId,'outcome'));
    if (outcome && (outcome.request_id!==requestId || outcome.body_sha256!==bodySha256)) fail();
    return {claimed:false,outcome:outcome?.result??null};
  }
  async complete(requestId,bodySha256,result) {
    const value={schema:'metaengine.github-chat-delivery-outcome.v1',request_id:requestId,body_sha256:bodySha256,result};
    if (Buffer.byteLength(JSON.stringify(value))>2*1024*1024) fail();
    await this.#write(this.#file(requestId,'outcome'),value);
  }
  async revoked(relayId) { return !!await this.#read(this.#file(relayId,'revoked')); }
  async revoke(relayId) {
    await this.#write(this.#file(relayId,'revoked'),{schema:'metaengine.github-chat-revocation.v1',relay_id:relayId})
      .catch(error=>{if(error.code!=='EEXIST')throw error;});
  }
}
