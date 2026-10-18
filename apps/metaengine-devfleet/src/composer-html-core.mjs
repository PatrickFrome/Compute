import {parseFragment} from 'parse5';

// Recover exact editor text when CDP DOM.describeNode omits nested children.
// DOM.getOuterHTML comes from the same native backendNodeId, not page JS.
const block=new Set(['div','p']);
const inline=new Set(['span','strong','em','b','i','code','a','mark','u']);
export function composerHtmlText(html) {
  if(typeof html!=='string'||!html||html.length>250000)return null;
  let document;
  try{document=parseFragment(html);}catch{return null;}
  const roots=document.childNodes||[];
  if(roots.length!==1)return null;
  const root=roots[0];
  if(root.tagName!=='div'||!Array.isArray(root.attrs))return null;
  const attrs=new Map();
  for(const a of root.attrs){
    if(typeof a.name!=='string'||attrs.has(a.name))return null;
    attrs.set(a.name,a.value);
  }
  if(attrs.get('contenteditable')!=='true'||(attrs.has('id')&&attrs.get('id')!=='prompt-textarea'))
    return null;
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
    if(!block.has(tag)&&!inline.has(tag))throw Error('TAG_UNSUPPORTED');
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
  }catch{return null;}
}
