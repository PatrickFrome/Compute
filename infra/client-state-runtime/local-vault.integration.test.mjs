import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';

const adminUrl = process.env.LOCAL_STATE_TEST_ADMIN_DATABASE_URL;

test('private pgcrypto vault preserves plaintext semantics and fails ciphertext rebinding', { skip: !adminUrl }, async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(adminUrl).hostname));
  const sql = postgres(adminUrl, { max: 1, prepare: false });
  const name = 'local-vault-test-' + randomUUID();
  const secret = 'test-only-' + randomUUID();
  let id;
  try {
    const [created] = await sql.unsafe('SELECT vault.create_secret($1::text, $2::text, $3::text) AS id', [secret, name, 'integration fixture']);
    id = created.id;
    const [stored] = await sql.unsafe('SELECT secret, nonce FROM vault.secrets WHERE id = $1::uuid', [id]);
    assert.notEqual(stored.secret, secret);
    assert.equal(Buffer.from(stored.secret, 'base64').includes(Buffer.from(secret)), false);
    assert.equal(stored.nonce.length, 24);
    const [decrypted] = await sql.unsafe('SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1::uuid', [id]);
    assert.equal(decrypted.decrypted_secret, secret);
    await sql.unsafe('SELECT vault.update_secret($1::uuid,$2::text)', [id, secret + '-changed']);
    const [updated] = await sql.unsafe('SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1::uuid', [id]);
    assert.equal(updated.decrypted_secret, secret + '-changed');
    const [current] = await sql.unsafe('SELECT secret, nonce FROM vault.secrets WHERE id = $1::uuid', [id]);
    await assert.rejects(sql.unsafe("SELECT vault._crypto_aead_det_decrypt(decode($1,'base64'),convert_to($2,'utf8'),0,'pgsodium'::bytea,$3::bytea)", [current.secret, randomUUID(), current.nonce]), (error) => error.code === '22000');
    await assert.rejects(sql.unsafe("SELECT vault._crypto_aead_det_decrypt(decode($1,'base64'),convert_to($2,'utf8'),0,'pgsodium'::bytea,$3::bytea)", [current.secret, id, Buffer.alloc(24)]), (error) => error.code === '22000');
    const denied = await sql.unsafe("SELECT rolname, has_schema_privilege(rolname,'vault','USAGE') AS usage FROM pg_roles WHERE rolname IN ('anon','authenticated')");
    for (const role of denied) assert.equal(role.usage, false);
    const [publicAccess] = await sql.unsafe("SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='vault' AND a.grantee=0 AND a.privilege_type='EXECUTE') AS enabled");
    assert.equal(publicAccess.enabled, false);
    if ((await sql.unsafe("SELECT 1 FROM pg_roles WHERE rolname='service_role'")).length) {
      const [roleRead] = await sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE service_role');
        return tx.unsafe('SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1::uuid', [id]);
      });
      assert.equal(roleRead.decrypted_secret, secret + '-changed');
      await assert.rejects(sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE service_role');
        await tx.unsafe('SELECT vault._local_key()');
      }), (error) => error.code === '42501');
    }
    const [data] = await sql.unsafe("SELECT current_setting('data_directory') AS directory");
    const key = (await readFile(data.directory + '/client-vault.key', 'utf8')).trim();
    const [definitions] = await sql.unsafe("SELECT string_agg(pg_get_functiondef(p.oid),'') AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vault'");
    assert.equal(definitions.definition.includes(key), false);
  } finally {
    if (id) await sql.unsafe('DELETE FROM vault.secrets WHERE id=$1::uuid AND name=$2', [id, name]);
    await sql.end({ timeout: 5 });
  }
});
