import json
spec = json.load(open('/tmp/sb-root.json'))
paths = spec.get('paths', {})
tables = {}
for p in paths:
    if p.startswith('/'):
        name = p.strip('/').split('{')[0]
        if name:
            tables[name] = True
print(f"  Tables/views exposed via REST: {len(tables)}")
for t in sorted(tables):
    print(f"    - {t}")
