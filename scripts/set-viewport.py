import asyncio, json, sys, os

try:
    from websockets import connect
except ImportError:
    os.system("pip install websockets -q")
    from websockets import connect


async def main():
    url = sys.argv[1]
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 390
    async with connect(url, max_size=10**8) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Target.getTargets"}))
        targets = None
        for _ in range(10):
            r = json.loads(await ws.recv())
            res = r.get("result") or {}
            if "targetInfos" in res:
                targets = res["targetInfos"]
                break
        pages = [t for t in targets if t["type"] == "page"]
        for p in pages:
            print("page:", p["targetId"][:10], p.get("url", "")[:60])
        # pick page whose url contains localhost:81 (the console)
        page = None
        for p in pages:
            if ":81" in p.get("url", "") or "localhost" in p.get("url", ""):
                page = p
                break
        if page is None and pages:
            page = pages[-1]
        if page is None:
            print("NO PAGE TARGET")
            return
        sid = page["targetId"]
        await ws.send(json.dumps({
            "id": 2,
            "method": "Target.attachToTarget",
            "params": {"targetId": sid, "flatten": True},
        }))
        sid2 = None
        for _ in range(10):
            r = json.loads(await ws.recv())
            res = r.get("result") or {}
            if "sessionId" in res:
                sid2 = res["sessionId"]
                break
        await ws.send(json.dumps({
            "id": 3,
            "method": "Emulation.setDeviceMetricsOverride",
            "params": {"width": width, "height": 844, "deviceScaleFactor": 2, "mobile": True},
            "sessionId": sid2,
        }))
        print("viewport set %dx844 on %s" % (width, page.get("url", "?")[:50]))

asyncio.run(main())
