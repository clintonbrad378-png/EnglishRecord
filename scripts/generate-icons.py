from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SIZE = 1024
START = (242, 84, 65)
END = (217, 62, 48)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_base(size=1024):
    bg = Image.new("RGB", (size, size))
    px = bg.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            r, g, b = lerp(START, END, t)
            glow = max(0.0, 1.0 - (((x / size - 0.30) ** 2 + (y / size - 0.22) ** 2) ** 0.5) / 0.75)
            lift = int(28 * glow)
            px[x, y] = (min(255, r + lift), min(255, g + lift), min(255, b + lift))
    img = bg.convert("RGBA")
    halo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse((size * 0.12, size * 0.08, size * 0.88, size * 0.84), fill=(255, 255, 255, 18))
    halo = halo.filter(ImageFilter.GaussianBlur(size * 0.07))
    return Image.alpha_composite(img, halo)


def draw_mark(draw, size, cx, cy, scale=1.0, alpha=245):
    width = size * 0.072 * scale
    gap = size * 0.042 * scale
    heights = [0.34, 0.60, 0.82, 0.50]
    max_h = size * 0.46 * scale
    total_w = len(heights) * width + (len(heights) - 1) * gap
    left = cx - total_w / 2
    radius = width / 2
    for i, f in enumerate(heights):
        bh = max_h * f
        x0 = left + i * (width + gap)
        y0 = cy - bh / 2
        a = alpha if i in (1, 2) else int(alpha * 0.88)
        draw.rounded_rectangle((x0, y0, x0 + width, y0 + bh), radius=radius, fill=(255, 255, 255, a))


def make_icon(size=1024, maskable=False):
    img = make_base(size)
    d = ImageDraw.Draw(img)
    draw_mark(d, size, size / 2, size * 0.50, scale=0.72 if maskable else 0.9)
    return img.convert("RGB")


if __name__ == "__main__":
    icon = make_icon(SIZE)
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "icon-512.png", optimize=True)
    icon.resize((192, 192), Image.Resampling.LANCZOS).save(OUT / "icon-192.png", optimize=True)
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)
    make_icon(SIZE, maskable=True).resize((512, 512), Image.Resampling.LANCZOS).save(
        OUT / "icon-maskable-512.png", optimize=True
    )
    print("Iconos generados en public/icons")
