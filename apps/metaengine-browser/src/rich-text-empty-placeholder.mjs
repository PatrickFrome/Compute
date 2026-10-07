// Normalize a Chromium AX newline only after exact DOM proof of an empty editor.
export function hasExactEmptyRichTextPlaceholder(node) {
 if(!node || node.nodeType!==1 || String(node.nodeName).toUpperCase()!=='DIV') return false;
 const attrs=new Map();
 if(!Array.isArray(node.attributes) || node.attributes.length%2) return false;
 for(let i=0;i<node.attributes.length;i+=2) attrs.set(node.attributes[i],node.attributes[i+1]);
 if(attrs.get('id')!=='prompt-textarea' || attrs.get('contenteditable')!=='true') return false;
 let visited=0,breaks=0;
 function walk(value){
  if(++visited>32 || !value || value.nodeType!==1) return false;
  const name=String(value.nodeName).toUpperCase();
  if(!['DIV','P','BR'].includes(name)) return false;
  const children=Array.isArray(value.children)?value.children:[];
  if(!Number.isInteger(value.childNodeCount) || value.childNodeCount!==children.length) return false;
  if(name==='BR'){
   const a=value.attributes||[];let trailing=false;
   for(let i=0;i<a.length;i+=2) if(a[i]==='class') trailing=String(a[i+1]).split(/\s+/).includes('ProseMirror-trailingBreak');
   if(!trailing || children.length) return false;
   breaks++;
  }
  return children.every(walk);
 }
 return walk(node) && breaks===1;
}
