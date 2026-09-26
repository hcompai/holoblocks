"""A build: boxes of blocks grouped into scripted steps, plus the chat that produced it."""

from __future__ import annotations

import time
import uuid
from typing import Literal

from pydantic import BaseModel, Field


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


class Message(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    text: str
    images: list[str] = []
    at: float = Field(default_factory=time.time)


class Build(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    name: str = "Untitled build"
    prompt: str = ""
    builder: str = "demo"
    width: int = 64
    depth: int = 64
    height: int = 64
    created: float = Field(default_factory=time.time)
    status: Literal["idle", "building", "done", "error"] = "idle"
    boxes: list[Box] = []
    steps: list[Step] = []
    messages: list[Message] = []

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "builder": self.builder,
            "status": self.status,
            "created": self.created,
            "boxes": len(self.boxes),
            "steps": len(self.steps),
            "width": self.width,
            "depth": self.depth,
            "height": self.height,
        }
