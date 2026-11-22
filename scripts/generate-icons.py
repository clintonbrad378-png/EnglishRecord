from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SIZE = 1024
START = (255, 138, 107)
END = (216, 52, 44)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size=1024, maskable=False):
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            r, g, b = lerp(START, END, t)
            glow = max(0.0, 1.0 - (((x / size - 0.32) ** 2 + (y / size - 0.18) ** 2) ** 0.5) / 0.62)
            lift = int(22 * glow)
            pixels[x, y] = (min(255, r + lift), min(255, g + lift), min(255, b + lift))

    draw = ImageDraw.Draw(image, "RGBA")
    halo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    halo_draw.ellipse(
        (size * 0.15, size * 0.12, size * 0.85, size * 0.82),
        fill=(255, 255, 255, 16),
    )
    halo = halo.filter(ImageFilter.GaussianBlur(size * 0.06))
    image = Image.alpha_composite(image.convert("RGBA"), halo)

    draw = ImageDraw.Draw(image, "RGBA")
    scale = 0.64 if maskable else 0.78
    width = size * 0.075
    gap = size * 0.043
    heights = [0.36, 0.62, 0.82, 0.52]
    max_height = size * scale * 0.72
    total_width = len(heights) * width + (len(heights) - 1) * gap
    left = (size - total_width) / 2
    center_y = size * 0.5
    radius = width / 2

    for index, factor in enumerate(heights):
        bar_height = max_height * factor
        x0 = left + index * (width + gap)
        y0 = center_y - bar_height / 2
        draw.rounded_rectangle(
            (x0, y0, x0 + width, y0 + bar_height),
            radius=radius,
            fill=(255, 255, 255, 246 if index in (1, 2) else 220),
        )

    return image.convert("RGB")


if __name__ == "__main__":
    icon = make_icon(SIZE)
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "icon-512.png", optimize=True)
    icon.resize((192, 192), Image.Resampling.LANCZOS).save(OUT / "icon-192.png", optimize=True)
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)
    maskable = make_icon(SIZE, maskable=True)
    maskable.resize((512, 512), Image.Resampling.LANCZOS).save(
        OUT / "icon-maskable-512.png", optimize=True
    )
    print("Iconos generados en public/icons")
