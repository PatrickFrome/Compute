// Exact text from the native CDP node of the unique composer. No page JS,
// HTML regex, attribute text, missing AX value or whitespace trim is proof.
export function composerDomText(node, backendNodeId) {
  if (!node || node.backendNodeId !== backendNodeId || node.nodeType !== 1 ||
      !Number.isSafeInteger(backendNodeId) || backendNodeId < 1) return null;
  const attrs = node.attributes;
  if (!Array.isArray(attrs) || attrs.length % 2 || attrs.length > 256) return null;
  const attributes = new Map();
  for (let i = 0; i < attrs.length; i += 2) {
    if (typeof attrs[i] !== 'string' || typeof attrs[i + 1] !== 'string' ||
        attributes.has(attrs[i].toLowerCase())) return null;
    attributes.set(attrs[i].toLowerCase(), attrs[i + 1]);
  }
  if (attributes.get('contenteditable') !== 'true' ||
      attributes.get('id') !== 'prompt-textarea') return null;
  const blocks = new Set(['P', 'DIV']);
  const inline = new Set(['SPAN', 'STRONG', 'EM', 'B', 'I', 'CODE', 'A']);
  let count = 0;
  function walk(n, depth = 0) {
    if (++count > 4096 || depth > 32 || !n || n.shadowRoots?.length ||
        n.contentDocument) throw Error('incomplete_composer');
    // CSS placeholder pseudo-elements are not authored DOM children.
    if (n.nodeType === 3) {
      if (typeof n.nodeValue !== 'string') throw Error('incomplete_composer');
      return n.nodeValue;
    }
    if (n.nodeType !== 1) throw Error('unsupported_composer_node');
    const name = String(n.nodeName).toUpperCase();
    if (name === 'BR') return '\n';
    if (!blocks.has(name) && !inline.has(name)) throw Error('unsupported_composer_node');
    const children = n.children || [];
    if (!Array.isArray(children) || !Number.isSafeInteger(n.childNodeCount) ||
        n.childNodeCount !== children.length) throw Error('incomplete_composer');
    // ProseMirror's lone <br> is an empty paragraph, not an authored newline.
    if (blocks.has(name) && children.length === 1 && children[0].nodeName === 'BR') return '';
    let text = '', previousBlock = false;
    for (const child of children) {
      const block = child.nodeType === 1 && blocks.has(String(child.nodeName).toUpperCase());
      if (text.length && (previousBlock || block)) text += '\n';
      else if (previousBlock || (block && children.indexOf(child) > 0)) text += '\n';
      text += walk(child, depth + 1);
      previousBlock = block;
    }
    return text;
  }
  try {
    const text = walk(node);
    return text.length <= 65536 ? text : null;
  } catch { return null; }
}
