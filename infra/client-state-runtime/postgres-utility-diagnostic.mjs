// Pure finite diagnostic classifier for postgres CLI subprocesses.
// stderr is private, untrusted and discarded after local classification.
// NEVER append stderr, database names, SQL, connection URLs, or role names to receipts.
const CATEGORIES = Object.freeze({
  auth:'auth_failed',
  permission:'permission_denied',
  rls:'row_security_denied',
  connection:'connection_refused',
  unavailable:'server_unavailable',
  timeout:'query_timeout',
  database:'database_missing',
  generic:'query_failed',
});
const OPS = new Set(['inspection','backup']);
// SQLSTATE is stable across PostgreSQL message locale and suppresses private
// context in psql VERBOSITY=sqlstate. Unknown codes remain fail-closed.
const SQLSTATE_KIND = Object.freeze({
  '28P01': CATEGORIES.auth, '28000': CATEGORIES.auth,
  '42501': CATEGORIES.permission,
  '08001': CATEGORIES.connection, '08006': CATEGORIES.connection, '08004': CATEGORIES.connection,
  '57P01': CATEGORIES.unavailable, '57P02': CATEGORIES.unavailable,
  '57P03': CATEGORIES.unavailable, '53300': CATEGORIES.unavailable,
  '57014': CATEGORIES.timeout, '55P03': CATEGORIES.timeout,
  '3D000': CATEGORIES.database,
});

export function classifyPostgresUtilityFailure(stderr, operation='inspection') {
  if (!OPS.has(operation)) throw new Error('postgres_diagnostic_operation_invalid');
  // Hard bound memory and parsing. A diagnostic line is never an authority input.
  const sample = typeof stderr === 'string' ? stderr.slice(0, 16384)
    : Buffer.isBuffer(stderr) ? stderr.subarray(0, 16384).toString('utf8') : '';
  // With psql -v VERBOSITY=sqlstate, server-side failures emit only
  // severity and five-character code; pre-connection libpq failures still
  // fall back to bounded keyword classification. Never persist either text.
  const sqlstate = sample.split(/\r?\n/).map(line =>
    line.trim().match(/^(?:(?:ERROR|FATAL|PANIC):\s*)?(?:SQLSTATE\s*[:=]?\s*)?([A-Z0-9]{5})$/i)?.[1]
  ).find(Boolean)?.toUpperCase();
  let kind = SQLSTATE_KIND[sqlstate] || CATEGORIES.generic;
  if (!SQLSTATE_KIND[sqlstate]) {
  if (/row.level security|row_security|policy.*prevent.*dump/i.test(sample)
    && /permission|security|restrict|error|denied/i.test(sample)) kind=CATEGORIES.rls;
  else if (/password authentication failed|no password supplied|fe_sendauth|SQLSTATE[ :]+28P01|authentication failed|role [^\r\n]+ does not exist/i.test(sample)) kind=CATEGORIES.auth;
  else if (/permission denied|must be superuser|must be member of|insufficient privilege|SQLSTATE[ :]+42501|not permitted to/i.test(sample)) kind=CATEGORIES.permission;
  else if (/connection refused|could not connect to server|no route to host|SQLSTATE[ :]+08006/i.test(sample)) kind=CATEGORIES.connection;
  else if (/the database system is starting up|database system is shutting down|cannot connect now|too many connections|SQLSTATE[ :]+57P03|SQLSTATE[ :]+53300/i.test(sample)) kind=CATEGORIES.unavailable;
  else if (/canceling statement due to (?:statement|lock) timeout|SQLSTATE[ :]+57014|connection timed out/i.test(sample)) kind=CATEGORIES.timeout;
  else if (/database [^\r\n]+ does not exist|SQLSTATE[ :]+3D000/i.test(sample)) kind=CATEGORIES.database;
  }
  return Object.freeze({
    schema:'metaengine.postgres-utility-diagnostic.v1',
    code:`postgres_${operation}_${kind}`,
    operation, private_text_included:false,
    raw_stderr_retained:false,
    retry_authorized:false, authority_effect:false,
  });
}
