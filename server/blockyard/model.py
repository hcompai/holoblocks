"""A build: boxes of blocks grouped into scripted steps."""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel


class Box(BaseModel):
    """An inclusive block-aligned box filled with one block state; later boxes overwrite earlier ones."""

    x0: int
    y0: int
    z0: int
    x1: int
    y1: int
    z1: int
    block: str
    step: int

    @property
    def volume(self) -> int:
        return (self.x1 - self.x0 + 1) * (self.y1 - self.y0 + 1) * (self.z1 - self.z0 + 1)


class Step(BaseModel):
    index: int
    title: str
    code: str = ""
    key: str = ""
    """Digest of the script step that made it, empty if that step had problems."""


UNNAMED = "Untitled build"


class Build(BaseModel):
    name: str = UNNAMED
    width: int = 128
    depth: int = 128
    height: int = 100
    updated: float = 0
    """When the blocks last changed; 0 when unknown."""
    boxes: list[Box] = []
    steps: list[Step] = []
    script: str = ""

    @property
    def revision(self) -> str:
        """Digest of the blocks and steps: equal revisions show the same model."""
        shape = [
            self.width,
            self.height,
            self.depth,
            [s.title for s in self.steps],
            [b.model_dump() for b in self.boxes],
        ]
        return hashlib.sha256(json.dumps(shape, separators=(",", ":")).encode()).hexdigest()
