"""The build being edited: `build.json` is the model, `model.json.gz` everything the browser renders it from."""

from __future__ import annotations

import gzip
import json
import time
import uuid
from pathlib import Path

from blockyard.model import Build

BUILD = "build.json"
MODEL = "model.json.gz"


def write(path: Path, data: str | bytes) -> None:
    tmp = path.with_name(f".{uuid.uuid4().hex}.tmp")
    tmp.write_bytes(data.encode() if isinstance(data, str) else data)
    tmp.replace(path)


def bundle(build: Build) -> dict:
    """The build as the browser shows it; boxes packed as one flat list of x0 y0 z0 x1 y1 z1 block step."""
    blocks: dict[str, int] = {}
    boxes: list[int] = []
    for b in build.boxes:
        boxes += [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, blocks.setdefault(b.block, len(blocks)), b.step]
    return build.model_dump(include={"name", "width", "depth", "height", "updated"}) | {
        "revision": build.revision,
        "steps": [s.model_dump(include={"index", "title", "code"}) for s in build.steps],
        "blocks": list(blocks),
        "boxes": boxes,
    }


class Workspace:
    """A build and, when it has a folder, the files that keep it."""

    def __init__(self, build: Build, folder: Path | None = None):
        self.build = build
        self.folder = folder

    @classmethod
    def open(cls, folder: Path) -> Workspace:
        path = folder / BUILD
        return cls(Build.model_validate_json(path.read_text()) if path.exists() else Build(), folder)

    def save(self, build: Build | None = None) -> None:
        """Keep `build`, the current one by default, as the current one once its files are written."""
        build = build or self.build
        if self.folder is not None:
            model = json.dumps(bundle(build), separators=(",", ":")).encode()
            write(self.folder / MODEL, gzip.compress(model, mtime=0))
            write(self.folder / BUILD, build.model_dump_json())
        self.build = build

    def commit(self, candidate: Build) -> None:
        """Take the rebuilt model; its time of change moves only when its blocks did."""
        changed = candidate.revision != self.build.revision
        self.save(candidate.model_copy(update={"updated": time.time() if changed else self.build.updated}))
