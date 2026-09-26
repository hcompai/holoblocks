"""The stateful model an agent edits: scripted steps run in a sandbox, validated, and renders from the open viewer."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from blockyard import blocks, reference
from blockyard.model import Box
from blockyard.session import Session
from blockyard.world import World

RUNNER = Path(__file__).with_name("runner.mjs")
RUN_TIMEOUT_S = 15
PROBLEM_LIMIT = 12
MAX_STEP_BLOCKS = 2_000_000


@dataclass
class Result:
    text: str
    note: str | None = None
    images: list[tuple[bytes, str]] = field(default_factory=list)
    """(data, mime) pairs the agent should see."""
    kind: str | None = None
    """What the images are, like `render`; an agent keeps only the latest images of each kind in context."""
    caption: str = ""


def _first(lines: list[str]) -> str:
    extra = len(lines) - PROBLEM_LIMIT
    return "\n".join(lines[:PROBLEM_LIMIT] + ([f"... and {extra} more like these."] if extra > 0 else []))


async def run_script(code: str, width: int, depth: int, height: int) -> dict:
    """Execute a step's JavaScript in the Node sandbox; returns {ops, log, error}."""
    payload = json.dumps({"code": code, "width": width, "depth": depth, "height": height})
    proc = await asyncio.create_subprocess_exec(
        "node",
        str(RUNNER),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(payload.encode()), RUN_TIMEOUT_S)
    except TimeoutError:
        proc.kill()
        return {"ops": [], "log": [], "error": f"the step took more than {RUN_TIMEOUT_S} s"}
    if proc.returncode != 0:
        return {"ops": [], "log": [], "error": f"sandbox failed: {err.decode()[-300:]}"}
    return json.loads(out)


class Workbench:
    def __init__(self, session: Session):
        self.session = session

    @property
    def build(self):
        return self.session.build

    def world(self) -> World:
        world = World(self.build.width, self.build.height, self.build.depth)
        world.apply(self.build.boxes)
        return world

    def _check(self, ops: list[dict]) -> tuple[list[Box], list[str]]:
        w, d, h = self.build.width, self.build.depth, self.build.height
        boxes, rejected = [], []
        volume = 0
        for n, op in enumerate(ops, 1):
            label = f"call {n} ({op['block']} at {op['x0']},{op['y0']},{op['z0']})"
            try:
                state = blocks.parse(op["block"])
            except ValueError as e:
                rejected.append(f"{label}: {e}")
                continue
            if op["x1"] < 0 or op["y1"] < 0 or op["z1"] < 0 or op["x0"] >= w or op["y0"] >= h or op["z0"] >= d:
                rejected.append(f"{label}: entirely outside the site (x 0-{w - 1}, y 0-{h - 1}, z 0-{d - 1})")
                continue
            clipped = dict(op, x0=max(op["x0"], 0), y0=max(op["y0"], 0), z0=max(op["z0"], 0))
            clipped.update(x1=min(op["x1"], w - 1), y1=min(op["y1"], h - 1), z1=min(op["z1"], d - 1))
            if clipped != op:
                rejected.append(f"{label}: clipped to the site (x 0-{w - 1}, y 0-{h - 1}, z 0-{d - 1})")
            box = Box(**{k: v for k, v in clipped.items() if k != "block"}, block=str(state), step=0)
            volume += box.volume
            if volume > MAX_STEP_BLOCKS:
                rejected.append(f"{label}: this step fills more than {MAX_STEP_BLOCKS} blocks; stopped here")
                break
            boxes.append(box)
            if state.name != "air" and blocks.shape(state.name) == "door" and box.y1 + 1 < h:
                lower = blocks.BlockState(state.name, {**state.props, "half": "lower"})
                upper = blocks.BlockState(state.name, {**state.props, "half": "upper"})
                boxes[-1] = box.model_copy(update={"block": str(lower)})
                boxes.append(
                    Box(
                        x0=box.x0,
                        y0=box.y1 + 1,
                        z0=box.z0,
                        x1=box.x1,
                        y1=box.y1 + 1,
                        z1=box.z1,
                        block=str(upper),
                        step=0,
                    )
                )
        return boxes, rejected

    async def ensure_ground(self) -> None:
        if not self.build.steps:
            w, d = self.build.width, self.build.depth
            await self.session.step(
                "Ground", [Box(x0=0, y0=0, z0=0, x1=w - 1, y1=0, z1=d - 1, block="grass_block", step=0)]
            )

    async def run(self, title: str, code: str) -> Result:
        code = code.strip()
        if not code:
            return Result("No code given.")
        result = await run_script(code, self.build.width, self.build.depth, self.build.height)
        log = "\n".join(f"log: {line}" for line in result["log"][:20])
        if result["error"]:
            return Result(
                f"Step '{title}' failed, nothing placed: {result['error']}\n{log}".strip(), note=f"Step failed: {title}"
            )
        boxes, rejected = self._check(result["ops"])
        lines = []
        if boxes:
            step = await self.session.step(title, boxes, code)
            summary = await asyncio.to_thread(self.summary)
            lines.append(f"Step {step.index} '{title}': {len(boxes)} fills. {summary}")
        else:
            lines.append(f"Step '{title}' placed nothing.")
        if rejected:
            lines.append(f"Skipped {len(rejected)}:\n" + _first(rejected))
        if log:
            lines.append(log)
        note = f"Built step: {title}" if boxes else f"Nothing placed for '{title}'"
        return Result("\n".join(lines), note=note)

    async def undo(self, index: int) -> Result:
        if not 0 <= index < len(self.build.steps):
            return Result(f"No step {index}; steps go from 0 to {len(self.build.steps) - 1}.")
        gone = await self.session.undo(index)
        return Result(f"Undid step {index}: {gone} fills removed. {self.summary()}", note=f"Undid step {index}")

    async def look(self) -> Result:
        png = await self.session.render()
        summary = await asyncio.to_thread(self.summary)
        if png is None:
            return Result(f"No viewer is open, so no image this time.\n{summary}", note="Looked (no viewer open)")
        await self.session.say(
            "Looked at the model", role="tool", images=[self.session.store.save_image(png, "image/png")]
        )
        caption = "The render from look: 3/4 front-right, 3/4 back-left, front, and top (back at the top)."
        return Result(summary, images=[(png, "image/png")], kind="render", caption=caption)

    async def find_reference(self, query: str) -> Result:
        try:
            photos = await reference.search(query)
        except (httpx.HTTPError, ValueError) as e:
            return Result(f"Reference search failed ({e}). Build from what you know.")
        if not photos:
            return Result(f"No photos for '{query}'. Try a more common name, or build from what you know.")
        urls = [self.session.store.save_image(p.data, p.mime) for p in photos]
        await self.session.say(f"Reference photos for '{query}'", role="tool", images=urls)
        titles = "; ".join(f"{i}) {p.title}" for i, p in enumerate(photos, 1))
        return Result(
            f"Found {len(photos)} photos from Wikipedia: {titles}. They follow as images.",
            images=[(p.data, p.mime) for p in photos],
            kind="reference",
            caption=f"Reference photos for '{query}', in order: {titles}.",
        )

    async def find_blocks(self, query: str) -> Result:
        hits = blocks.search(query)
        text = ", ".join(blocks.describe(h) for h in hits[:60]) if hits else f"No blocks match '{query}'."
        return Result(text, note=f"Searched blocks for '{query}'")

    async def rename(self, name: str) -> Result:
        await self.session.rename(name.strip()[:60] or "Untitled build")
        return Result(f"Build is now called '{self.build.name}'.")

    def summary(self) -> str:
        world = self.world()
        counts = world.counts(min_y=1)
        bounds = world.bounds(min_y=1)
        if bounds is None:
            return "The site is empty apart from the ground."
        (x0, _, z0), (x1, y1, z1) = bounds
        total = sum(counts.values())
        top = ", ".join(f"{name} {n}" for name, n in counts.most_common(5))
        return f"{total} blocks in {len(self.build.steps)} steps, spanning x {x0}-{x1}, z {z0}-{z1}, up to y={y1}. Most used: {top}."

    def describe(self) -> str:
        if not self.build.steps:
            return "No steps yet."
        lines = [self.summary(), "Steps so far, with their code:"]
        for step in self.build.steps:
            lines.append(f"--- step {step.index}: {step.title}")
            if step.code:
                lines.append(step.code)
        return "\n".join(lines)
