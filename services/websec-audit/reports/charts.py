"""
reports/charts.py
Tiny dependency-free inline-SVG chart helpers for the reports.

Why SVG (not Chart.js) here: the HTML *and* PDF reports must render the same,
and WeasyPrint (PDF) does not execute JavaScript. Inline SVG renders identically
in a browser and in the PDF. The interactive dashboard uses Chart.js separately.
"""

from __future__ import annotations

# Grade/score colour ramp shared across the reports.
def score_color(score: int) -> str:
    if score >= 90:
        return "#1a7f37"   # green  (A)
    if score >= 70:
        return "#2da44e"   # light green (B/C)
    if score >= 50:
        return "#bf8700"   # amber (D/E)
    return "#cf222e"       # red   (F)


def history_svg(history: list[dict], width: int = 520, height: int = 140) -> str:
    """Renders a score-over-time line chart as an inline SVG string.

    `history` is oldest-first: [{"score": int, "started_at": iso, ...}, ...].
    Returns '' when there is not enough data to draw a line.
    """
    points = [h for h in (history or []) if h.get("score") is not None]
    if len(points) < 2:
        return ""

    pad_l, pad_r, pad_t, pad_b = 32, 12, 12, 22
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    n = len(points)
    xs = [pad_l + (plot_w * i / (n - 1)) for i in range(n)]
    ys = [pad_t + plot_h * (1 - (p["score"] / 100)) for p in points]

    # Gridlines at 0/50/100.
    grid = []
    for val in (0, 50, 100):
        y = pad_t + plot_h * (1 - val / 100)
        grid.append(
            f'<line x1="{pad_l}" y1="{y:.1f}" x2="{width - pad_r}" y2="{y:.1f}" '
            f'stroke="#e5e7eb" stroke-width="1"/>'
            f'<text x="4" y="{y + 3:.1f}" font-size="9" fill="#9ca3af">{val}</text>'
        )

    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    dots = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.6" fill="{score_color(p["score"])}"/>'
        for x, y, p in zip(xs, ys, points)
    )

    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-label="Score history">'
        f'{"".join(grid)}'
        f'<polyline fill="none" stroke="#2563eb" stroke-width="2" points="{line}"/>'
        f'{dots}'
        f'</svg>'
    )


def sparkline_svg(scores: list[int], width: int = 90, height: int = 24) -> str:
    """A minimal sparkline for the sites table. '' if fewer than 2 points."""
    pts = [s for s in scores if s is not None]
    if len(pts) < 2:
        return ""
    n = len(pts)
    xs = [width * i / (n - 1) for i in range(n)]
    ys = [height * (1 - s / 100) for s in pts]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    return (
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg">'
        f'<polyline fill="none" stroke="{score_color(pts[-1])}" stroke-width="1.5" '
        f'points="{line}"/></svg>'
    )
