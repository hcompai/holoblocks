"""Build scripts, run in their own process: each call expands into block boxes, grouped into manual steps."""

from __future__ import annotations

import bisect
import contextlib
import io
import json
import random
import sys
import zlib
from functools import cache

SOURCE = "<script>"
MAX_OPS = 200_000
MAX_PATTERN_BLOCKS = 1_000_000
PRINT_LIMIT = 2000
API = ("step", "fill", "set", "clear", "get", "replace", "overlay")


def _ints(*values) -> list[int]:
    out = []
    for v in values:
        if isinstance(v, bool) or not isinstance(v, int | float):
            raise TypeError(f"coordinates must be numbers, got {v!r}")
        out.append(round(v))
    return out


def _span(a, b) -> tuple[int, int]:
    a, b = _ints(a, b)
    return min(a, b), max(a, b)


def _parts(text: str) -> list[str]:
    """Split on the commas outside block-state brackets."""
    parts, depth, start = [], 0, 0
    for i, c in enumerate(text):
        depth += (c == "[") - (c == "]")
        if c == "," and not depth:
            parts.append(text[start:i])
            start = i + 1
    return [p.strip() for p in [*parts, text[start:]]]


@cache
def _pattern(block: str) -> tuple[tuple[str, ...], tuple[float, ...], int] | None:
    """A WorldEdit pattern like '60%stone,40%andesite' as blocks, cumulative weights and a seed; None for one block."""
    parts = _parts(block)
    if len(parts) == 1 and "%" not in parts[0]:
        return None
    names, cumulative, total = [], [], 0.0
    for part in parts:
        weight, percent, name = part.partition("%")
        if not percent:
            weight, name = "1", part
        try:
            total += float(weight)
        except ValueError:
            raise ValueError(f"pattern '{block}': write each part as 60%stone_bricks") from None
        names.append(name.strip())
        cumulative.append(total)
    return tuple(names), tuple(cumulative), zlib.crc32(block.encode())


def _pick(pattern: tuple[tuple[str, ...], tuple[float, ...], int], x: int, y: int, z: int) -> str:
    names, cumulative, seed = pattern
    h = (x * 73856093 ^ y * 19349663 ^ z * 83492791 ^ seed) & 0xFFFFFFFF
    h = (h ^ (h >> 15)) * 2246822519 & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 3266489917 & 0xFFFFFFFF
    r = (h ^ (h >> 16)) / 2**32 * cumulative[-1]
    return names[min(bisect.bisect_right(cumulative, r), len(names) - 1)]


def _matcher(mask: str):
    """Blocks matching a mask like 'stone_bricks' (any state), 'oak_stairs[facing=north]' or 'dirt,air'."""
    exact = {p.removeprefix("minecraft:") for p in _parts(mask) if "[" in p}
    names = {p.removeprefix("minecraft:") for p in _parts(mask) if "[" not in p}
    return lambda block: block in exact or block.split("[")[0] in names


class Script:
    """The functions a script calls; every call records inclusive boxes of one block, tagged with its script line."""

    def __init__(self, site: tuple[int, int, int] = (64, 64, 64)):
        self.site = site
        self.steps: list[dict] = []
        self.count = 0
        self.grid: dict[tuple[int, int, int], str] | None = None

    @staticmethod
    def _line() -> int:
        frame = sys._getframe(1)
        while frame and frame.f_code.co_filename != SOURCE:
            frame = frame.f_back
        return frame.f_lineno if frame else 0

    def _within(self, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int):
        w, h, d = self.site
        return (
            range(max(x0, 0), min(x1, w - 1) + 1),
            range(max(y0, 0), min(y1, h - 1) + 1),
            range(max(z0, 0), min(z1, d - 1) + 1),
        )

    def _add(self, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, block: str) -> None:
        if not self.steps:
            self.step("Build")
        self.count += 1
        if self.count > MAX_OPS:
            raise ValueError(f"the script makes more than {MAX_OPS} boxes; use bigger fills")
        box = dict(zip(("x0", "y0", "z0", "x1", "y1", "z1"), (x0, y0, z0, x1, y1, z1), strict=True))
        self.steps[-1]["ops"].append(box | {"block": block, "line": self._line()})
        if self.grid is not None:
            self._paint(x0, y0, z0, x1, y1, z1, block)

    def _paint(self, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, block: str) -> None:
        grid, xs, ys, zs = self.grid, *self._within(x0, y0, z0, x1, y1, z1)
        air = block.removeprefix("minecraft:") == "air"
        for x in xs:
            for y in ys:
                for z in zs:
                    if air:
                        grid.pop((x, y, z), None)
                    else:
                        grid[(x, y, z)] = block

    def _column(self, x: int, z: int, cells: list[tuple[int, str | None]]) -> None:
        """Add a column's blocks as boxes, one per run of the same block; None leaves a cell alone."""
        start, current, last = 0, None, None
        for y, block in [*cells, (None, None)]:
            if block != current or (last is not None and y != last + 1):
                if current is not None:
                    self._add(x, start, z, x, last, z, current)
                start, current = y, block
            last = y

    def _box(self, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, block: str) -> None:
        if not isinstance(block, str):
            raise TypeError(f"block must be a name like 'stone_bricks', got {block!r}")
        pattern = _pattern(block)
        if pattern is None:
            return self._add(x0, y0, z0, x1, y1, z1, block)
        if (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MAX_PATTERN_BLOCKS:
            raise ValueError(f"a pattern fills at most {MAX_PATTERN_BLOCKS} blocks per call")
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                self._column(x, z, [(y, _pick(pattern, x, y, z)) for y in range(y0, y1 + 1)])

    def step(self, title: str) -> None:
        """Start a manual step; the calls after it go into it, with `random` seeded from its title."""
        self.steps.append({"title": str(title)[:80], "line": self._line(), "ops": []})
        random.seed(str(title))

    def fill(self, x0, y0, z0, x1, y1, z1, block: str, mode: str = "solid") -> None:
        (x0, x1), (y0, y1), (z0, z1) = _span(x0, x1), _span(y0, y1), _span(z0, z1)
        if mode == "solid":
            return self._box(x0, y0, z0, x1, y1, z1, block)
        if mode not in ("hollow", "walls"):
            raise ValueError(f"unknown fill mode '{mode}'; use solid, hollow or walls")
        self._box(x0, y0, z0, x1, y1, z0, block)
        self._box(x0, y0, z1, x1, y1, z1, block)
        self._box(x0, y0, z0, x0, y1, z1, block)
        self._box(x1, y0, z0, x1, y1, z1, block)
        if mode == "hollow":
            self._box(x0, y0, z0, x1, y0, z1, block)
            self._box(x0, y1, z0, x1, y1, z1, block)

    def set(self, x, y, z, block: str) -> None:
        self.fill(x, y, z, x, y, z, block)

    def clear(self, x0, y0, z0, x1, y1, z1) -> None:
        self.fill(x0, y0, z0, x1, y1, z1, "air")

    def _grid(self) -> dict[tuple[int, int, int], str]:
        if self.grid is None:
            self.grid = {}
            for step in self.steps:
                for op in step["ops"]:
                    self._paint(op["x0"], op["y0"], op["z0"], op["x1"], op["y1"], op["z1"], op["block"])
        return self.grid

    def _filled(self, xs: range, ys: range, zs: range) -> dict[tuple[int, int], list[int]]:
        """The heights of the placed blocks in a box, by column, in x, z, y order."""
        grid, columns = self._grid(), {}
        if len(xs) * len(ys) * len(zs) <= len(grid):
            for x in xs:
                for z in zs:
                    if column := [y for y in ys if (x, y, z) in grid]:
                        columns[x, z] = column
            return columns
        for x, y, z in grid:
            if x in xs and y in ys and z in zs:
                columns.setdefault((x, z), []).append(y)
        return {key: sorted(columns[key]) for key in sorted(columns)}

    def get(self, x, y, z) -> str:
        """The block this script has put at (x, y, z) so far, as written; 'air' where it put none."""
        key = (x, y, z) if type(x) is type(y) is type(z) is int else tuple(_ints(x, y, z))
        return self._grid().get(key, "air")

    def replace(self, x0, y0, z0, x1, y1, z1, mask: str, block: str) -> None:
        """Like WorldEdit's //replace: every block in the box matching `mask` becomes `block` (a pattern too)."""
        (x0, x1), (y0, y1), (z0, z1) = _span(x0, x1), _span(y0, y1), _span(z0, z1)
        match, pattern = _matcher(mask), _pattern(block)
        xs, ys, zs = self._within(x0, y0, z0, x1, y1, z1)
        grid = self._grid()
        columns = {(x, z): ys for x in xs for z in zs} if match("air") else self._filled(xs, ys, zs)
        for (x, z), heights in columns.items():
            cells = [
                (y, _pick(pattern, x, y, z) if pattern else block) for y in heights if match(grid.get((x, y, z), "air"))
            ]
            self._column(x, z, cells)

    def overlay(self, x0, y0, z0, x1, y1, z1, block: str, on: str = "") -> None:
        """Like WorldEdit's //overlay: `block` on each column's highest block in the box, where open and matching `on`."""
        (x0, x1), (y0, y1), (z0, z1) = _span(x0, x1), _span(y0, y1), _span(z0, z1)
        pattern, match = _pattern(block), _matcher(on) if on else None
        grid = self._grid()
        for (x, z), heights in self._filled(*self._within(x0, y0, z0, x1, y1, z1)).items():
            top = heights[-1]
            if top + 1 >= self.site[1] or (x, top + 1, z) in grid or (match and not match(grid[x, top, z])):
                continue
            chosen = _pick(pattern, x, top + 1, z) if pattern else block
            if chosen != "air":
                self._add(x, top + 1, z, x, top + 1, z, chosen)


def _explain(error: BaseException, code: str) -> str:
    line = error.lineno if isinstance(error, SyntaxError) and error.filename == SOURCE else None
    tb = error.__traceback__
    while tb:
        if tb.tb_frame.f_code.co_filename == SOURCE:
            line = tb.tb_lineno
        tb = tb.tb_next
    lines = code.splitlines()
    where = f"line {line} `{lines[line - 1].strip()}`: " if line and line <= len(lines) else ""
    return f"{where}{type(error).__name__}: {error}"[:800]


def run(code: str, site: tuple[int, int, int] = (64, 64, 64)) -> dict:
    """The script's non-empty steps, or the error that stopped it; either way, what it printed."""
    script = Script(site)
    printed = io.StringIO()
    scope = {"__name__": "__main__", **{name: getattr(script, name) for name in API}}
    random.seed(0)
    try:
        with contextlib.redirect_stdout(printed):
            exec(compile(code, SOURCE, "exec"), scope)  # noqa: S102
    except (Exception, SystemExit) as e:  # noqa: BLE001
        return {"error": _explain(e, code), "printed": printed.getvalue()[-PRINT_LIMIT:]}
    steps = [s for s in script.steps if s["ops"]]
    return {"steps": steps, "printed": printed.getvalue()[-PRINT_LIMIT:]}


def main() -> None:
    job = json.load(sys.stdin)
    sys.stdout.write(json.dumps(run(job["code"], tuple(job.get("site", (64, 64, 64))))))


if __name__ == "__main__":
    main()
