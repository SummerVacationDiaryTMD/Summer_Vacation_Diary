# Regenerates src/assets/handwrites/processed/ from the raw scans in
# src/assets/handwrites/. Run from the repository root:
#
#   python3 scripts/process_handwrites.py   (needs: pip install pillow numpy)
#
# The raw exports are flattened onto an opaque white background, so we
# reconstruct transparency instead of chroma-keying: the ink is a single
# red crayon color, so per-pixel opacity can be recovered from how far the
# pixel is from white (alpha ~ 255 - min(R,G,B)). We then emit a
# solid-ink-color image whose texture lives entirely in the alpha channel —
# this avoids the white fringing a naive "make white transparent" pass
# leaves on anti-aliased stroke edges.
import os

import numpy as np
from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "handwrites")
DST = os.path.join(SRC, "processed")
# Star variants are excluded for now: their ink bbox is larger than the
# ellipse itself, so stretching them onto a text run would shrink the circle.
FILES = [
    "circle1.png",
    "circle2.png",
    "circle3.png",
    "circle4.png",
    "circle5.png",
    "line1.png",
    "line2.png",
    "line3.png",
]
MAX_DIM = 1000  # largest render target is ~900px on the export canvas
PAD = 8  # keep a hair of breathing room around the ink
ALPHA_FLOOR = 8  # treat near-white noise as fully transparent

os.makedirs(DST, exist_ok=True)

for name in FILES:
    rgb = np.asarray(
        Image.open(os.path.join(SRC, name)).convert("RGB"), dtype=np.float32
    )
    # Distance from white on the least-red channel == ink coverage.
    coverage = 255.0 - rgb.min(axis=2)
    # Normalize so the darkest ink becomes fully opaque.
    peak = coverage.max()
    alpha = np.clip(coverage * (255.0 / peak), 0, 255)
    alpha[alpha < ALPHA_FLOOR] = 0

    # Ink color = coverage-weighted average of the strongest pixels,
    # un-blended from white so light crayon grain doesn't wash it out.
    strong = alpha > 200
    a = (alpha[strong] / 255.0)[:, None]
    ink = ((rgb[strong] - 255.0 * (1.0 - a)) / a).clip(0, 255).mean(axis=0)

    out = np.empty((*alpha.shape, 4), dtype=np.uint8)
    out[..., :3] = ink.astype(np.uint8)
    out[..., 3] = alpha.astype(np.uint8)
    img = Image.fromarray(out, "RGBA")

    left, top, right, bottom = img.getchannel("A").getbbox()
    left, top = max(0, left - PAD), max(0, top - PAD)
    right, bottom = min(img.width, right + PAD), min(img.height, bottom + PAD)
    img = img.crop((left, top, right, bottom))

    scale = min(1.0, MAX_DIM / max(img.size))
    if scale < 1.0:
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.LANCZOS,
        )

    path = os.path.join(DST, name)
    img.save(path, optimize=True)
    kb = os.path.getsize(path) / 1024
    print(
        f"{name}: ink rgb={tuple(int(c) for c in ink)}, "
        f"out {img.width}x{img.height} (aspect {img.width / img.height:.2f}), {kb:.0f}KB"
    )
