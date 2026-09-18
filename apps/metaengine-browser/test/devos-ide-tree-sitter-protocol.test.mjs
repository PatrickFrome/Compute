import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEVOS_TREE_SITTER_BOUNDS,
  DEVOS_TREE_SITTER_PROTOCOL_CONTRACT,
  DEVOS_TREE_SITTER_RUNTIME_CONTRACT,
  classifyDevOSTreeSitterIncrementalEligibility,
  classifyDevOSTreeSitterSourceDigest,
  sameDevOSTreeSitterDocumentIdentity,
  validateDevOSTreeSitterDerivedEditReceipt,
  validateDevOSTreeSitterDocumentRef,
  validateDevOSTreeSitterEditRequest,
  validateDevOSTreeSitterMonacoEdit,
  validateDevOSTreeSitterOpenRequest,
  validateDevOSTreeSitterParserRef,
} from '../src/devos-tree-sitter-protocol.mjs';

const W = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const doc = (o={}) => ({workspace_id:W,workspace_generation:7,document_id:D,document_generation:3,relative_path:'apps/metaengine-browser/src/main.mjs',revision:11,source_sha256:'sha256:'+'a'.repeat(64),...o});
const parser = (o={}) => ({worker_generation:5,language_id:'javascript',grammar_asset_id:'tree-sitter-javascript',grammar_sha256:'sha256:'+'b'.repeat(64),parser_abi:15,...o});

test('runtime is pinned packaged worker-isolated and zero-authority', () => {
  assert.equal(DEVOS_TREE_SITTER_RUNTIME_CONTRACT.package_version,'0.27.0');
  assert.deepEqual([DEVOS_TREE_SITTER_RUNTIME_CONTRACT.parser_abi_min,DEVOS_TREE_SITTER_RUNTIME_CONTRACT.parser_abi_max],[13,15]);
  assert.equal(DEVOS_TREE_SITTER_RUNTIME_CONTRACT.packaged_wasm_required,true);
  assert.equal(DEVOS_TREE_SITTER_RUNTIME_CONTRACT.network_required,false);
  assert.equal(DEVOS_TREE_SITTER_RUNTIME_CONTRACT.renderer_supplied_wasm_url_allowed,false);
  assert.equal(DEVOS_TREE_SITTER_RUNTIME_CONTRACT.renderer_supplied_query_allowed,false);
  assert.equal(DEVOS_TREE_SITTER_RUNTIME_CONTRACT.authority_effect,false);
});

test('document identity is exact across workspace/document generations and path', () => {
  const a=validateDevOSTreeSitterDocumentRef(doc());
  assert.equal(sameDevOSTreeSitterDocumentIdentity(a,doc({revision:12,source_sha256:'sha256:'+'c'.repeat(64)})),true);
  assert.equal(sameDevOSTreeSitterDocumentIdentity(a,doc({document_generation:4})),false);
  for(const relative_path of ['/x.js','../x.js','src\\x.js','.git/HEAD','a//b.js']) {
    assert.throws(()=>validateDevOSTreeSitterDocumentRef(doc({relative_path})),/relative_path/);
  }
});

test('parser ref refuses arbitrary grammar locations and unsupported ABI', () => {
  assert.equal(validateDevOSTreeSitterParserRef(parser({parser_abi:13})).parser_abi,13);
  assert.throws(()=>validateDevOSTreeSitterParserRef(parser({parser_abi:12})),/abi_unsupported/);
  assert.throws(()=>validateDevOSTreeSitterParserRef(parser({parser_abi:16})),/abi_unsupported/);
  assert.throws(()=>validateDevOSTreeSitterParserRef(parser({grammar_asset_id:'../../evil.wasm'})),/grammar_asset_id/);
  assert.throws(()=>validateDevOSTreeSitterParserRef(parser({grammar_asset_id:'https://x/y.wasm'})),/grammar_asset_id/);
});

test('open source is bounded and requires worker digest readback', () => {
  const value=validateDevOSTreeSitterOpenRequest({schema:'metaengine.devos.tree-sitter.open.v1',protocol_version:1,request_id:'open-1',document:doc(),parser:parser(),source_text:'export const x=1;\n'});
  assert.equal(value.worker_source_sha256_readback_required,true);
  assert.equal(value.packaged_grammar_resolution_required,true);
  assert.throws(()=>validateDevOSTreeSitterOpenRequest({schema:'metaengine.devos.tree-sitter.open.v1',protocol_version:1,request_id:'big',document:doc(),parser:parser(),source_text:'x'.repeat(DEVOS_TREE_SITTER_BOUNDS.source_text_bytes+1)}),/source_text/);
});

test('Monaco edit does not grant renderer byte-offset authority', () => {
  const edit=validateDevOSTreeSitterMonacoEdit({start:{line_number:2,column:4},end:{line_number:2,column:7},replacement_text:'π'});
  assert.equal(edit.replacement_utf8_bytes,2);
  assert.equal(edit.renderer_byte_offsets_trusted,false);
  assert.equal(edit.renderer_tree_points_trusted,false);
  assert.throws(()=>validateDevOSTreeSitterMonacoEdit({start:{line_number:3,column:1},end:{line_number:2,column:1},replacement_text:''}),/range_invalid/);
});

test('incremental edit requires same identity, revision +1 and changed digest', () => {
  const value=validateDevOSTreeSitterEditRequest({schema:'metaengine.devos.tree-sitter.edit.v1',protocol_version:1,request_id:'e1',previous_document:doc(),next_document:doc({revision:12,source_sha256:'sha256:'+'c'.repeat(64)}),parser:parser(),edit:{start:{line_number:1,column:1},end:{line_number:1,column:1},replacement_text:'x'}});
  assert.equal(value.edit_count,1);
  assert.equal(value.worker_byte_mapping_required,true);
  assert.equal(value.old_tree_edit_before_parse_required,true);
  assert.throws(()=>validateDevOSTreeSitterEditRequest({schema:'metaengine.devos.tree-sitter.edit.v1',protocol_version:1,request_id:'gap',previous_document:doc(),next_document:doc({revision:13,source_sha256:'sha256:'+'c'.repeat(64)}),parser:parser(),edit:{start:{line_number:1,column:1},end:{line_number:1,column:1},replacement_text:'x'}}),/revision_gap/);
});

test('worker-derived edit uses UTF-8 byte indices and byte columns', () => {
  const value=validateDevOSTreeSitterDerivedEditReceipt({schema:'metaengine.devos.tree-sitter.derived-edit.v1',protocol_version:1,previous_document:doc(),next_document:doc({revision:12,source_sha256:'sha256:'+'c'.repeat(64)}),start_index:10,old_end_index:13,new_end_index:12,start_position:{row:0,column:10},old_end_position:{row:0,column:13},new_end_position:{row:0,column:12},replacement_utf8_bytes:2,worker_source_sha256_verified:true});
  assert.equal(value.byte_offsets_are_utf8,true);
  assert.equal(value.tree_point_columns_are_bytes,true);
  assert.throws(()=>validateDevOSTreeSitterDerivedEditReceipt({schema:'metaengine.devos.tree-sitter.derived-edit.v1',protocol_version:1,previous_document:doc(),next_document:doc({revision:12,source_sha256:'sha256:'+'c'.repeat(64)}),start_index:10,old_end_index:13,new_end_index:14,start_position:{row:0,column:10},old_end_position:{row:0,column:13},new_end_position:{row:0,column:14},replacement_utf8_bytes:2,worker_source_sha256_verified:true}),/byte_edit/);
});

test('ambiguous continuity falls back to full reparse, never guessed incremental reuse', () => {
  const previous=doc(), next=doc({revision:12,source_sha256:'sha256:'+'c'.repeat(64)});
  const base={previous_document:previous,next_document:next,previous_parser:parser(),next_parser:parser(),edit_count:1,old_tree_available:true,byte_mapping_verified:true};
  assert.equal(classifyDevOSTreeSitterIncrementalEligibility(base).state,'INCREMENTAL_ALLOWED');
  assert.equal(classifyDevOSTreeSitterIncrementalEligibility({...base,edit_count:2}).reason,'EDIT_BATCH_NOT_SINGLE');
  assert.equal(classifyDevOSTreeSitterIncrementalEligibility({...base,old_tree_available:false}).reason,'OLD_TREE_MISSING');
  assert.equal(classifyDevOSTreeSitterIncrementalEligibility({...base,byte_mapping_verified:false}).reason,'BYTE_MAPPING_UNVERIFIED');
  assert.equal(classifyDevOSTreeSitterIncrementalEligibility({...base,next_parser:parser({worker_generation:6})}).reason,'PARSER_DRIFT');
  assert.equal(classifyDevOSTreeSitterIncrementalEligibility({...base,next_document:doc({revision:14,source_sha256:'sha256:'+'c'.repeat(64)})}).reason,'REVISION_GAP');
});

test('source digest mismatch is fail-closed and non-retry-authoritative', () => {
  const ok=classifyDevOSTreeSitterSourceDigest({declared_source_sha256:'sha256:'+'a'.repeat(64),observed_source_sha256:'sha256:'+'a'.repeat(64)});
  assert.equal(ok.accepted,true);
  const bad=classifyDevOSTreeSitterSourceDigest({declared_source_sha256:'sha256:'+'a'.repeat(64),observed_source_sha256:'sha256:'+'b'.repeat(64)});
  assert.equal(bad.accepted,false);
  assert.equal(bad.automatic_retry_allowed,false);
});

test('protocol preserves Development OS authority invariants', () => {
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.multiple_edits_require_full_reparse,true);
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.mapping_ambiguity_requires_full_reparse,true);
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.renderer_supplied_wasm_url_allowed,false);
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.renderer_supplied_query_allowed,false);
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.second_scheduler_allowed,false);
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.automatic_retry_allowed,false);
  assert.equal(DEVOS_TREE_SITTER_PROTOCOL_CONTRACT.authority_effect,false);
});
