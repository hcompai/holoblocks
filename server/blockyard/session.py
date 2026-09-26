"""Live builds: a session owns one build, persists it, and streams every change to subscribers."""

from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from blockyard.model import Box, Build, Message, Step

DATA = Path(os.environ.get("BLOCKYARD_DATA", Path(__file__).resolve().parents[2] / "data"))
SIDES = ("front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left")


@dataclass(frozen=True)
class View:
    """Where a render looks from: the four views when `angle` is None, else one view from that angle and pitch."""

    angle: float | None = None
    pitch: float = 30
    zoom: float = 1

    def caption(self) -> str:
        zoom = f", zoom {self.zoom:g}x" if self.zoom != 1 else ""
        if self.angle is None:
            return f"3/4 front-right, 3/4 back-left, front, and top (back at the top){zoom}."
        side = SIDES[round(self.angle / 45) % 8]
        return f"one view from {self.angle:g} degrees around ({side}), {self.pitch:g} degrees up{zoom}."


FOUR_VIEWS = View()


class Store:
    def __init__(self, root: Path = DATA):
        self.root = root / "builds"
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, build: Build) -> None:
        path = self.root / f"{build.id}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(build.model_dump_json())
        tmp.replace(path)

    def thumbnail(self, build_id: str) -> Path:
        return self.root.parent / "thumbnails" / f"{build_id}.png"

    @property
    def images(self) -> Path:
        return self.root.parent / "images"

    def save_image(self, png: bytes) -> str:
        """Keep a render shown in the chat; returns its URL."""
        name = f"{uuid.uuid4().hex[:12]}.png"
        self.images.mkdir(parents=True, exist_ok=True)
        (self.images / name).write_bytes(png)
        return f"/api/images/{name}"

    def load(self, build_id: str) -> Build | None:
        path = self.root / f"{build_id}.json"
        return Build.model_validate_json(path.read_text()) if path.exists() else None

    def all(self) -> list[Build]:
        builds = [Build.model_validate_json(p.read_text()) for p in self.root.glob("*.json")]
        return sorted(builds, key=lambda b: -b.created)


class Session:
    def __init__(self, build: Build, store: Store):
        self.build = build
        self.store = store
        self.subscribers: set[asyncio.Queue[dict]] = set()
        self.task: asyncio.Task | None = None
        self.renders: dict[str, asyncio.Future[bytes]] = {}
        self.lock = asyncio.Lock()

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self.subscribers.discard(queue)

    def _publish(self, event: dict) -> None:
        self.store.save(self.build)
        for queue in self.subscribers:
            queue.put_nowait(event)

    async def say(self, text: str, role: str = "assistant", image: str = "") -> None:
        message = Message(role=role, text=text, image=image)  # type: ignore[arg-type]
        self.build.messages.append(message)
        self._publish({"type": "message", "message": message.model_dump()})

    async def step(self, title: str, boxes: list[Box], code: str = "", key: str | None = None) -> Step:
        """Add boxes as one step of the build; they overwrite whatever earlier steps put there."""
        step = Step(index=len(self.build.steps), title=title, code=code, key=key)
        placed = [b.model_copy(update={"step": step.index}) for b in boxes]
        self.build.steps.append(step)
        self.build.boxes += placed
        self._publish({"type": "step", "step": step.model_dump(), "boxes": [b.model_dump() for b in placed]})
        await asyncio.sleep(0)
        return step

    async def rewind(self, steps: int) -> None:
        """Keep only the first `steps` steps and their boxes."""
        self.build.steps = self.build.steps[:steps]
        self.build.boxes = [b for b in self.build.boxes if b.step < steps]
        self._publish({"type": "rewind", "steps": steps})

    def think(self, text: str, reset: bool = False) -> None:
        """Stream the builder's live reasoning; ephemeral, never persisted."""
        for queue in self.subscribers:
            queue.put_nowait({"type": "thinking", "text": text, "reset": reset})

    async def render(self, timeout: float = 30, box: list[int] | None = None, view: View = FOUR_VIEWS) -> bytes | None:
        """Ask an open viewer to render the model, or `box` (x0, y0, z0, x1, y1, z1) of it; None when none answers."""
        request = uuid.uuid4().hex[:8]
        future: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
        self.renders[request] = future
        for queue in self.subscribers:
            queue.put_nowait({"type": "render", "request": request, "box": box} | asdict(view))
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            return None
        finally:
            self.renders.pop(request, None)

    def deliver_render(self, request: str, png: bytes) -> bool:
        future = self.renders.get(request)
        if future is None or future.done():
            return False
        future.set_result(png)
        return True

    async def rename(self, name: str) -> None:
        self.build.name = name
        self._publish({"type": "build", "build": self.build.summary()})

    async def set_status(self, status: str) -> None:
        self.build.status = status  # type: ignore[assignment]
        self._publish({"type": "build", "build": self.build.summary()})


class Builder(Protocol):
    """Anything that turns a request into steps: the scripted demo, or an agent."""

    name: str
    label: str

    async def run(self, session: Session, request: str) -> None: ...
