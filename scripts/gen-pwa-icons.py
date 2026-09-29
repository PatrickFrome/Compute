#!/usr/bin/env python3
# gen-pwa-icons.py — EV-PWA icons for ME2 Mission Control manifest.
# zinc-950 bg (#09090b), emerald swarm-node glyph. Maskable-safe (80% zone).
from PIL import Image, ImageDraw
import os

OUT = "/home/z/my-project/public/icons"
os.makedirs(OUT, exist_ok=True)
BG = (9, 9, 11, 255)        # zinc-950
FG = (52, 211, 153, 255)    # emerald-400
DIM = (63, 63, 70, 255)     # zinc-700

def make(size, art_ratio):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    s = size * art_ratio  # art scale
    cx = cy = size / 2
    # central node + orbit nodes (swarm metaphor)
    r0 = s * 0.13
    d.ellipse([cx - r0, cy - r0, cx + r0, cy + r0], fill=FG)
    import math
    ring = s * 0.30
    r1 = s * 0.085
    for i in range(6):
        a = math.pi / 3 * i + math.pi / 6
        x, y = cx + ring * math.cos(a), cy + ring * math.sin(a)
        d.ellipse([x - r1, y - r1, x + r1, y + r1], fill=FG)
        # spokes
        d.line([cx, cy, x, y], fill=DIM, width=max(2, int(s * 0.02)))
    d.ellipse([cx - ring, cy - ring, cx + ring, cy + ring], outline=DIM, width=max(2, int(s * 0.015)))
    return img

# Regular icons (art fills more), maskable-safe versions (80% safe zone)
make(192, 0.82).save(f"{OUT}/icon-192.png")
make(512, 0.82).save(f"{OUT}/icon-512.png")
make(512, 0.62).save(f"{OUT}/icon-512-maskable.png")
make(180, 0.86).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
for f in sorted(os.listdir(OUT)):
    p = f"{OUT}/{f}"
    print(f, os.path.getsize(p), "B")
