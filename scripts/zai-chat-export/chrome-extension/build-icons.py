#!/usr/bin/env python3
"""Генерация иконок для Z.ai Chat Export (MV3): тёмный скруглённый квадрат + белая стрелка вниз в лоток."""
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 48, 128]
OUT = "/home/z/my-project/scripts/zai-chat-export/chrome-extension/icons"

import os
os.makedirs(OUT, exist_ok=True)

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, size // 5)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(17, 24, 39, 255))
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, outline=(16, 185, 129, 255), width=max(1, size // 32))
    # стрелка вниз: ствол + треугольник
    cx = size / 2
    stroke = max(2, size // 9)
    stem_top = size * 0.22
    stem_bot = size * 0.52
    d.rectangle([cx - stroke / 2, stem_top, cx + stroke / 2, stem_bot], fill=(255, 255, 255, 255))
    tri_w = size * 0.30
    tri_top = stem_bot
    tri_bot = size * 0.70
    d.polygon([(cx - tri_w / 2, tri_top), (cx + tri_w / 2, tri_top), (cx, tri_bot)], fill=(255, 255, 255, 255))
    # лоток
    tray_w = size * 0.62
    tray_top = size * 0.76
    tray_stroke = max(1, size // 24)
    d.rectangle([cx - tray_w / 2, tray_top, cx + tray_w / 2, tray_top + tray_stroke], fill=(16, 185, 129, 255))
    return img


try:
    font48 = ImageFont.truetype(FONT_PATH, 10)
except Exception:
    font48 = None

for s in SIZES:
    img = make_icon(s)
    img.save(f"{OUT}/icon{s}.png")
    print(f"icon{s}.png -> {img.size}")
