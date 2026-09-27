"""A build: boxes of blocks grouped into scripted steps, plus the chat that produced it."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


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
    key: str | None = None
    """Digest of the script step that made it, empty if that step had problems; None when no script made it."""


class Message(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    text: str
    images: list[str] = []
    """URLs: the images a user attached, or the render shown with a tool note."""
    at: float = Field(default_factory=time.time)

    @model_validator(mode="before")
    @classmethod
    def _single_image(cls, data: Any) -> Any:
        """Builds saved with one `image` per message still load."""
        if isinstance(data, dict) and "image" in data:
            data = dict(data)
            image = data.pop("image")
            data.setdefault("images", [image] if image else [])
        return data


class Build(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    name: str = "Untitled build"
    prompt: str = ""
    builder: str = "demo"
    width: int = 128
    depth: int = 128
    height: int = 100
    created: float = Field(default_factory=time.time)
    updated: float = 0
    """When the blocks last changed; 0 when unknown."""
    status: Literal["idle", "building", "done", "error"] = "idle"
    boxes: list[Box] = []
    steps: list[Step] = []
    messages: list[Message] = []
    script: str = ""

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "prompt": self.prompt,
            "builder": self.builder,
            "status": self.status,
            "created": self.created,
            "updated": self.updated,
            "boxes": len(self.boxes),
            "steps": len(self.steps),
            "width": self.width,
            "depth": self.depth,
            "height": self.height,
        }
