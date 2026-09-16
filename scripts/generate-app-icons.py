#!/usr/bin/env python3
"""Generate every app icon, adaptive icon layer, splash and favicon from the
single brand logo source.

Source (committed):

    apps/mobile/assets/brand/logo.png

That file is the ATLITOS lockup on its own dark ground with rounded corners,
extracted from the Figma document. It is 384x384 with roughly 268x146 of actual
artwork, so every icon larger than that is an upscale. LANCZOS plus a mild
unsharp pass recovers most of the edge definition on flat art like this; see
the header note in `upscale` for why. Replacing logo.png with a higher
resolution export and re-running is the only change needed to sharpen every
output at once.

The ground color is sampled from the source rather than written here, so the
icons stay faithful to the artwork if it is ever re-exported on a different
ground.

Usage:
    python3 scripts/generate-app-icons.py            write the files
    python3 scripts/generate-app-icons.py --check    report only, exit 1 on drift
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/mobile/assets/brand/logo.png"
MOBILE_IMAGES = ROOT / "apps/mobile/assets/images"

# Android masks adaptive icons to an arbitrary launcher shape. Only the centre
# 66/108 of the canvas is guaranteed visible and a circle is the common worst
# case, so the artwork is fitted inside a slightly tighter box than that.
ANDROID_SAFE_FRACTION = 0.58

# iOS applies its own squircle mask and rejects alpha, so the artwork is inset
# on a full bleed ground rather than reusing the source's rounded corners.
#
# 0.7992 rather than a round number because it is derived, not picked: the
# home screen draws this icon at 60pt, and the founder asked for the mark to
# come down by ~1.25pt at that size. 0.82 - 1.25/60 = 0.7992, i.e. 818px of
# artwork on the 1024px canvas instead of 840px.
IOS_ART_FRACTION = 0.7992

# Distance from the ground color, summed across RGB, past which a pixel counts
# as artwork rather than background. Comfortably below the nearest real color.
ART_THRESHOLD = 60

# The source's rounded corners antialias into the ground and would otherwise
# widen the artwork bounding box to the full canvas.
BORDER_RING = 10


def load_source() -> Image.Image:
    if not SOURCE.exists():
        raise SystemExit(
            f"generate-app-icons: missing source {SOURCE.relative_to(ROOT)}\n"
            "Export the logo from Figma and save it there."
        )
    return Image.open(SOURCE).convert("RGBA")


def sample_ground(image: Image.Image) -> tuple[int, int, int]:
    """The most common fully opaque color is the logo's ground."""
    opaque = [px[:3] for px in image.getdata() if px[3] == 255]
    if not opaque:
        raise SystemExit("generate-app-icons: source has no opaque pixels")
    return Counter(opaque).most_common(1)[0][0]


def artwork_box(image: Image.Image, ground: tuple[int, int, int]) -> tuple[int, int, int, int]:
    """Bounding box of everything that is neither ground nor transparent."""
    data = np.array(image).astype(int)
    distance = np.abs(data[..., :3] - np.array(ground)).sum(axis=2)
    art = (data[..., 3] > 200) & (distance > ART_THRESHOLD)
    art[:BORDER_RING, :] = art[-BORDER_RING:, :] = False
    art[:, :BORDER_RING] = art[:, -BORDER_RING:] = False
    ys, xs = np.nonzero(art)
    if not len(xs):
        raise SystemExit("generate-app-icons: found no artwork against the ground color")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def knockout_ground(image: Image.Image, ground: tuple[int, int, int]) -> Image.Image:
    """Make the ground transparent, keeping the artwork and its antialiased edges.

    The artwork crop is a rectangle, so it carries ground pixels around and
    inside the lockup. Android composites the foreground over a separate
    background layer and derives the themed icon from alpha, so a foreground
    that is opaque edge to edge shows as a grey slab under launcher parallax
    and as a filled rectangle when tinted. Alpha is ramped rather than
    thresholded so edges do not go jagged.
    """
    data = np.array(image).astype(int)
    distance = np.abs(data[..., :3] - np.array(ground)).sum(axis=2)
    lo, hi = 30, 90
    ramp = np.clip((distance - lo) / (hi - lo), 0, 1)
    out = data.copy()
    out[..., 3] = (data[..., 3] * ramp).astype(int)
    return Image.fromarray(out.astype(np.uint8))


def upscale(image: Image.Image, width: int) -> Image.Image:
    """Resize, then tighten the edges.

    The source is flat color art with hard edges, which LANCZOS alone leaves
    visibly soft at these ratios. A mild unsharp pass restores most of the
    definition without ringing; a threshold keeps it off the flat interiors.
    """
    height = max(1, round(image.height * width / image.width))
    resized = image.resize((width, height), Image.LANCZOS)
    if width <= image.width:
        return resized
    return resized.filter(ImageFilter.UnsharpMask(radius=2.0, percent=110, threshold=2))


def fit_within(image: Image.Image, box: int) -> Image.Image:
    scale = box / max(image.size)
    return upscale(image, max(1, round(image.width * scale)))


def centre_on(canvas: Image.Image, art: Image.Image) -> Image.Image:
    out = canvas.copy()
    out.alpha_composite(art, ((canvas.width - art.width) // 2, (canvas.height - art.height) // 2))
    return out


def square(size: int, rgb: tuple[int, int, int] | None) -> Image.Image:
    return Image.new("RGBA", (size, size), (*rgb, 255) if rgb else (0, 0, 0, 0))


def silhouette(image: Image.Image) -> Image.Image:
    """Flatten to an alpha-driven shape, which is what Android tints."""
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.putalpha(image.getchannel("A"))
    return out


def sync_app_json_backgrounds(ground: tuple[int, int, int]) -> tuple[Path, bool]:
    """Point the native splash and the Android icon plate at the logo's ground.

    These two live in app.json, which cannot import a token, so they drift
    silently: the splash kept its old cream `#FBF7F1` behind a near-black
    icon, which reads on device as a white flash then a dark card. Deriving
    them from the artwork here means the launch background can never again
    disagree with the icon it sits behind.
    """
    import json
    from collections import OrderedDict

    path = ROOT / "apps/mobile/app.json"
    hex_ground = "#" + "".join(f"{c:02X}" for c in ground)
    data = json.loads(path.read_text(), object_pairs_hook=OrderedDict)
    expo = data["expo"]

    before = json.dumps(data)
    for plugin in expo.get("plugins", []):
        if isinstance(plugin, list) and plugin[0] == "expo-splash-screen":
            plugin[1]["backgroundColor"] = hex_ground
    adaptive = expo.get("android", {}).get("adaptiveIcon")
    if adaptive is not None:
        adaptive["backgroundColor"] = hex_ground

    rendered = json.dumps(data, indent=2) + "\n"
    changed = before != json.dumps(data)
    if changed and not CHECK_ONLY:
        path.write_text(rendered)
    return path, changed


def write_ico(source: Image.Image, path: Path) -> tuple[Path, bool]:
    """Multi-resolution .ico, which is what the browser tab and bookmarks use."""
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    buffer = BytesIO()
    upscale(source, 64).save(buffer, format="ICO", sizes=sizes)
    data = buffer.getvalue()
    changed = not path.exists() or path.read_bytes() != data
    if changed and not CHECK_ONLY:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path, changed


def write(image: Image.Image, path: Path, *, opaque: bool = False) -> tuple[Path, bool]:
    if opaque:
        image = image.convert("RGB")
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    data = buffer.getvalue()
    changed = not path.exists() or path.read_bytes() != data
    if changed and not CHECK_ONLY:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path, changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report drift without writing")
    args = parser.parse_args()

    global CHECK_ONLY
    CHECK_ONLY = args.check

    source = load_source()
    ground = sample_ground(source)
    art = source.crop(artwork_box(source, ground))

    print(f"  source   {SOURCE.relative_to(ROOT)}  {source.width}x{source.height}")
    print(f"  ground   #{''.join(f'{c:02X}' for c in ground)}")
    print(f"  artwork  {art.width}x{art.height}\n")

    results = []

    # iOS and the shared Expo icon. Opaque, full bleed ground: the App Store
    # rejects alpha, and iOS supplies its own corner mask.
    results.append(
        write(
            centre_on(square(1024, ground), fit_within(art, round(1024 * IOS_ART_FRACTION))),
            MOBILE_IMAGES / "icon.png",
            opaque=True,
        )
    )

    # Android adaptive icon, three layers. The foreground must be artwork only:
    # the ground is supplied by the background layer beneath it.
    foreground = fit_within(knockout_ground(art, ground), round(512 * ANDROID_SAFE_FRACTION))
    results.append(
        write(centre_on(square(512, None), foreground), MOBILE_IMAGES / "android-icon-foreground.png")
    )
    results.append(write(square(512, ground), MOBILE_IMAGES / "android-icon-background.png"))
    results.append(
        write(
            centre_on(square(512, None), silhouette(foreground)),
            MOBILE_IMAGES / "android-icon-monochrome.png",
        )
    )

    # Splash: the ARTWORK only, tightly cropped and transparent.
    #
    # This used to ship the whole badge, ground included. That made
    # `imageWidth` in app.json meaningless as a size control: the mark is only
    # ~54% of the badge's width, so a 122pt splash image drew a ~66pt logo and
    # the rest was ground that is invisible anyway now the splash background
    # is the same #141414. Cropping to the artwork makes `imageWidth` mean
    # exactly what it says, and the white parts still read because the splash
    # background is dark.
    results.append(
        write(upscale(knockout_ground(art, ground), 1024), MOBILE_IMAGES / "splash-icon.png")
    )

    results.append(write(upscale(source, 64), MOBILE_IMAGES / "favicon.png"))

    # The Next.js portals: App Router serves src/app/favicon.ico automatically
    # and injects the link tag, and that file wins over anything in public/, so
    # the .ico is the one that has to change.
    for app in ("portal-court", "portal-life"):
        results.append(write_ico(source, ROOT / "apps" / app / "src/app/favicon.ico"))

    # The landing site is plain static HTML with no build step, so it just gets
    # a PNG next to its other images. index.html and friends reference it
    # directly; see the link tags added alongside this change.
    results.append(write(upscale(source, 180), ROOT / "apps/landing/img/favicon.png"))

    results.append(sync_app_json_backgrounds(ground))

    changed = [p for p, c in results if c]
    for path, was_changed in results:
        print(f"  {'write' if was_changed else 'ok   '}  {path.relative_to(ROOT)}")

    if CHECK_ONLY and changed:
        print(f"\ngenerate-app-icons: {len(changed)} file(s) out of date, run without --check")
        return 1
    print(f"\ngenerate-app-icons: {len(changed)} written, {len(results) - len(changed)} unchanged")
    return 0


CHECK_ONLY = False

if __name__ == "__main__":
    sys.exit(main())
