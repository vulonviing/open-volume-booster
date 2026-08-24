#!/usr/bin/env python3
"""Generates the extension's icon set (16/32/48/128 px PNG) with Pillow.

Draws a simple speaker-with-soundwaves glyph on a rounded dark tile. No
external assets, no network access — re-run any time to regenerate
extension/icons/*.png after a design tweak.

Usage: python3 tools/generate-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "extension" / "icons"
SIZES = (16, 32, 48, 128)

BG = (24, 24, 27, 255)        # near-black tile
ACCENT = (255, 138, 61, 255)  # orange speaker + waves


def draw_icon(size: int) -> Image.Image:
    # Render at 4x and downsample for clean anti-aliasing at small sizes.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = s * 0.08
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.22, fill=BG)

    cx, cy = s * 0.42, s * 0.5
    body_w, body_h = s * 0.16, s * 0.30
    # Speaker box
    d.rectangle(
        [cx - body_w, cy - body_h / 2, cx, cy + body_h / 2],
        fill=ACCENT,
    )
    # Speaker cone (triangle flaring left)
    cone = [
        (cx - body_w, cy - body_h / 2),
        (cx - body_w - s * 0.14, cy - s * 0.22),
        (cx - body_w - s * 0.14, cy + s * 0.22),
        (cx - body_w, cy + body_h / 2),
    ]
    d.polygon(cone, fill=ACCENT)

    # Sound waves: three concentric arcs to the right
    for i, r in enumerate((s * 0.10, s * 0.18, s * 0.26)):
        bbox = [cx - r, cy - r, cx + r, cy + r]
        width = max(2 * scale, int(s * 0.035))
        d.arc(bbox, start=-45, end=45, fill=ACCENT, width=width)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        icon = draw_icon(size)
        path = OUT_DIR / f"{size}.png"
        icon.save(path)
        print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    main()
