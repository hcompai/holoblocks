"""The voxel grid a build's boxes resolve to: counts, extents and floating blocks."""

from __future__ import annotations

from array import array
from collections import Counter

from blockyard.model import Box, Build

AIR = 0


class World:
    def __init__(self, width: int, height: int, depth: int):
        self.width, self.height, self.depth = width, height, depth
        self.palette: list[str] = ["air"]
        self.index = {"air": AIR}
        self.cells = array("H", bytes(2 * width * height * depth))

    @classmethod
    def of(cls, build: Build) -> World:
        """The grid holding every box of `build`."""
        world = cls(build.width, build.height, build.depth)
        world.apply(build.boxes)
        return world

    def _id(self, block: str) -> int:
        if block not in self.index:
            self.index[block] = len(self.palette)
            self.palette.append(block)
        return self.index[block]

    def _offset(self, x: int, y: int, z: int) -> int:
        return (y * self.depth + z) * self.width + x

    def apply(self, boxes: list[Box]) -> int:
        """Write the boxes in order; returns how many cells changed block."""
        changed = 0
        for b in boxes:
            x0, x1 = max(b.x0, 0), min(b.x1, self.width - 1)
            y0, y1 = max(b.y0, 0), min(b.y1, self.height - 1)
            z0, z1 = max(b.z0, 0), min(b.z1, self.depth - 1)
            if x0 > x1 or y0 > y1 or z0 > z1:
                continue
            block = self._id(b.block)
            row = array("H", [block] * (x1 - x0 + 1))
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    start = self._offset(x0, y, z)
                    changed += len(row) - self.cells[start : start + len(row)].count(block)
                    self.cells[start : start + len(row)] = row
        return changed

    def get(self, x: int, y: int, z: int) -> str:
        if not (0 <= x < self.width and 0 <= y < self.height and 0 <= z < self.depth):
            return "air"
        return self.palette[self.cells[self._offset(x, y, z)]]

    def counts(self) -> Counter[str]:
        raw = Counter(self.cells)
        raw.pop(AIR, None)
        return Counter({self.palette[i]: n for i, n in raw.items()})

    def floating(self) -> list[list[tuple[int, int, int]]]:
        """Groups of blocks with no chain of blocks down to y=0, largest first.

        Blocks touching by a face, an edge or a corner count as joined, so stair roofs climbing diagonally hold.
        """
        w, h, d, layer, cells = self.width, self.height, self.depth, self.width * self.depth, self.cells
        seen = bytearray(len(cells))
        around = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if dx or dy or dz]

        def spread(start: list[int]) -> list[int]:
            for o in start:
                seen[o] = 1
            group, stack = list(start), list(start)
            while stack:
                o = stack.pop()
                x, y, z = o % w, o // layer, o // w % d
                for dx, dy, dz in around:
                    if 0 <= x + dx < w and 0 <= y + dy < h and 0 <= z + dz < d:
                        n = o + dx + dz * w + dy * layer
                        if cells[n] != AIR and not seen[n]:
                            seen[n] = 1
                            group.append(n)
                            stack.append(n)
            return group

        spread([o for o in range(layer) if cells[o] != AIR])
        groups = [spread([o]) for o in range(layer, len(cells)) if cells[o] != AIR and not seen[o]]
        return [[(o % w, o // layer, o // w % d) for o in g] for g in sorted(groups, key=len, reverse=True)]

    def bounds(self) -> tuple[tuple[int, int, int], tuple[int, int, int]] | None:
        """Extents of the non-air blocks, or None when there are none."""
        lo, hi = [self.width, self.height, self.depth], [-1, -1, -1]
        w, d = self.width, self.depth
        for offset, cell in enumerate(self.cells):
            if cell == AIR:
                continue
            x, rest = offset % w, offset // w
            z, y = rest % d, rest // d
            lo = [min(lo[0], x), min(lo[1], y), min(lo[2], z)]
            hi = [max(hi[0], x), max(hi[1], y), max(hi[2], z)]
        return None if hi[0] < 0 else (tuple(lo), tuple(hi))  # type: ignore[return-value]
