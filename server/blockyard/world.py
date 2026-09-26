"""The voxel grid a build's boxes resolve to: counts, extents and the .schem export."""

from __future__ import annotations

import gzip
import io
import struct
from array import array
from collections import Counter

from blockyard.model import Box

AIR = 0


class World:
    def __init__(self, width: int, height: int, depth: int):
        self.width, self.height, self.depth = width, height, depth
        self.palette: list[str] = ["air"]
        self.index = {"air": AIR}
        self.cells = array("H", bytes(2 * width * height * depth))

    def _id(self, block: str) -> int:
        if block not in self.index:
            self.index[block] = len(self.palette)
            self.palette.append(block)
        return self.index[block]

    def _offset(self, x: int, y: int, z: int) -> int:
        return (y * self.depth + z) * self.width + x

    def apply(self, boxes: list[Box]) -> None:
        for b in boxes:
            x0, x1 = max(b.x0, 0), min(b.x1, self.width - 1)
            y0, y1 = max(b.y0, 0), min(b.y1, self.height - 1)
            z0, z1 = max(b.z0, 0), min(b.z1, self.depth - 1)
            if x0 > x1 or y0 > y1 or z0 > z1:
                continue
            row = array("H", [self._id(b.block)] * (x1 - x0 + 1))
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    start = self._offset(x0, y, z)
                    self.cells[start : start + len(row)] = row

    def get(self, x: int, y: int, z: int) -> str:
        if not (0 <= x < self.width and 0 <= y < self.height and 0 <= z < self.depth):
            return "air"
        return self.palette[self.cells[self._offset(x, y, z)]]

    def counts(self, min_y: int = 0) -> Counter[str]:
        raw = Counter(self.cells[self._offset(0, min_y, 0) :])
        raw.pop(AIR, None)
        return Counter({self.palette[i]: n for i, n in raw.items()})

    def bounds(self, min_y: int = 0) -> tuple[tuple[int, int, int], tuple[int, int, int]] | None:
        """Extents of the non-air blocks at or above min_y, or None when there are none."""
        lo, hi = [self.width, self.height, self.depth], [-1, -1, -1]
        w, d = self.width, self.depth
        first = self._offset(0, min_y, 0)
        for offset, cell in enumerate(self.cells[first:], first):
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
