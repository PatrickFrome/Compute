import {parseFragment} from 'parse5';

// Recover exact editor text when CDP DOM.describeNode omits nested children.
// DOM.getOuterHTML comes from the same native backendNodeId, not page JS.
const block=new Set(['div','p']);
const inline=new Set(['span','strong','em','b','i','code','a','mark','u']);
export function composerHtmlText(html, diagnostic=null) {
  const reject=(reason,tag=null)=>{
    if(diagnostic && typeof diagnostic==='object'){
      diagnostic.outer_html_rejection=reason;
      if(typeof tag==='string' && /^[a-z][a-z0-9-]{0,39}$/.test(tag))
        diagnostic.unsupported_element=tag;
    }
    return null;
  };
  if(typeof html!=='string'||!html||html.length>250000)return reject('HTML_BOUNDS');
  let document;
  try{document=parseFragment(html);}catch{return reject('PARSE_ERROR');}
  const roots=document.childNodes||[];
  if(roots.length!==1)return reject('ROOT_COUNT');
  const root=roots[0];
  if(root.tagName!=='div'||!Array.isArray(root.attrs))return reject('ROOT_IDENTITY');
  const attrs=new Map();
  for(const a of root.attrs){
    if(typeof a.name!=='string'||attrs.has(a.name))return reject('DUPLICATE_ATTRIBUTE');
    attrs.set(a.name,a.value);
  }
  if(attrs.get('contenteditable')!=='true'||(attrs.has('id')&&attrs.get('id')!=='prompt-textarea'))
    return reject('EDITOR_IDENTITY');
  let visited=0;
  function walk(n,depth=0){
    if(++visited>8192||depth>40)throw Error('COMPOSER_COMPLEX');
    if(n.nodeName==='#text'){
      if(typeof n.value!=='string')throw Error('TEXT_UNPROVEN');
      return n.value;
    }
    if(typeof n.tagName!=='string')throw Error('NODE_UNSUPPORTED');
    const tag=n.tagName.toLowerCase();
    if(tag==='br')return '\n';
    if(!block.has(tag)&&!inline.has(tag))throw Error('TAG_UNSUPPORTED:'+tag);
    const children=n.childNodes||[];
    if(!Array.isArray(children))throw Error('CHILDREN_UNPROVEN');
    if(block.has(tag)&&children.length===1&&children[0]?.tagName==='br')return '';
    let out='',previousBlock=false;
    for(let i=0;i<children.length;i++){
      const child=children[i];
      const isBlock=block.has(child?.tagName);
      if(i>0&&(previousBlock||isBlock))out+='\n';
      out+=walk(child,depth+1);
      previousBlock=isBlock;
    }
    return out;
  }
  try {
    const result=walk(root);
    return result.length<=65536?result:null;
  }catch(error){
    const message=String(error?.message||'');
    if(message.startsWith('TAG_UNSUPPORTED:'))return reject('UNSUPPORTED_ELEMENT',message.slice(16));
    return reject('UNSUPPORTED_DOM_STRUCTURE');
  }
}
