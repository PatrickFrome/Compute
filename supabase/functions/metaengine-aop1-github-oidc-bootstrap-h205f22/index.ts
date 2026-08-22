import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => new Response(JSON.stringify({
  error: "bootstrap_retired",
  replacement: "metaengine-aop1-github-oidc-deploy-h205f22",
  canonical: false,
  authority_effect: false
}), {
  status: 410,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff"
  }
}));
