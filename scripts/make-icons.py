"""Draw the launcher icon (red tile, white fuel pump) and write every Android density."""
import os
import sys
from PIL import Image, ImageDraw

RED = (200, 40, 30, 255)
WHITE = (255, 255, 255, 255)


def pump(size: int, scale: float, bg: bool) -> Image.Image:
    s = 1024
    img = Image.new("RGBA", (s, s), RED if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = s / 64 * scale
    ox = oy = s / 2 - 32 * k
    P = lambda x, y: (ox + x * k, oy + y * k)
    d.rounded_rectangle([P(16, 14), P(38, 52)], radius=4 * k, fill=WHITE)
    d.rounded_rectangle([P(20, 19), P(34, 28)], radius=2 * k, fill=RED)
    w = int(4 * k)
    d.line([P(38, 24), P(44, 24)], fill=WHITE, width=w)
    d.line([P(48, 28), P(48, 42)], fill=WHITE, width=w)
    d.arc([P(44, 24), P(52, 32)], 270, 360, fill=WHITE, width=w)
    d.arc([P(48, 39), P(54, 45)], 0, 180, fill=WHITE, width=w)
    d.line([P(54, 42), P(54, 22)], fill=WHITE, width=w)
    d.line([P(54, 22), P(48, 16)], fill=WHITE, width=w)
    return img.resize((size, size), Image.LANCZOS)


def main(res: str):
    dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, f in dens.items():
        out = os.path.join(res, f"mipmap-{name}")
        os.makedirs(out, exist_ok=True)
        legacy = pump(int(48 * f), 0.86, True)
        mask = Image.new("L", legacy.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, legacy.size[0] - 1, legacy.size[1] - 1], radius=int(10 * f), fill=255)
        tile = Image.new("RGBA", legacy.size, (0, 0, 0, 0))
        tile.paste(legacy, (0, 0), mask)
        tile.save(os.path.join(out, "ic_launcher.png"))
        circle = Image.new("L", legacy.size, 0)
        ImageDraw.Draw(circle).ellipse([0, 0, legacy.size[0] - 1, legacy.size[1] - 1], fill=255)
        rnd = Image.new("RGBA", legacy.size, (0, 0, 0, 0))
        rnd.paste(legacy, (0, 0), circle)
        rnd.save(os.path.join(out, "ic_launcher_round.png"))
        # adaptive icon foreground: 108dp canvas, art inside the 66dp safe zone
        pump(int(108 * f), 0.55, False).save(os.path.join(out, "ic_launcher_foreground.png"))


if __name__ == "__main__":
    main(sys.argv[1])
