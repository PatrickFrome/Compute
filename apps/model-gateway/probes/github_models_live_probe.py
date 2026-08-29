#!/usr/bin/env python3
import json
import os
import urllib.error
import urllib.request

TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
if not TOKEN:
    raise SystemExit("missing_github_token")

API_VERSION = "2026-03-10"
HEADERS = {
    "Accept": "application/vnd.github+json",
    "Authorization": f"Bearer {TOKEN}",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "METAENGINE-GitHub-Models-Live-Probe/1",
}


def request_json(url, method="GET", body=None, timeout=60):
    headers = dict(HEADERS)
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = {"raw": raw[:1000]}
        return e.code, payload


def load_catalog():
    for url in (
        f"https://models.github.ai/catalog/models?api-version={API_VERSION}",
        "https://models.github.ai/catalog/models",
    ):
        status, payload = request_json(url)
        if status != 200:
            print("CATALOG_ENDPOINT", json.dumps({"url": url, "status": status, "error": payload}))
            continue
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in ("data", "models", "items"):
                if isinstance(payload.get(key), list):
                    return payload[key]
    return []


def model_id(item):
    if not isinstance(item, dict):
        return None
    for key in ("id", "model"):
        value = item.get(key)
        if isinstance(value, str) and "/" in value:
            return value
    return None


def candidates_from_catalog(models):
    families = [
        ("claude", ("anthropic", "claude")),
        ("gemini", ("google", "gemini")),
        ("deepseek", ("deepseek",)),
        ("grok", ("xai", "grok")),
        ("qwen", ("alibaba", "qwen")),
        ("glm", ("zai", "z.ai", "glm")),
        ("mistral", ("mistral",)),
        ("llama", ("meta", "llama")),
        ("phi", ("microsoft", "phi")),
        ("openai", ("openai",)),
    ]
    out = []
    for family, needles in families:
        matches = []
        for item in models:
            mid = model_id(item)
            if not mid:
                continue
            hay = json.dumps(item, ensure_ascii=False).lower()
            if any(n in hay for n in needles):
                matches.append(mid)
        for mid in sorted(set(matches), reverse=True)[:3]:
            out.append((family, mid))
    return out


FALLBACK = [
    ("deepseek", "deepseek/DeepSeek-R1"),
    ("grok", "xai/grok-3-mini"),
    ("phi", "microsoft/Phi-4-mini-instruct"),
    ("llama", "meta/Llama-4-Scout-17B-16E-Instruct"),
    ("mistral", "mistral-ai/Mistral-Small-3.1"),
    ("openai", "openai/gpt-4.1"),
]

models = load_catalog()
candidates = candidates_from_catalog(models) or FALLBACK
print("GITHUB_MODELS_CATALOG", json.dumps({"count": len(models), "candidates": candidates[:24]}))

successes, attempts, successful_families = [], [], set()
for family, mid in candidates:
    if family in successful_families:
        continue
    if len(successes) >= 4 or len(attempts) >= 12:
        break
    marker = f"METAENGINE_{family.upper()}_CONNECTED"
    status, payload = request_json(
        "https://models.github.ai/inference/chat/completions",
        "POST",
        {
            "model": mid,
            "messages": [{"role": "user", "content": f"Reply with exactly this marker and nothing else: {marker}"}],
            "temperature": 0,
            "max_tokens": 32,
            "stream": False,
        },
    )
    served = payload.get("model") if isinstance(payload, dict) else None
    text = None
    if isinstance(payload, dict) and isinstance(payload.get("choices"), list) and payload["choices"]:
        choice = payload["choices"][0]
        if isinstance(choice, dict) and isinstance(choice.get("message"), dict):
            text = choice["message"].get("content")
    ok = status == 200 and isinstance(text, str) and marker in text
    record = {
        "family": family,
        "requested_model": mid,
        "http_status": status,
        "served_model": served,
        "marker_seen": ok,
        "text": text[:300] if isinstance(text, str) else None,
    }
    if not ok and isinstance(payload, dict):
        record["error"] = payload.get("message") or payload.get("error") or payload.get("detail")
    attempts.append(record)
    print("GITHUB_MODELS_PROBE", json.dumps(record, ensure_ascii=False))
    if ok:
        successes.append(record)
        successful_families.add(family)

summary = {
    "schema": "metaengine.github-models-live-probe.v1",
    "catalog_count": len(models),
    "success_count": len(successes),
    "successes": successes,
    "attempts": attempts,
}
print("GITHUB_MODELS_SUMMARY", json.dumps(summary, ensure_ascii=False))
if not successes:
    raise SystemExit("github_models_live_inference_unavailable")
