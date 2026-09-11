#!/usr/bin/env python3
"""Regenerate the image assets under frontend/public/.

Why this exists: the case-study photos were committed at full camera
resolution (up to 2134x1600, 1.17 MB combined) and the favicon was a
512x512 / 107 KB PNG, yet the UI renders the photos in ~600 CSS px
cards and the favicon in a 16-32 px slot. Serving the originals cost
bytes the layout never used.

Run from the repo root:  python frontend/scripts/optimize-assets.py
Requires: pillow  (pip install pillow)

The OPPO Sans font is deliberately NOT touched here: its licence
forbids modification, so it cannot be subset (see docs/ISSUES.md BUG-99).
"""

from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"

# Rendered width of a case-study card is ~600 CSS px; 1200 px covers 2x DPR.
PHOTO_WIDTH = 1200
PHOTO_QUALITY = 80
# 180x180 is the size iOS asks for.
APPLE_TOUCH_SIZE = (180, 180)
# 64x64 rather than the usual 32x32: the mark is a fine-line deer + "study"
# wordmark, and at 32px the hairlines smear into a blob. 64px is still only
# ~7 KB (down from 107 KB) and stays legible in the tab strip.
FAVICON_SIZE = (64, 64)


def report(path: Path) -> None:
    print(f"  {path.name:28s} {path.stat().st_size:>9,} B")


def write_photo(src: Path, dst: Path) -> None:
    """Downscale a photo to PHOTO_WIDTH and re-encode as WebP."""
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > PHOTO_WIDTH:
            height = round(im.height * PHOTO_WIDTH / im.width)
            im = im.resize((PHOTO_WIDTH, height), Image.LANCZOS)
        im.save(dst, "WEBP", quality=PHOTO_QUALITY, method=6)


def write_icon(src: Path, dst: Path, size: tuple[int, int]) -> None:
    """Resize an icon to `size`, preserving transparency."""
    with Image.open(src) as im:
        im = im.convert("RGBA").resize(size, Image.LANCZOS)
        im.save(dst, "PNG", optimize=True)


def main() -> None:
    print("== photos -> webp ==")
    for name in ("final-lecture", "freshman-guide", "peer-support", "resource-sharing"):
        # Sources may be .jpeg or .png depending on which one is present.
        src = next(p for p in (PUBLIC / "images").glob(f"{name}.*") if p.suffix != ".webp")
        dst = PUBLIC / "images" / f"{name}.webp"
        before = src.stat().st_size
        write_photo(src, dst)
        print(f"  {src.name:28s} {before:>9,} B  ->  {dst.name} {dst.stat().st_size:>9,} B")
        src.unlink()

    print("== icons ==")
    favicon = PUBLIC / "favicon.png"
    # Read the 512x512 original before overwriting it in place.
    tmp = PUBLIC / ".favicon-original.png"
    tmp.write_bytes(favicon.read_bytes())
    write_icon(tmp, favicon, FAVICON_SIZE)
    tmp.unlink()

    apple = PUBLIC / "apple-touch-icon.png"
    tmp = PUBLIC / ".apple-original.png"
    tmp.write_bytes(apple.read_bytes())
    write_icon(tmp, apple, APPLE_TOUCH_SIZE)
    tmp.unlink()

    print()
    print("== result ==")
    for p in sorted(PUBLIC.rglob("*")):
        if p.is_file() and p.suffix != ".txt":
            report(p)


if __name__ == "__main__":
    main()
