export function supabaseBackendHeaders(key) {
  const value = String(key || '').trim();
  if (!value) throw new Error('supabase_backend_key_missing');
  if (value.startsWith('sb_publishable_')) {
    throw new Error('supabase_backend_secret_required');
  }

  const headers = { apikey: value };
  // Opaque sb_secret keys authenticate through the apikey header and are not
  // JWTs. Legacy service_role keys still require the Bearer header so
  // PostgREST assumes the service_role claim.
  if (!value.startsWith('sb_secret_')) {
    headers.authorization = `Bearer ${value}`;
  }
  return headers;
}
