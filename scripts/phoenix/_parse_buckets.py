import json
buckets = json.load(open('/tmp/sb-buckets.json'))
print(f"  Buckets: {len(buckets)}")
for b in buckets:
    print(f"    - {b.get('name')} (public={b.get('public')}, file_size_limit={b.get('file_size_limit')}, allowed_mime={b.get('allowed_mime_types')})")
