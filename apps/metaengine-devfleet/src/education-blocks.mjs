// Reviewed lesson modules, not executable plug-ins. All prose stays plain text.
export const BLOCK_KINDS=Object.freeze(['text','callout','formula','checklist','table','quiz','diagram','image','ohm_lab']);
export const MAX_BLOCKS=20;
const object=v=>!!v&&Object.getPrototypeOf(v)===Object.prototype;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const ident=v=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,47}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
export const validAssetId=v=>typeof v==='string'&&/^img_[a-f0-9]{64}$/.test(v);
const fail=()=>{throw Error('live_block_invalid');};
export function validateBlock(b){
  if(!object(b)||!ident(b.id)||!BLOCK_KINDS.includes(b.kind)||!text(b.title,120))fail();
  const keys=['id','kind','title'];
  switch(b.kind){
    case 'text':case 'callout':case 'formula':
      if(!exact(b,[...keys,'text'])||!text(b.text,b.kind==='formula'?1200:6000))fail();break;
    case 'checklist':
      if(!exact(b,[...keys,'items'])||!Array.isArray(b.items)||b.items.length<1||b.items.length>16||b.items.some(x=>!text(x,600)))fail();break;
    case 'table':
      if(!exact(b,[...keys,'columns','rows'])||!Array.isArray(b.columns)||b.columns.length<1||b.columns.length>6||b.columns.some(x=>!text(x,100))
        ||!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>20||b.rows.some(row=>!Array.isArray(row)||row.length!==b.columns.length||row.some(x=>!text(x,500))))fail();break;
    case 'quiz':
      if(!exact(b,[...keys,'question','choices','correct_index','explanation'])||!text(b.question,1500)||!Array.isArray(b.choices)
        ||b.choices.length<2||b.choices.length>6||b.choices.some(x=>!text(x,500))||!Number.isInteger(b.correct_index)
        ||b.correct_index<0||b.correct_index>=b.choices.length||!text(b.explanation,2000))fail();break;
    case 'diagram':{
      if(!exact(b,[...keys,'nodes','edges','caption'])||!text(b.caption,1200)||!Array.isArray(b.nodes)||b.nodes.length<1||b.nodes.length>8
        ||!Array.isArray(b.edges)||b.edges.length>12)fail();
      const ids=new Set();for(const n of b.nodes){if(!exact(n,['id','label'])||!ident(n.id)||ids.has(n.id)||!text(n.label,180))fail();ids.add(n.id);}
      for(const e of b.edges)if(!exact(e,['from','to','label'])||!ids.has(e.from)||!ids.has(e.to)||typeof e.label!=='string'||e.label.length>80)fail();break;}
    case 'image':
      if(!exact(b,[...keys,'asset_id','alt','caption'])||!validAssetId(b.asset_id)||!text(b.alt,500)||!text(b.caption,1500))fail();break;
    case 'ohm_lab':
      if(!exact(b,[...keys,'voltage','resistance'])||!Number.isFinite(b.voltage)||b.voltage<0||b.voltage>24
        ||!Number.isFinite(b.resistance)||b.resistance<1||b.resistance>1000000)fail();break;
    default:fail();
  }
  return structuredClone(b);
}
export function validateBlocks(blocks){
  if(!Array.isArray(blocks)||blocks.length>MAX_BLOCKS)fail();const seen=new Set();
  for(const b of blocks){validateBlock(b);if(seen.has(b.id))fail();seen.add(b.id);}
  if(JSON.stringify(blocks).length>36000)throw Error('live_block_capacity');return structuredClone(blocks);
}
export function validateBlockOperations(ops){
  if(!Array.isArray(ops)||ops.length>12)fail();const ids=new Set();
  for(const p of ops){
    if(!exact(p,['op','id','position','block'])||!ident(p.id)||ids.has(p.id)||!Number.isInteger(p.position)||p.position<0||p.position>=MAX_BLOCKS)fail();
    ids.add(p.id);
    if(p.op==='upsert'){validateBlock(p.block);if(p.block.id!==p.id)fail();}
    else if(p.op==='remove'){if(p.block!==null)fail();}
    else fail();
  }
  return structuredClone(ops);
}
export function applyBlockOperations(existing,ops,assetIds=[]){
  const result=validateBlocks(existing);validateBlockOperations(ops);const allowed=new Set(assetIds);
  for(const p of ops){
    if(p.op==='upsert'&&p.block.kind==='image'&&!allowed.has(p.block.asset_id))throw Error('live_image_not_authorized');
    const index=result.findIndex(b=>b.id===p.id);
    if(p.op==='remove'&&index<0)throw Error('live_block_not_found');
    if(index>=0)result.splice(index,1);
    if(p.op==='upsert')result.splice(Math.min(p.position,result.length),0,structuredClone(p.block));
  }
  return validateBlocks(result);
}
const str={type:'string'};
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const typed=(kind,properties)=>obj({id:str,kind:{type:'string',enum:[kind]},title:str,...properties});
export const LESSON_BLOCK_SCHEMA={anyOf:[
  ...['text','callout','formula'].map(kind=>typed(kind,{text:str})),
  typed('checklist',{items:{type:'array',items:str}}),
  typed('table',{columns:{type:'array',items:str},rows:{type:'array',items:{type:'array',items:str}}}),
  typed('quiz',{question:str,choices:{type:'array',items:str},correct_index:{type:'integer'},explanation:str}),
  typed('diagram',{nodes:{type:'array',items:obj({id:str,label:str})},edges:{type:'array',items:obj({from:str,to:str,label:str})},caption:str}),
  typed('image',{asset_id:str,alt:str,caption:str}),
  typed('ohm_lab',{voltage:{type:'number'},resistance:{type:'number'}})
]};
export const BLOCK_OP_SCHEMA=obj({op:{type:'string',enum:['upsert','remove']},id:str,position:{type:'integer'},block:{anyOf:[...LESSON_BLOCK_SCHEMA.anyOf,{type:'null'}]}});
