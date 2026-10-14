import test from 'node:test';
import assert from 'node:assert/strict';
import {composerDomText} from '../src/composer-dom-core.mjs';
const text = value => ({nodeType:3,nodeName:'#text',nodeValue:value});
const element = (name,children=[]) => ({nodeType:1,nodeName:name,childNodeCount:children.length,children});
const root = children => ({...element('DIV',children),backendNodeId:17,
  attributes:['id','prompt-textarea','contenteditable','true']});
test('native contenteditable preserves exact multi-paragraph prompts and request marker',()=>{
  const lines=['Implement W12.', '', '[DevFleet request: unique-20261014-001]'];
  assert.equal(composerDomText(root(lines.map(x=>element('P',x?[text(x)]:[element('BR')]))),17),lines.join('\n'));
  assert.equal(composerDomText(root([text('  spaces  ')]),17),'  spaces  ');
  assert.equal(composerDomText(root([element('P',[text('a'),element('BR'),text('b')])]),17),'a\nb');
});
test('empty paragraph is empty, deliberate blank paragraphs and Unicode stay exact',()=>{
  assert.equal(composerDomText(root([element('P',[element('BR')])]),17),'');
  assert.equal(composerDomText(root([element('P',[element('BR')]),element('P',[element('BR')])]),17),'\n');
  assert.equal(composerDomText(root([element('P',[text('Код & <текст> 👩‍💻')])]),17),'Код & <текст> 👩‍💻');
});
test('wrong node, attribute marker, truncation, scripts and missing evidence fail closed',()=>{
  const n=root([text('task')]);
  assert.equal(composerDomText(n,18),null);
  assert.equal(composerDomText({...n,attributes:['id','other','contenteditable','true']},17),null);
  assert.equal(composerDomText({...n,attributes:['id','prompt-textarea','contenteditable','false']},17),null);
  assert.equal(composerDomText({...n,childNodeCount:2},17),null);
  assert.equal(composerDomText(root([element('SCRIPT',[text('task')])]),17),null);
  assert.equal(composerDomText({...n,shadowRoots:[{}]},17),null);
  assert.equal(composerDomText(root([text('x'.repeat(65537))]),17),null);
  assert.equal(composerDomText({...n,attributes:[...n.attributes,'title','not task']},17),'task');
});
