import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SOURCE_PATCH_SCHEMA='metaengine.devfleet.source-patch.v1';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const shaRe=/^[a-f0-9]{64}$/;
const reqRe=/^[A-Za-z0-9._:-]{12,100}$/;
const maxFile=262144;
const clone=x=>JSON.parse(JSON.stringify(x));
function checkedPath(relative) {
  if(typeof relative!=='string'||relative.length>160||
    !/^(?:src|test|scripts)\/[A-Za-z0-9._/-]+\.(?:mjs|js|cjs|html|json)$/.test(relative) ||
    relative.split('/').some(s=>s==='.'||s==='..'||s==='') ||
    /(?:secret|credential|token|private-key|operator-state)/i.test(relative))
    throw Error('source_patch_path_denied');
  return relative;
}
export class DevFleetSourceWorkspace {
  #getRoot;
  #busy=false;
  constructor({getWorkspace}) {
    if(typeof getWorkspace!=='function')throw Error('source_patch_workspace_required');
    this.#getRoot=getWorkspace;
  }
  async #resolve(relative) {
    const sub=checkedPath(relative);
    const workspace=this.#getRoot();
    if(typeof workspace!=='string'||!path.isAbsolute(workspace))
      throw Error('source_patch_workspace_unpinned');
    const root=await fs.realpath(workspace);
    if(root!==path.resolve(workspace)) throw Error('source_patch_workspace_alias_denied');
    const folder=path.dirname(path.join(root,...sub.split('/')));
    if(await fs.realpath(folder)!==folder)throw Error('source_patch_link_denied');
    const target=path.join(root,...sub.split('/'));
    const st=await fs.lstat(target);
    if(!st.isFile()||st.isSymbolicLink()||st.size>maxFile)
      throw Error('source_patch_target_denied');
    return {root,target,relative:sub};
  }
  async inspect({path:relative}) {
    const p=await this.#resolve(relative);
    const bytes=await fs.readFile(p.target);
    if(bytes.byteLength>maxFile)throw Error('source_patch_size_exceeded');
    return {schema:SOURCE_PATCH_SCHEMA,path:p.relative,sha256:sha(bytes),
      content:bytes.toString('utf8'),bytes:bytes.byteLength,
      live_runtime_reloaded:false,authority_effect:false};
  }
  async #ledger(root) {
    const ledger=path.join(root,'.devfleet-source-patches');
    await fs.mkdir(ledger,{recursive:true,mode:0o700});
    const current=path.join(ledger,'state.json');
    let raw;
    try{raw=JSON.parse(await fs.readFile(current,'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;raw={schema:SOURCE_PATCH_SCHEMA,pending:null,history:[]};}
    if(raw.schema!==SOURCE_PATCH_SCHEMA||!Array.isArray(raw.history)||raw.history.length>128)
      throw Error('source_patch_ledger_invalid');
    return {raw,current};
  }
  async #save(file,value) {
    const tmp=file+'.tmp-'+crypto.randomUUID();
    await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    try{await fs.rename(tmp,file);}catch(e){await fs.rm(tmp,{force:true});throw e;}
  }
  async status() {
    const workspace=this.#getRoot();
    if(!workspace)return {schema:SOURCE_PATCH_SCHEMA,workspace_attached:false,
      state:'UNAVAILABLE',authority_effect:false};
    const root=await fs.realpath(workspace);
    const {raw}=await this.#ledger(root);
    return {schema:SOURCE_PATCH_SCHEMA,workspace_attached:true,
      state:raw.pending?'RECONCILIATION_REQUIRED':'READY',
      pending:raw.pending?{request_id:raw.pending.request_id,
        path:raw.pending.path,before_sha256:raw.pending.before_sha256,
        after_sha256:raw.pending.after_sha256}:null,
      recent:raw.history.slice(-8),live_runtime_reloaded:false,authority_effect:false};
  }
  async patch({request_id,path:relative,expected_sha256,content}) {
    if(!reqRe.test(request_id)||!shaRe.test(expected_sha256)||
      typeof content!=='string'||Buffer.byteLength(content,'utf8')>maxFile||
      content.includes('\u0000'))throw Error('source_patch_parameters_invalid');
    if(this.#busy)throw Error('source_patch_busy');
    this.#busy=true;
    try {
      const p=await this.#resolve(relative);
      const {raw,current}=await this.#ledger(p.root);
      const targetHash=sha(Buffer.from(content,'utf8'));
      const prior=raw.history.find(x=>x.request_id===request_id);
      if(prior) {
        if(prior.path!==p.relative||prior.before_sha256!==expected_sha256||
          prior.after_sha256!==targetHash)throw Error('source_patch_request_collision');
        return {...prior,already_applied:true,automatic_retry_allowed:false};
      }
      if(raw.pending)throw Error('source_patch_reconciliation_required');
      const original=await fs.readFile(p.target);
      if(sha(original)!==expected_sha256)throw Error('source_patch_compare_and_swap_failed');
      const record={schema:SOURCE_PATCH_SCHEMA,request_id,path:p.relative,
        before_sha256:expected_sha256,after_sha256:targetHash};
      raw.pending=record;
      await this.#save(current,raw); // write-ahead before touching a source file
      const tmp=p.target+'.devfleet-'+crypto.randomUUID()+'.tmp';
      try {
        await fs.writeFile(tmp,content,{mode:0o600,flag:'wx'});
        if(sha(await fs.readFile(tmp))!==targetHash)
          throw Error('source_patch_staged_hash_mismatch');
        // Atomic within the same directory. Never modifies packaged EXE bytes.
        await fs.rename(tmp,p.target);
      }catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw e;}
      raw.history=[...raw.history,{...record,state:'PATCHED'}].slice(-128);
      raw.pending=null;
      await this.#save(current,raw);
      return {...record,state:'PATCHED',live_runtime_reloaded:false,
        automatic_retry_allowed:false};
    } finally {this.#busy=false;}
  }
  async reconcile({request_id}) {
    if(!reqRe.test(request_id))throw Error('source_patch_request_invalid');
    if(this.#busy)throw Error('source_patch_busy');
    this.#busy=true;
    try {
      const workspace=this.#getRoot();
      if(typeof workspace!=='string')throw Error('source_patch_workspace_unpinned');
      const root=await fs.realpath(workspace);
      const {raw,current}=await this.#ledger(root);
      if(!raw.pending||raw.pending.request_id!==request_id)
        throw Error('source_patch_no_matching_pending');
      const p=await this.#resolve(raw.pending.path);
      const found=sha(await fs.readFile(p.target));
      if(found!==raw.pending.after_sha256)
        return {schema:SOURCE_PATCH_SCHEMA,state:'AMBIGUOUS',
          request_id,observed_sha256:found,automatic_retry_allowed:false};
      const proof={...raw.pending,state:'PATCHED',reconciled:true};
      raw.history=[...raw.history,proof].slice(-128);
      raw.pending=null;
      await this.#save(current,raw);
      return {...proof,automatic_retry_allowed:false};
    } finally {this.#busy=false;}
  }
}
