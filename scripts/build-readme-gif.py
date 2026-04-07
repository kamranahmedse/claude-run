import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


CANVAS_SIZE = (1500, 960)
TARGET_SIZE = (1360, 850)
RADIUS = 26
SHADOW_OFFSET = (14, 18)
BLEND_STEPS = (0.25, 0.5, 0.75)
BLEND_DURATION = 90


def make_background(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size)
    pixels = image.load()

    top = (9, 13, 20)
    bottom = (17, 24, 39)
    for y in range(height):
        t = y / max(height - 1, 1)
        row = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(width):
            pixels[x, y] = (*row, 255)

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse((width * 0.55, height * -0.2, width * 1.1, height * 0.55), fill=(37, 99, 235, 34))
    draw.ellipse((width * -0.1, height * 0.2, width * 0.4, height * 0.9), fill=(16, 185, 129, 18))
    return Image.alpha_composite(image, glow.filter(ImageFilter.GaussianBlur(60)))


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def compose_frame(raw_path: Path, background: Image.Image) -> Image.Image:
    raw = Image.open(raw_path).convert("RGBA")
    if raw.size != TARGET_SIZE:
      raw = raw.resize(TARGET_SIZE, Image.Resampling.LANCZOS)

    canvas = background.copy()
    x = (canvas.width - raw.width) // 2
    y = (canvas.height - raw.height) // 2

    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)
    shadow_draw.rounded_rectangle(
        (
            x + SHADOW_OFFSET[0],
            y + SHADOW_OFFSET[1],
            x + raw.width + SHADOW_OFFSET[0],
            y + raw.height + SHADOW_OFFSET[1],
        ),
        radius=RADIUS,
        fill=(0, 0, 0, 130),
    )
    canvas = Image.alpha_composite(canvas, shadow_layer.filter(ImageFilter.GaussianBlur(22)))

    mask = rounded_mask(raw.size, RADIUS)
    canvas.paste(raw, (x, y), mask)

    border = ImageDraw.Draw(canvas)
    border.rounded_rectangle(
        (x, y, x + raw.width, y + raw.height),
        radius=RADIUS,
        outline=(255, 255, 255, 22),
        width=1,
    )

    return canvas.convert("RGB")


def build_sequence(timeline_path: Path) -> tuple[list[Image.Image], list[int]]:
    timeline = json.loads(timeline_path.read_text())
    base_dir = timeline_path.parent
    background = make_background(CANVAS_SIZE)

    keyframes = [(compose_frame(base_dir / item["file"], background), item["duration"]) for item in timeline]

    frames: list[Image.Image] = []
    durations: list[int] = []
    for idx, (frame, duration) in enumerate(keyframes):
        if idx > 0:
            prev_frame = keyframes[idx - 1][0]
            for alpha in BLEND_STEPS:
                frames.append(Image.blend(prev_frame, frame, alpha))
                durations.append(BLEND_DURATION)
        frames.append(frame)
        durations.append(duration)

    return frames, durations


def save_gif(frames: list[Image.Image], durations: list[int], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    palette_base = frames[0].convert("P", palette=Image.Palette.ADAPTIVE, colors=128)
    quantized = [palette_base]
    for frame in frames[1:]:
        quantized.append(frame.quantize(palette=palette_base))

    quantized[0].save(
        output_path,
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=False,
        disposal=2,
    )


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: build-readme-gif.py <timeline.json> <output.gif>", file=sys.stderr)
        return 1

    timeline_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    frames, durations = build_sequence(timeline_path)
    save_gif(frames, durations, output_path)
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
