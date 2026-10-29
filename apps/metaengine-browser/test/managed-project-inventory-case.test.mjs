import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {samePhysicalWorkspacePath,parseWorktreePorcelainZ} from '../src/workspace-git-hardening.mjs';
const source=await fs.readFile(new URL('../src/managed-task-project-runtime.mjs',import.meta.url),'utf8');
const start=source.indexOf('  async function inventory('),end=source.indexOf('  async function create(',start);assert.ok(start>0&&end>start);
const reservation={workspace_id:'workspace',task_id:'task',lease_generation:3,worktree_path:path.resolve('/fixture/Managed/Task')};
const recordPath=reservation.worktree_path.toUpperCase();
const stdout=`worktree ${recordPath}\0HEAD ${'a'.repeat(40)}\0branch refs/heads/test\0locked METAENGINE:${reservation.workspace_id}:task:${reservation.task_id}:lease:${reservation.lease_generation}\0\0`;
function inventory(platform,realpath=recordPath){return vm.runInNewContext(source.slice(start,end)+'\ninventory',{
 path,parseWorktreePorcelainZ,executePlan:async()=>({stdout}),planWorkspaceInventory:()=>({}),
 verifyWorkspaceInventory:()=>({head_sha:'a'.repeat(40),worktree_path:reservation.worktree_path}),
 samePhysicalWorkspacePath:(a,b)=>samePhysicalWorkspacePath(a,b,{platform}),fs:{realpath:async()=>realpath},
});}
test('actual managed inventory preserves verified Windows case equivalence during lock and realpath readback',async()=>{
 assert.equal((await inventory('win32')(reservation)).head_sha,'a'.repeat(40));
 await assert.rejects(inventory('win32',path.resolve('/fixture/OtherRoot'))(reservation),/realpath_mismatch/);
});
test('managed inventory does not case-fold distinct Linux paths',async()=>{await assert.rejects(inventory('linux')(reservation),/lock_identity_mismatch/);});
