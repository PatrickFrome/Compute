import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeCodingHostImageGuard} from './native-coding-host-os-scope.mjs';

test('private Host qualifies real immutable bytes once and denies use before qualification',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-host-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'image.bin');await fs.writeFile(file,'real-test-image');
 const guard=createNativeCodingHostImageGuard();await assert.rejects(guard.read(file),/image_not_prepared/);
 await Promise.all([guard.prepare([file]),guard.prepare([file])]);const expected=createHash('sha256').update('real-test-image').digest('hex');
 assert.equal(await guard.read(file),expected);await guard.prepare([file]);assert.equal(await guard.read(file),expected);
});
for(const mutation of ['bytes','same-byte-replacement','link'])test('prepared Host never silently requalifies '+mutation,async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-host-image-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'image.bin'),alias=path.join(dir,'alias.bin');await fs.writeFile(file,'image-v1');
 const guard=createNativeCodingHostImageGuard();await guard.prepare([file]);
 if(mutation==='bytes')await fs.writeFile(file,'image-v2');
 if(mutation==='same-byte-replacement'){await fs.rename(file,alias);await fs.writeFile(file,'image-v1');}
 if(mutation==='link')await fs.link(file,alias);
 await assert.rejects(guard.read(file),/image_preparation_invalidated|image_file_unverified/);
 if(mutation==='link')await fs.unlink(alias);
 await assert.rejects(guard.prepare([file]),/image_preparation_invalidated/);
});
