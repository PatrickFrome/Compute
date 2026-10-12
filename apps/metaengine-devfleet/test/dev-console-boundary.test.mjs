import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../src/',import.meta.url);
const read=async file=>fs.readFile(new URL(file,root),'utf8');
test('isolated Dev Console gets developer IPC; ChatGPT and hot UI only get chat controls',async()=>{
 const main=await read('main.mjs');
 const devPreload=await read('dev-console-preload.cjs');
 const mainPreload=await read('preload.cjs');
 assert.match(main,/function devConsoleSender\(event\)/);
 assert.match(main,/event.senderFrame!==event.sender.mainFrame/);
 assert.match(main,/dev-console\.html/);
 assert.match(main,/setWindowOpenHandler\(\(\)=>\(\{action:'deny'\}\)\)/);
 assert.match(main,/dataDir,builtinHtml:path\.join\(__dirname,'index\.html'\)/);
 assert.match(main,/const activeUiFile=await liveUiSlots\.init\(\)/);
 assert.match(main,/await mainWindow\.loadFile\(activeUiFile\)/);
 assert.match(main,/operator\?\.isBusy\(\)/);
 assert.match(main,/registerDevConsole\(\)/);
 for(const method of ['status','choose','stage','activate','rollback'])
  assert.match(devPreload,new RegExp("devconsole:"+method));
 for(const denied of ['devconsole:stage','devconsole:activate','devconsole:choose','devconsole:rollback']){
  assert.ok(!mainPreload.includes(denied));
 }
 assert.ok(!mainPreload.includes('exec('));
 assert.match(main,/developerToken = crypto.randomBytes\(32\).toString\('hex'\)/);
 assert.match(main,/if \(!devAuthorized \|\| !liveUiSlots\?\.configured\)/);
 assert.match(main,/if \(!chatAuthorized\) return respond\(403/);
 assert.match(main,/devconsole_trusted_window_required/);
 assert.match(main,/developer-rpc\.json/);
 assert.ok(!/child_process|execFile|spawn\(/.test(main));
});
test('Console renderer remains packaged/trusted, not a GPT tab, no external script',async()=>{
 const consoleHtml=await read('dev-console.html');
 const consoleJs=await read('dev-console-ui.js');
 assert.match(consoleHtml,/METAENGINE Dev Console/);
 assert.match(consoleHtml,/Content-Security-Policy/);
 assert.match(consoleHtml,/default-src 'none'/);
 assert.match(consoleHtml,/script src="\.\/dev-console-ui\.js"/);
 assert.ok(!/https?:\/\//.test(consoleHtml));
 assert.match(consoleJs,/window\.devfleetConsole\[/);
 assert.doesNotMatch(consoleJs,/eval\(|new Function|fetch\(/);
});
