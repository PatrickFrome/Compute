import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {MATERIALS} from './education-library.mjs';
import {validAssetId} from './education-blocks.mjs';
export const MAX_IMPORT_BYTES=8*1024*1024;
const topic=id=>{if(!MATERIALS.some(m=>m.id===id))throw Error('live_topic_unknown');};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const dimensions=(width,height)=>{if(width<1||height<1||width>8192||height>8192||width*height>16000000)throw Error('live_image_dimensions');return {width,height};};
/** Inspect dimensions before decoding. Raster only: SVG/HTML/GIF/WebP are not imports. */
export function inspectRaster(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_IMPORT_BYTES)throw Error('live_image_invalid');
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR')
    return {...dimensions(bytes.readUInt32BE(16),bytes.readUInt32BE(20)),format:'png'};
  if(bytes[0]===255&&bytes[1]===216){
    let p=2;
    while(p+4<bytes.length){
      if(bytes[p++]!==255)throw Error('live_image_invalid');while(bytes[p]===255)p++;
      const marker=bytes[p++];if(marker===0xD9||marker===0xDA)break;
      const len=bytes.readUInt16BE(p);if(len<2||p+len>bytes.length)throw Error('live_image_invalid');
      if([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)){
        if(len<8)throw Error('live_image_invalid');
        return {...dimensions(bytes.readUInt16BE(p+5),bytes.readUInt16BE(p+3)),format:'jpeg'};
      }p+=len;
    }
  }
  throw Error('live_image_invalid');
}
/** Only normalized PNGs produced by the native main process enter this store. */
export class LessonAssetStore{
  #dir;#index;#write;#queue=Promise.resolve();
  constructor({dataDir,writeAtomic}){this.#dir=path.join(dataDir,'education-images');this.#write=writeAtomic;}
  async init(){
    await fs.mkdir(this.#dir,{recursive:true});
    try{const f=path.join(this.#dir,'index.json'),s=await fs.stat(f);if(s.size>1024*1024)throw Error('live_image_index_invalid');
      this.#index=JSON.parse(await fs.readFile(f,'utf8'));
    }catch(e){if(e.code==='ENOENT')this.#index={version:1,topics:{}};else throw e;}
    if(this.#index?.version!==1||!this.#index.topics||Array.isArray(this.#index.topics))throw Error('live_image_index_invalid');
    for(const [id,items] of Object.entries(this.#index.topics)){
      topic(id);if(!Array.isArray(items)||items.length>12)throw Error('live_image_index_invalid');const seen=new Set();
      for(const a of items){if(!validAssetId(a.id)||seen.has(a.id)||typeof a.title!=='string'||a.title.length>160
        ||!Number.isInteger(a.width)||!Number.isInteger(a.height)||a.width<1||a.height<1||a.width>2048||a.height>2048)throw Error('live_image_index_invalid');seen.add(a.id);}
    }
  }
  list(id){topic(id);return structuredClone(this.#index.topics[id]||[]);}
  async addNormalized(id,png,title){topic(id);
    const task=this.#queue.then(async()=>{
      const d=inspectRaster(png);if(d.format!=='png'||d.width>2048||d.height>2048)throw Error('live_image_invalid');
      if(typeof title!=='string'||!title.trim()||title.length>160)throw Error('live_image_invalid');
      const asset={id:'img_'+hash(png),title:title.trim(),width:d.width,height:d.height,media_type:'image/png',bytes:png.length};
      const current=this.list(id);if(current.some(a=>a.id===asset.id))return asset;
      if(current.length>=12)throw Error('live_image_capacity');
      const next=structuredClone(this.#index);next.topics[id]=[...current,asset];
      await this.#write(path.join(this.#dir,asset.id+'.png'),png);
      await this.#write(path.join(this.#dir,'index.json'),JSON.stringify(next));this.#index=next;return asset;
    });this.#queue=task.catch(()=>{});return task;
  }
  async read(id,assetId){topic(id);
    if(!validAssetId(assetId)||!this.list(id).some(a=>a.id===assetId))throw Error('live_image_not_authorized');
    const file=path.join(this.#dir,assetId+'.png');const s=await fs.lstat(file);
    if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_IMPORT_BYTES)throw Error('live_image_invalid');
    const bytes=await fs.readFile(file);if('img_'+hash(bytes)!==assetId)throw Error('live_image_integrity');
    return {asset_id:assetId,data_url:'data:image/png;base64,'+bytes.toString('base64')};
  }
}
