"""Draw the Aevion logo as PNG files (for the READMEs, because GitHub cannot preview the SVGs reliably).

Same shapes and coordinates as apps/web/public/logo*.svg. Writes logo.png, logo-horizontal.png and logo-mark.png
next to the SVGs.

Usage: python processing/make_logo_png.py
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection
from matplotlib.patches import Ellipse, FancyBboxPatch, Polygon

OUT = Path(__file__).resolve().parent.parent / "apps" / "web" / "public"
BLUE0, BLUE1 = np.array([0x2F, 0x6F, 0xE0]) / 255, np.array([0x5E, 0xB0, 0xFF]) / 255
BG_STOPS = [(0.0, "#0f3262"), (0.55, "#081c3b"), (1.0, "#040b1c")]


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)]) / 255


def background(w, h, cx, cy, r):
    """Radial gradient like the SVG's, elliptical over the box."""
    y, x = np.mgrid[0:h, 0:w]
    t = np.clip(np.sqrt(((x / w - cx) / r) ** 2 + ((y / h - cy) / r) ** 2), 0, 1)
    out = np.zeros((h, w, 3))
    for (a, ca), (b, cb) in zip(BG_STOPS, BG_STOPS[1:]):
        m = (t >= a) & (t <= b)
        k = ((t[m] - a) / (b - a))[:, None]
        out[m] = hexrgb(ca) * (1 - k) + hexrgb(cb) * k
    return out


class Painter:
    """Draws SVG-style shapes through a scale and offset, with line widths in SVG units."""

    def __init__(self, ax, s, tx, ty, px_per_unit):
        self.ax, self.s, self.tx, self.ty, self.ppu = ax, s, tx, ty, px_per_unit

    def pt(self, x, y):
        return (x * self.s + self.tx, y * self.s + self.ty)

    def lw(self, w):  # SVG units -> points (72 per inch, figure at 100 dpi * scale)
        return w * self.s * self.ppu * 72 / 100

    def line(self, pts, w=13):
        xs, ys = zip(*[self.pt(*p) for p in pts])
        self.ax.plot(xs, ys, color="white", lw=self.lw(w), solid_joinstyle="miter", solid_capstyle="butt")

    def poly(self, pts, color="white"):
        self.ax.add_patch(Polygon([self.pt(*p) for p in pts], closed=True, fc=color, ec="none"))

    def gradient_arc(self, cx, cy, r, a0, a1, w=13, n=60):
        """A circular arc stroked with the blue gradient (bottom left to top right)."""
        ang = np.radians(np.linspace(a0, a1, n))
        px, py = cx + r * np.cos(ang), cy + r * np.sin(ang)
        pts = np.stack([px, py], 1)
        segs = np.stack([pts[:-1], pts[1:]], 1)
        mid = (pts[:-1] + pts[1:]) / 2
        t = np.clip(((mid[:, 0] - px.min()) / (px.max() - px.min()) + 1 - (mid[:, 1] - py.min()) / (py.max() - py.min())) / 2, 0, 1)
        cols = BLUE0[None] * (1 - t[:, None]) + BLUE1[None] * t[:, None]
        segs = np.array([[self.pt(*p) for p in seg] for seg in segs])
        self.ax.add_collection(LineCollection(segs, colors=cols, linewidths=self.lw(w), capstyle="butt"))

    def white_arc(self, cx, cy, r, a0, a1, w=13, n=60):
        ang = np.radians(np.linspace(a0, a1, n))
        pts = [self.pt(cx + r * np.cos(a), cy + r * np.sin(a)) for a in ang]
        xs, ys = zip(*pts)
        self.ax.plot(xs, ys, color="white", lw=self.lw(w), solid_capstyle="butt")

    def mark(self):
        # radar arcs centered near (153.6, 177.5), then the peak and the small foot
        self.gradient_arc(153.7, 177.3, 128, 176.1, 237.0)
        self.white_arc(153.6, 177.8, 88, 174.7, 232.5)
        self.poly([(100, 10), (194, 186), (152, 186), (100, 86)])
        self.poly([(118, 186), (152, 186), (135, 150)], color=tuple(0.5 * (BLUE0 + BLUE1)))

    def wordmark(self):
        self.line([(251, 480), (290, 406), (329, 480)])
        self.line([(266, 458), (314, 458)])
        self.line([(415, 412.5), (367.5, 412.5), (367.5, 473.5), (415, 473.5)])
        self.line([(367.5, 443), (408, 443)])
        self.line([(447, 406), (486, 480), (525, 406)])
        self.line([(563.5, 406), (563.5, 480)])
        cx, cy = self.pt(641, 443)
        self.ax.add_patch(Ellipse((cx, cy), 2 * 32.5 * self.s, 2 * 30.5 * self.s, fill=False, ec="white", lw=self.lw(13)))
        self.poly([(712, 406), (727, 406), (761, 458), (761, 406), (774, 406), (774, 480), (759, 480), (725, 428), (725, 480), (712, 480)])


def canvas(w, h, scale):
    fig = plt.figure(figsize=(w * scale / 100, h * scale / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.axis("off")
    fig.patch.set_alpha(0)
    return fig, ax


def stacked():
    w, h, k = 1024, 560, 1
    fig, ax = canvas(w, h, k)
    ax.imshow(background(w, h, 0.5, 0.42, 0.75), extent=(0, w, h, 0), interpolation="bilinear", zorder=0)
    p = Painter(ax, 1.3, 373, 36, k)
    p.mark()
    Painter(ax, 1.0, 0, 0, k).wordmark()
    fig.savefig(OUT / "logo.png", dpi=100, transparent=True)


def horizontal():
    w, h, k = 740, 160, 2  # drawn at 2x so it stays sharp when shown small
    fig, ax = canvas(w, h, k)
    img = ax.imshow(background(w, h, 0.22, 0.45, 0.9), extent=(0, w, h, 0), interpolation="bilinear", zorder=0)
    clip = FancyBboxPatch((0, 0), w, h, boxstyle="round,pad=0,rounding_size=22", transform=ax.transData, fc="none", ec="none")
    ax.add_patch(clip)
    img.set_clip_path(clip)
    Painter(ax, 0.72, 26, 9, k).mark()
    Painter(ax, 0.95, -43, -337.5, k).wordmark()
    fig.savefig(OUT / "logo-horizontal.png", dpi=100, transparent=True)


def mark_only():
    w = h = 200
    fig, ax = canvas(w, h, 2.56)  # 512 px
    Painter(ax, 1.0, 0, 0, 2.56).mark()
    fig.savefig(OUT / "logo-mark.png", dpi=100, transparent=True)


if __name__ == "__main__":
    stacked()
    horizontal()
    mark_only()
    for n in ("logo.png", "logo-horizontal.png", "logo-mark.png"):
        print(n, (OUT / n).stat().st_size // 1024, "KB")
