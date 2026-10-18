import test from 'node:test';
import assert from 'node:assert/strict';
import {composerHtmlText} from '../src/composer-html-core.mjs';
import {emptyCodingQueue,enqueueCodingTask,readCodingQueue,chooseFairCodingWave} from '../src/coding-task-queue-core.mjs';

test('native outerHTML recovers complete ProseMirror paragraphs and entities',()=>{
  const html='<div id="prompt-textarea" contenteditable="true"><p>Run W13 <a href="https://github.com/">GitHub</a></p><p><br></p><p>&lt;SHA&gt; &amp; exact marker</p></div>';
  assert.equal(composerHtmlText(html),'Run W13 GitHub\n\n<SHA> & exact marker');
  assert.equal(composerHtmlText('<div contenteditable="true"><p><br></p></div>'),'');
  assert.equal(composerHtmlText('<div contenteditable="true"><p>Здравствуйте 🌐</p></div>'),'Здравствуйте 🌐');
});
test('HTML parser denies wrong editor, scripting, extra roots and malformed identity',()=>{
  assert.equal(composerHtmlText('<div contenteditable="true" id="other">a</div>'),null);
  assert.equal(composerHtmlText('<div contenteditable="false">a</div>'),null);
  assert.equal(composerHtmlText('<div contenteditable="true"><script>task</script></div>'),null);
  assert.equal(composerHtmlText('<div contenteditable="true">a</div><div contenteditable="true">b</div>'),null);
  assert.equal(composerHtmlText(null),null);
});
test('durable source queue accepts 80 independent tasks, no legacy 32-task hard cap',()=>{
  let q=emptyCodingQueue();
  for(let n=0;n<80;n++){
    const id=String(n).padStart(3,'0');
    q=enqueueCodingTask(q,{task_id:'metaengine-w13-'+id,request_id:'W13-20261018-'+id,
      project_id:'conveyor',kind:'SOURCE_CODING',scope:'SOURCE_ONLY',
      draft_pr_only:true,text:'Review source candidate '+id}).queue;
  }
  assert.equal(readCodingQueue(q).items.length,80);
  assert.equal(chooseFairCodingWave(q,40).task_ids.length,40);
});
