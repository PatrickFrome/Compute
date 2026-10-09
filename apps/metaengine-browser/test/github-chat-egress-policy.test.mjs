import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGithubChatReplyResult } from '../src/github-chat-egress-policy.mjs';

const project=projectGithubChatReplyResult;

test('GitHub reply projection retains bounded state/receipt identity but never publishes secrets or local files',()=>{
  const input={
    schema:'metaengine.test.status.v1',state:'READY',command_id:'06da9a8b-6356-478c-a467-3d6c0ad53e54',
    provider:'LOCAL_POSTGRES',counts:{agents:4,queued:3},
    deep:{connection_string:'postgres://api:password@127.0.0.1:15432/owner',
      authorization:'Bearer abcdefghijklmno',env:{PGPASSWORD:'secret'},
      stdout:'private settings file',stderr:'private process output',
      png_path:'C:\\Users\\Owner\\AppData\\Local\\Temp\\capture.png',
      api_key:'github_pat_qwertyqwertyqwerty'},
    message:'Backend running normally',
    path:'C:\\Users\\Owner\\Documents\\private.json',
  };
  const output=project(input);
  assert.equal(output.state,'READY');
  assert.equal(output.provider,'LOCAL_POSTGRES');
  assert.equal(output.counts.agents,4);
  assert.equal(output.path,'[PRIVATE_PATH]');
  for(const value of Object.values(output.deep))assert.equal(value,'[REDACTED]');
  for(const secret of ['password@','Bearer ','C:\\Users\\','qwertyqwerty','private settings'])
    assert.equal(JSON.stringify(output).includes(secret),false);
});

test('GitHub reply redacts credentials embedded in otherwise innocuous messages',()=>{
  for(const value of [
    'postgres://service:secret@127.0.0.1:5432/metaengine',
    'Authorization: Bearer abcdefghijklmnopq',
    'password = hunter2',
    'github_pat_exampleverylongsecrettoken',
    'ghp_abcdefghijabcdefghij',
    'file:///C:/Users/Owner/passwords.txt',
    'C:\\Users\\Owner\\AppData\\Roaming\\private-config.json',
    'https://example.org/callback?access_token=sensitive',
    'https://owner:password@example.org/diagnostics',
    '/home/owner/data/pgdata',
  ]){
    const result=project({schema:'test',message:value});
    assert.equal(result.message,'[REDACTED_UNREVIEWED_TEXT]',value);
    assert(!JSON.stringify(result).includes(value));
  }
});

test('generic Browser titles, arbitrary agent text and unreviewed JSON strings are never forwarded',()=>{
  const result=project({
    state:'READY',tabs:[{title:'A private account number',url:'https://example.org/account/1234'}],
    agents:[{instructions:'Send money to account',objective:'private objective',
      browser_text:'personal page content',userMessage:'my social security number'}],
    capabilities:{actions:['COMPUTER_ACTION','GOAL_SUBMIT']},
  });
  assert.equal(result.state,'READY');
  assert.deepEqual(result.capabilities.actions,['COMPUTER_ACTION','GOAL_SUBMIT']);
  assert.equal(result.tabs[0].title,'[REDACTED_UNREVIEWED_TEXT]');
  assert.equal(result.agents[0].instructions,'[REDACTED_UNREVIEWED_TEXT]');
  assert.equal(result.agents[0].objective,'[REDACTED_UNREVIEWED_TEXT]');
  assert.equal(JSON.stringify(result).includes('social security'),false);
});

test('GitHub screenshot artifact references survive but temporary screenshot paths cannot leave the PC',()=>{
  const path='metaengine-chat-artifacts/be421a54-a43b-43ed-a930-4e4e79af7dd0/06da9a8b-6356-478c-a467-3d6c0ad53e54/'+'a'.repeat(64)+'.png';
  const input={terminal:true,receipt:{result:{result:{
    schema:'metaengine.windows-computer-executor.capture.v1',
    png_path:'C:\\Users\\Owner\\AppData\\Local\\Temp\\capture.png',
    png_sha256:'a'.repeat(64),
    artifact:{repository:'fixture/private-control',path,sha256:'a'.repeat(64),bytes:1234,mime_type:'image/png'},
  }}}};
  const result=project(input);
  assert.equal(result.receipt.result.result.png_path,'[REDACTED]');
  assert.equal(result.receipt.result.result.artifact.path,path);
  assert.equal(result.receipt.result.result.artifact.sha256,'a'.repeat(64));
});

test('GitHub egress fails closed for recursive data, oversized outputs, depth and proto pollution',()=>{
  const recursive={state:'READY'};recursive.self=recursive;
  assert.equal(project(recursive).state,'RESULT_UNAVAILABLE');
  assert.equal(project({message:'x'.repeat(1600)}).message,'[REDACTED_UNREVIEWED_TEXT]');
  assert.equal(project({events:Array.from({length:300},()=>1)}).state,'RESULT_UNAVAILABLE');
  assert.equal(project({files:Array.from({length:250},()=>({schema:'x'.repeat(150)}))}).state,'RESULT_UNAVAILABLE');
  const polluted=JSON.parse('{"__proto__":{"isAdmin":true},"state":"READY"}');
  const publicReply=project(polluted);
  assert.equal(publicReply.state,'READY');
  assert.equal(Object.hasOwn(publicReply,'__proto__'),false);
  assert.equal({}.isAdmin,undefined);
});
