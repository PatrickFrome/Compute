import test from 'node:test';import assert from 'node:assert/strict';
import {hasExactEmptyRichTextPlaceholder} from '../src/rich-text-empty-placeholder.mjs';
function editor(){return {nodeType:1,nodeName:'DIV',attributes:['id','prompt-textarea','contenteditable','true'],childNodeCount:1,children:[{nodeType:1,nodeName:'P',attributes:[],childNodeCount:1,children:[{nodeType:1,nodeName:'BR',attributes:['class','ProseMirror-trailingBreak'],childNodeCount:0,children:[]}]}]};}
test('exact empty editor is recognized without trimming input',()=>assert.equal(hasExactEmptyRichTextPlaceholder(editor()),true));
for(const [name,mutate] of [
 ['literal newline',n=>n.children[0].children=[{nodeType:3,nodeValue:'\n'}]],
 ['whitespace text',n=>n.children[0].children=[{nodeType:3,nodeValue:' '}]],
 ['private draft',n=>n.children[0].children=[{nodeType:3,nodeValue:'draft'}]],
 ['incomplete DOM',n=>n.children[0].childNodeCount=2],
 ['other editor',n=>n.attributes[1]='other'],
 ['readonly editor',n=>n.attributes[3]='false'],
 ['plain textarea',n=>n.nodeName='TEXTAREA'],
 ['ordinary break',n=>n.children[0].children[0].attributes=[]],
 ['embedded element',n=>n.children[0].nodeName='SPAN'],
 ['malformed attrs',n=>n.attributes.push('unpaired')],
 ['multiple paragraphs',n=>{n.children.push(structuredClone(n.children[0]));n.childNodeCount=2;}]
]) test(name+' is never a proven empty composer',()=>{const n=editor();mutate(n);assert.equal(hasExactEmptyRichTextPlaceholder(n),false);});
