import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withFixtureRoot, checkedFixtureFile, writeFixture, truncateFixture, enospcFaultingSink, incompleteJsonlTail} from './fixture-tools.mjs';

test('fixture writes only an exclusive temporary file', async () => {
  await withFixtureRoot(async root => {
    const f = await writeFixture(root, 'fixture.log', Buffer.from('abc'));
    assert.equal((await readFile(f)).toString(), 'abc');
    await assert.rejects(writeFixture(root, 'fixture.log', Buffer.from('x')), {code: 'EEXIST'});
  });
});

test('truncation cuts exactly in a fixture tail', async () => {
  await withFixtureRoot(async root => {
    const file = await writeFixture(root, 'tail.log', incompleteJsonlTail([{id: 'confirmed'}], '{"id":"pending"'));
    const original = await readFile(file);
    const cut = await truncateFixture(root, file, original.length - 5);
    assert.ok(cut.length < original.length);
    assert.equal(cut.toString().split('\n')[0], JSON.stringify({id:'confirmed'}));
  });
});

test('a torn legacy line is preserved as bytes, not upgraded into an ACK by fixtures', () => {
  const bytes = incompleteJsonlTail([{type:'delivery-confirmed', id:'a'}], '{"type":"assistant-start"');
  const lines = bytes.toString().split('\n');
  assert.equal(JSON.parse(lines[0]).id, 'a');
  assert.throws(() => JSON.parse(lines[1]), SyntaxError);
});

test('synthetic ENOSPC may tear tail but cannot report append success', async () => {
  const s = enospcFaultingSink(5, Buffer.from('abc'));
  await assert.rejects(s.append(Buffer.from('defg')), {code: 'ENOSPC'});
  assert.equal(s.inspect().toString(), 'abcde');
});

test('synthetic ENOSPC when full leaves original bytes unchanged', async () => {
  const s = enospcFaultingSink(3, Buffer.from('abc'));
  await assert.rejects(s.append(Buffer.from('def')), {code: 'ENOSPC'});
  assert.equal(s.inspect().toString(), 'abc');
});

test('fixture mutation rejects out-of-root path', async () => {
  await withFixtureRoot(async root => {
    await assert.rejects(checkedFixtureFile(root, '/etc/hosts'), /fixture path must stay/);
    await assert.rejects(truncateFixture(root, join(root, 'absent.log'), 0), {code:'ENOENT'});
  });
});

test('fixture mutation cannot extend a journal', async () => {
  await withFixtureRoot(async root => {
    const f=await writeFixture(root, 'bytes.log', Buffer.from('abc'));
    await assert.rejects(truncateFixture(root, f, 4), /never extend/);
    assert.equal((await readFile(f)).length, 3);
  });
});
