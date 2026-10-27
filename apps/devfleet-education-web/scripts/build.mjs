import './pack-link.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await fs.rm(path.join(root,'dist'),{recursive:true,force:true});
await fs.cp(path.join(root,'public'),path.join(root,'dist'),{recursive:true});
await fs.cp(path.join(root,'src'),path.join(root,'dist','src'),{recursive:true});
console.log('Built standalone static site: dist/');
