import json
try:
    objs = json.load(open('/tmp/sb-obj.json'))
    for o in objs[:100]:
        kind = 'DIR ' if o.get('id') is None else 'FILE'
        size = o.get('metadata', {}).get('size', '?')
        upd = o.get('updated_at', '')[:19]
        print(f"    {kind} {o.get('name')}  ({size}B, upd={upd})")
except Exception as e:
    print("    (parse error)", e)
