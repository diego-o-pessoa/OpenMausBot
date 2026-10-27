"""Measure Grok Bot's mascot in screen recordings and write src/components/mascot-clips.ts.

Usage: python scripts/mascot-clips/measure.py <folder with the recordings>

Needs opencv-python and numpy. The recordings are not in the repository; their file names are listed in
RECORDINGS below, with where the sidebar mascot sits in each and the radius of its body at rest.
"""

import os
import sys

import cv2
import numpy as np

STEP = 0.1
WINDOW = 26

RECORDINGS = {
    "long task": ("Grok Bot - animação rodando.mp4", (34, 203), (37.46, 206.45), 16.894),
    "short reply": ("Grok Bot - animação rodando 2.mp4", (42, 227), (41.4, 227.65), 18.42),
    "hover": ("Grok Bot - animação passando mouse.mp4", (42, 227), (41.4, 227.65), 18.42),
}

# (name, recording, start s, end s, smile from s, smile to s)
CLIPS = [
    ("downScanA", "long task", 0.0, 4.2, None, None),
    ("ovalPonder", "long task", 4.4, 9.6, None, None),
    ("downScanB", "long task", 9.8, 15.0, None, None),
    ("shrinkPeek", "long task", 15.0, 18.0, None, None),
    ("rollAway", "long task", 18.0, 19.8, None, None),
    ("attentive", "long task", 19.8, 21.4, None, None),
    ("glanceUp", "long task", 21.4, 24.9, None, None),
    ("frontBlink", "long task", 24.9, 26.6, None, None),
    ("glanceUpAgain", "long task", 26.6, 29.3, None, None),
    ("rollThrough", "long task", 29.3, 30.6, None, None),
    ("glanceLeft", "long task", 31.6, 33.6, None, None),
    ("lookUpRight", "long task", 33.6, 35.3, None, None),
    ("glanceUpLeft", "long task", 35.3, 38.7, None, None),
    ("glanceUpLater", "long task", 39.4, 42.0, None, None),
    ("rollDown", "long task", 42.0, 43.3, None, None),
    ("peekLeft", "long task", 44.2, 46.5, None, None),
    ("squintGlance", "long task", 47.8, 50.2, None, None),
    ("dropAndBack", "long task", 50.2, 51.9, None, None),
    ("downScanC", "long task", 52.0, 56.0, None, None),
    ("typing", "short reply", 6.5, 7.3, None, None),
    ("celebrate", "short reply", 7.4, 14.1, 7.4, 13.55),
    ("settle", "hover", 13.1, 13.6, None, None),
]

ZERO_EYE = [0.0, 0.0, 0.0, 0.0, 0.0]


def frame_at(capture, fps, t):
    capture.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps)))
    ok, frame = capture.read()
    if not ok:
        raise SystemExit(f"no frame at {t:.2f}s")
    return frame


def measure(frame, guess):
    """Body moments and per-eye moments in pixels; each size is four standard deviations."""
    x0, y0 = guess[0] - WINDOW, guess[1] - WINDOW
    crop = frame[y0 : y0 + 2 * WINDOW, x0 : x0 + 2 * WINDOW].astype(float)
    blue_ch, red_ch = crop[..., 0], crop[..., 2]
    ys, xs = np.mgrid[0 : 2 * WINDOW, 0 : 2 * WINDOW].astype(float)
    blue = np.clip((blue_ch - red_ch) / 190.0, 0, 1)
    blue[blue < 0.15] = 0
    mask = (blue > 0.3).astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = np.zeros_like(mask)
    cv2.drawContours(hull, contours, -1, 1, -1)
    inside = hull.astype(bool)
    # The anti-aliased rim reads as white, so eyes are looked for two pixels in from it.
    inner = cv2.erode(hull, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(bool)
    white = np.clip((red_ch - 45) / 210.0, 0, 1) * inside
    body = blue * inside + white
    area = body.sum()
    bx, by = (body * xs).sum() / area, (body * ys).sum() / area
    sdx = np.sqrt((body * (xs - bx) ** 2).sum() / area)
    sdy = np.sqrt((body * (ys - by) ** 2).sum() / area)
    count, labels = cv2.connectedComponents(((white > 0.35) & inner).astype(np.uint8))
    eyes = []
    for i in range(1, count):
        near = cv2.dilate((labels == i).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & inner
        weight = white * near
        mass = weight.sum()
        if mass < 1.0:
            continue
        ex, ey = (weight * xs).sum() / mass, (weight * ys).sum() / mass
        cov = np.array(
            [
                [(weight * (xs - ex) ** 2).sum(), (weight * (xs - ex) * (ys - ey)).sum()],
                [(weight * (xs - ex) * (ys - ey)).sum(), (weight * (ys - ey) ** 2).sum()],
            ]
        ) / mass
        values, vectors = np.linalg.eigh(cov)
        angle = np.degrees(np.arctan2(vectors[1, 1], vectors[0, 1]))
        eyes.append((mass, ex + x0, ey + y0, 4 * np.sqrt(max(values[1], 0)), 4 * np.sqrt(max(values[0], 0)), angle))
    eyes = sorted(sorted(eyes, reverse=True)[:2], key=lambda e: e[1])
    return bx + x0, by + y0, sdx, sdy, eyes


def sample(measured, centre, radius, previous, smiling):
    bx, by, sdx, sdy, eyes = measured
    sd = np.sqrt(sdx * sdy)
    scale = 2 * sd / radius
    sx, sy = sdx / sd, sdy / sd
    r = radius * scale
    slots = [[(e[1] - bx) / (r * sx), (by - e[2]) / (r * sy), e[3] / r, e[4] / r, e[5]] for e in eyes]
    if len(slots) == 1:
        lone = slots[0]
        if previous[0][2] > 0 and previous[1][2] > 0:
            left = abs(lone[0] - previous[0][0]) <= abs(lone[0] - previous[1][0])
        else:
            left = lone[0] < 0
        slots = [lone, ZERO_EYE] if left else [ZERO_EYE, lone]
    elif not slots:
        slots = [ZERO_EYE, ZERO_EYE]
    row = [scale, sx, sy, *slots[0], *slots[1], 1 if smiling else 0, (bx - centre[0]) / radius, (centre[1] - by) / radius]
    return row, slots


def number(value, places):
    text = f"{value:.{places}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def row_text(row):
    parts = [number(v, 1 if i in (7, 12) else 3) for i, v in enumerate(row[:13])]
    parts.append(str(row[13]))
    parts += [number(row[14], 3), number(row[15], 3)]
    while len(parts) > 14 and parts[-1] == "0":
        parts.pop()
    return "[" + ", ".join(parts) + "]"


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else "videos"
    captures = {}
    out = [
        "// Generated by scripts/mascot-clips/measure.py from screen recordings of Grok Bot. Do not edit by hand.",
        'import type { TrackSample } from "./mascot-tracks";',
        "",
        "export type MascotClipName =",
    ]
    names = [clip[0] for clip in CLIPS]
    out += [f'  | "{name}"' for name in names[:-1]] + [f'  | "{names[-1]}";', ""]
    out.append("export const MASCOT_CLIPS: Readonly<Record<MascotClipName, readonly TrackSample[]>> = {")
    for name, recording, start, end, smile_from, smile_to in CLIPS:
        file, guess, centre, radius = RECORDINGS[recording]
        if recording not in captures:
            capture = cv2.VideoCapture(os.path.join(folder, file))
            if not capture.isOpened():
                raise SystemExit(f"cannot open {file} in {folder}")
            captures[recording] = (capture, capture.get(cv2.CAP_PROP_FPS))
        capture, fps = captures[recording]
        out.append(f"  {name}: [")
        previous = [ZERO_EYE, ZERO_EYE]
        for k in range(int(round((end - start) / STEP)) + 1):
            t = start + k * STEP
            smiling = smile_from is not None and smile_from <= t < smile_to
            row, previous = sample(measure(frame_at(capture, fps, t), guess), centre, radius, previous, smiling)
            out.append(f"    {row_text(row)},")
        out.append("  ],")
    out.append("};")
    target = os.path.join(os.path.dirname(__file__), "..", "..", "src", "components", "mascot-clips.ts")
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(out) + "\n")
    print(f"wrote {len(out)} lines to {os.path.normpath(target)}")


if __name__ == "__main__":
    main()
