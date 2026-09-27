"""Live builds: a session owns one build, persists it, and streams every change to subscribers."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import PIL.Image

from blockyard.model import Box, Build, Message, Step

if TYPE_CHECKING:
    from blockyard.renderer import Renderer

DATA = Path(os.environ.get("BLOCKYARD_DATA", Path(__file__).resolve().parents[2] / "data"))
SMALL_EDGE = 240
"""The short side of the chat's small images, twice their size on screen."""
SIDES = ("front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left")


@dataclass(frozen=True)
class View:
    """Where a render looks from: a camera at `eye` when set, else the four views when `angle` is None, else one
    view from that angle and pitch."""

    angle: float | None = None
    pitch: float = 30
    zoom: float = 1
    eye: tuple[float, float, float] | None = None

    def caption(self) -> str:
        zoom = f", zoom {self.zoom:g}x" if self.zoom != 1 else ""
        if self.eye is not None:
            x, y, z = self.eye
            tilt = f", tilted {abs(self.pitch):g} degrees {'down' if self.pitch > 0 else 'up'}" if self.pitch else ""
            return f"one wide view from a camera at x {x:g}, y {y:g}, z {z:g}, turned to the middle{tilt}{zoom}."
        if self.angle is None:
            return f"3/4 front-right, 3/4 back-left, front, and top (back at the top){zoom}."
        side = SIDES[round(self.angle / 45) % 8]
        return f"one view from {self.angle:g} degrees around ({side}), {self.pitch:g} degrees up{zoom}."


FOUR_VIEWS = View()


class UnknownBuild(LookupError):
    """A build id that names no build, or could not name one."""


class Store:
    def __init__(self, root: Path = DATA):
        self.root = root / "builds"
        self.root.mkdir(parents=True, exist_ok=True)
        self._summaries: dict[str, tuple[int, dict]] = {}

    @staticmethod
    def _file(folder: Path, build_id: str, suffix: str) -> Path:
        """The build's file in `folder`; an id that would point outside it names no build."""
        base = os.path.join(os.path.abspath(folder), "")
        path = os.path.normpath(os.path.join(base, f"{build_id}{suffix}"))
        if not path.startswith(base):
            raise UnknownBuild(build_id)
        return Path(path)

    def save(self, build: Build) -> None:
        path = self._file(self.root, build.id, ".json")
        tmp = path.with_suffix(".tmp")
        tmp.write_text(build.model_dump_json())
        tmp.replace(path)

    def thumbnail(self, build_id: str) -> Path:
        return self._file(self.root.parent / "thumbnails", build_id, ".png")

    def thumbnail_version(self, build_id: str) -> int | None:
        """When the thumbnail was saved, in milliseconds; None when there is none."""
        path = self.thumbnail(build_id)
        return path.stat().st_mtime_ns // 1_000_000 if path.exists() else None

    @property
    def images(self) -> Path:
        return self.root.parent / "images"

    def save_image(self, data: bytes, suffix: str = ".png") -> str:
        """Keep an image shown in the chat, a render or an attachment; returns its URL."""
        name = f"{uuid.uuid4().hex[:12]}{suffix}"
        self.images.mkdir(parents=True, exist_ok=True)
        (self.images / name).write_bytes(data)
        return f"/api/images/{name}"

    def small_image(self, name: str) -> Path:
        """The image as WebP with its short side at most SMALL_EDGE, for the chat; made on first use."""
        path = self.images / "small" / f"{name}.webp"
        if not path.exists():
            with PIL.Image.open(self.images / name) as image:
                edge = SMALL_EDGE * max(image.size) // min(image.size)
                image.thumbnail((edge, edge))
                path.parent.mkdir(exist_ok=True)
                tmp = path.with_name(f"{uuid.uuid4().hex}.tmp")
                image.save(tmp, "WEBP", quality=80)
            tmp.replace(path)
        return path

    def load(self, build_id: str) -> Build | None:
        try:
            path = self._file(self.root, build_id, ".json")
        except UnknownBuild:
            return None
        return Build.model_validate_json(path.read_text()) if path.exists() else None

    def all(self) -> list[Build]:
        builds = [Build.model_validate_json(p.read_text()) for p in self.root.glob("*.json")]
        return sorted(builds, key=lambda b: -b.created)

    def summaries(self) -> list[dict]:
        """Every build's summary, newest first; a build is parsed again only when its file changed."""
        out = []
        for path in self.root.glob("*.json"):
            mtime = path.stat().st_mtime_ns
            cached = self._summaries.get(path.name)
            if cached is None or cached[0] != mtime:
                cached = self._summaries[path.name] = (mtime, Build.model_validate_json(path.read_text()).summary())
            out.append(cached[1])
        return sorted(out, key=lambda s: -s["created"])


class Session:
    def __init__(self, build: Build, store: Store, renderer: Renderer | None = None):
        self.build = build
        self.store = store
        self.renderer = renderer
        self.subscribers: set[asyncio.Queue[dict]] = set()
        self.task: asyncio.Task | None = None
        self.renders: dict[str, tuple[dict, asyncio.Future[bytes]]] = {}
        self.lock = asyncio.Lock()

    def subscribe(self) -> asyncio.Queue[dict]:
        """A queue of the build's events, starting with the renders still waiting for a viewer."""
        queue: asyncio.Queue[dict] = asyncio.Queue()
        for event, _ in self.renders.values():
            queue.put_nowait(event)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self.subscribers.discard(queue)

    def _publish(self, event: dict) -> None:
        self.store.save(self.build)
        for queue in self.subscribers:
            queue.put_nowait(event)

    async def say(self, text: str, role: str = "assistant", images: Sequence[str] = ()) -> None:
        message = Message(role=role, text=text, images=list(images))  # type: ignore[arg-type]
        self.build.messages.append(message)
        self._publish({"type": "message", "message": message.model_dump()})

    async def step(self, title: str, boxes: list[Box], code: str = "", key: str | None = None) -> Step:
        """Add boxes as one step of the build; they overwrite whatever earlier steps put there."""
        step = Step(index=len(self.build.steps), title=title, code=code, key=key)
        for b in boxes:
            b.step = step.index
        self.build.steps.append(step)
        self.build.boxes += boxes
        self.build.updated = time.time()
        self._publish({"type": "step", "step": step.model_dump(), "boxes": [b.model_dump() for b in boxes]})
        await asyncio.sleep(0)
        return step

    async def rewind(self, steps: int) -> None:
        """Keep only the first `steps` steps and their boxes."""
        self.build.steps = self.build.steps[:steps]
        self.build.boxes = [b for b in self.build.boxes if b.step < steps]
        self.build.updated = time.time()
        self._publish({"type": "rewind", "steps": steps})

    def think(self, text: str, reset: bool = False) -> None:
        """Stream the builder's live reasoning; ephemeral, never persisted."""
        for queue in self.subscribers:
            queue.put_nowait({"type": "thinking", "text": text, "reset": reset})

    async def render(self, timeout: float = 30, box: list[int] | None = None, view: View = FOUR_VIEWS) -> bytes | None:
        """Ask a viewer to render the model, or `box` (x0, y0, z0, x1, y1, z1) of it; None when none answers."""
        if self.renderer is not None:
            await self.renderer.watch(self.build.id)
        request = uuid.uuid4().hex[:8]
        event = {"type": "render", "request": request, "box": box} | asdict(view)
        future: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()
        self.renders[request] = (event, future)
        for queue in self.subscribers:
            queue.put_nowait(event)
        try:
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            return None
        finally:
            self.renders.pop(request, None)

    def deliver_render(self, request: str, png: bytes) -> bool:
        _, future = self.renders.get(request, (None, None))
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
    max_images: int
    """How many images a user message may attach."""

    async def run(self, session: Session, request: str) -> None: ...
