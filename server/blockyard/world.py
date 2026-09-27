"""The voxel grid a build's boxes resolve to: counts, extents and the .schem export."""

from __future__ import annotations

import gzip
import io
import struct
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

    def schematic(self) -> bytes:
        """Sponge schematic v2 (gzip NBT), the format WorldEdit and FAWE paste."""
        bounds = self.bounds()
        if bounds is None:
            (x0, y0, z0), (x1, y1, z1) = (0, 0, 0), (0, 0, 0)
        else:
            (x0, y0, z0), (x1, y1, z1) = bounds
        w, h, d = x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1
        data = bytearray()
        for y in range(y0, y1 + 1):
            for z in range(z0, z1 + 1):
                start = self._offset(x0, y, z)
                for cell in self.cells[start : start + w]:
                    data += _varint(cell)
        palette = {f"minecraft:{name}": i for i, name in enumerate(self.palette)}
        root = {
            "Version": ("int", 2),
            "DataVersion": ("int", 3700),
            "Width": ("short", w),
            "Height": ("short", h),
            "Length": ("short", d),
            "Offset": ("int_array", [x0, y0, z0]),
            "PaletteMax": ("int", len(palette)),
            "Palette": ("compound", {name: ("int", i) for name, i in palette.items()}),
            "BlockData": ("byte_array", bytes(data)),
        }
        return gzip.compress(_nbt("Schematic", root))


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


TAGS = {"byte": 1, "short": 2, "int": 3, "string": 8, "byte_array": 7, "int_array": 11, "compound": 10}


def _nbt(name: str, value: dict) -> bytes:
    out = io.BytesIO()
    out.write(bytes([TAGS["compound"]]))
    _string(out, name)
    _compound(out, value)
    return out.getvalue()


def _string(out: io.BytesIO, s: str) -> None:
    data = s.encode()
    out.write(struct.pack(">H", len(data)) + data)


def _compound(out: io.BytesIO, value: dict) -> None:
    for key, (kind, payload) in value.items():
        out.write(bytes([TAGS[kind]]))
        _string(out, key)
        _payload(out, kind, payload)
    out.write(b"\x00")


def _payload(out: io.BytesIO, kind: str, payload) -> None:
    if kind == "byte":
        out.write(struct.pack(">b", payload))
    elif kind == "short":
        out.write(struct.pack(">h", payload))
    elif kind == "int":
        out.write(struct.pack(">i", payload))
    elif kind == "string":
        _string(out, payload)
    elif kind == "byte_array":
        out.write(struct.pack(">i", len(payload)) + payload)
    elif kind == "int_array":
        out.write(struct.pack(">i", len(payload)) + b"".join(struct.pack(">i", v) for v in payload))
    elif kind == "compound":
        _compound(out, payload)
