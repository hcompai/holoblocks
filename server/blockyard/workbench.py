"""The stateful model an agent edits: a build script rebuilt into validated steps, block search, and renders."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field

import httpx

from blockyard import blocks, reference
from blockyard.model import Box
from blockyard.session import Session, View
from blockyard.world import World

SCRIPT_TIMEOUT_S = 60
PROBLEM_LIMIT = 12
MAX_STEP_BLOCKS = 2_000_000


@dataclass
class Picture:
    data: bytes
    mime: str
    title: str = ""
    url: str = ""


@dataclass
class Result:
    text: str
    note: str | None = None
    images: list[Picture] = field(default_factory=list)
    """Images the agent should see."""
    kind: str | None = None
    """What the images are, like `render`; an agent keeps only the latest images of each kind in context."""
    caption: str = ""
    problems: int = 0


def _first(lines: list[str]) -> str:
    extra = len(lines) - PROBLEM_LIMIT
    return "\n".join(lines[:PROBLEM_LIMIT] + ([f"... and {extra} more like these."] if extra > 0 else []))


class Workbench:
    def __init__(self, session: Session):
        self.session = session

    @property
    def build(self):
        return self.session.build

    def world(self) -> World:
        return World.of(self.build)

    def _check(self, ops: list[dict]) -> tuple[list[Box], list[tuple[int, str]]]:
        """Validate and clip ops; returns the boxes to place and (op index, reason) for each call skipped or clipped."""
        w, d, h = self.build.width, self.build.depth, self.build.height
        boxes, rejected = [], []
        volume = 0
        for n, op in enumerate(ops):
            try:
                state = blocks.parse(op["block"])
            except ValueError as e:
                rejected.append((n, str(e)))
                continue
            if op["x1"] < 0 or op["y1"] < 0 or op["z1"] < 0 or op["x0"] >= w or op["y0"] >= h or op["z0"] >= d:
                rejected.append((n, f"entirely outside the site (x 0-{w - 1}, y 0-{h - 1}, z 0-{d - 1})"))
                continue
            clipped = dict(op, x0=max(op["x0"], 0), y0=max(op["y0"], 0), z0=max(op["z0"], 0))
            clipped.update(x1=min(op["x1"], w - 1), y1=min(op["y1"], h - 1), z1=min(op["z1"], d - 1))
            if clipped != op:
                edges = [f"{a} < 0" for a in "xyz" if op[f"{a}0"] < 0] + [
                    f"{a} > {size - 1}" for a, size in zip("xyz", (w, h, d)) if op[f"{a}1"] >= size
                ]
                rejected.append((n, f"cut at the site edge, blocks at {' and '.join(edges)} dropped"))
            box = Box(**{k: v for k, v in clipped.items() if k != "block"}, block=str(state), step=0)
            volume += box.volume
            if volume > MAX_STEP_BLOCKS:
                rejected.append((n, f"this step fills more than {MAX_STEP_BLOCKS} blocks; stopped here"))
                break
            boxes.append(box)
            if state.name != "air" and blocks.shape(state.name) == "door" and box.y1 + 1 < h:
                lower = blocks.BlockState(state.name, {**state.props, "half": "lower"})
                upper = blocks.BlockState(state.name, {**state.props, "half": "upper"})
                boxes[-1] = box.model_copy(update={"block": str(lower)})
                boxes.append(box.model_copy(update={"y0": box.y1 + 1, "y1": box.y1 + 1, "block": str(upper)}))
        return boxes, rejected

    async def run_script(self, code: str) -> Result:
        """Rebuild the model from `code`: steps up to the first changed one stay, the rest are rebuilt and checked."""
        build = self.build
        build.script = code
        fixed = self._fixed()
        out = await execute(code, (build.width, build.height, build.depth))
        printed = f"\nThe script printed:\n{out['printed']}" if out.get("printed") else ""
        if "error" in out:
            self.session.store.save(build)
            return Result(f"The script stopped, so the model did not change.\n{out['error']}{printed}", problems=1)
        steps = out["steps"]
        keys = [_digest(s) for s in steps]
        old = [s.key for s in build.steps[fixed:]]
        same = 0
        while same < min(len(old), len(keys)) and old[same] == keys[same]:
            same += 1
        await self.session.rewind(fixed + same)
        world = await asyncio.to_thread(self.world)
        source = code.splitlines()
        reports = []
        for n in range(same, len(steps)):
            reports += await self.place(world, source, steps, n)
        problems = len(reports)
        kept = (
            ""
            if not same
            else f"kept step {fixed + 1}, "
            if same == 1
            else f"kept steps {fixed + 1} to {fixed + same}, "
        )
        lines = [f"Ran the script: {kept}rebuilt {len(steps) - same} steps."]
        if reports:
            lines += ["Problems, by script line:", _first(reports)]
        else:
            lines.append("No problems: every block is known, on the site, and every step shows.")
        lines.append("Steps: blocks set, then where they sit (x, z, and y from bottom to top):")
        lines.append(await asyncio.to_thread(self.describe))
        seen = await self.look(f"Ran the script: {build.name}" + (f", {problems} problems" if problems else ""))
        return Result(
            "\n".join(lines) + printed + "\n" + seen.text,
            note=seen.note,
            images=seen.images,
            kind=seen.kind,
            caption=seen.caption,
            problems=problems,
        )

    async def place(self, world: World, source: list[str], steps: list[dict], n: int) -> list[str]:
        """Check step `n` of a script run and add it to the model; returns its problems, by script line."""
        s = steps[n]
        ops = [{k: v for k, v in op.items() if k != "line"} for op in s["ops"]]
        boxes, rejected = await asyncio.to_thread(self._check, ops)
        changed = await asyncio.to_thread(world.apply, boxes)
        skipped = Counter((_line(source, s["ops"][i]["line"]), why) for i, why in rejected)
        lines = [
            f"{where}: {why}" + (f" ({count} times)" if count > 1 else "") for (where, why), count in skipped.items()
        ]
        if not changed:
            lines.append(
                f"{_line(source, s['line'])}: step '{s['title']}' changed no block; it only repeats blocks already there"
            )
        start, end = s["line"], steps[n + 1]["line"] if n + 1 < len(steps) else len(source) + 1
        while start > 1 and source[start - 2].startswith("#"):
            start -= 1
        while end > s["line"] + 1 and source[end - 2].startswith("#"):
            end -= 1
        code = "\n".join(source[start - 1 : max(end - 1, s["line"])]).strip()
        await self.session.step(s["title"], boxes, code, "" if lines else _digest(s))
        return lines

    def _fixed(self) -> int:
        """How many steps were built before the script; it builds on them and never changes them."""
        return next((s.index for s in self.build.steps if s.key is not None), len(self.build.steps))

    def brief(self) -> str:
        """The model as a new request finds it: its steps, and the script behind them."""
        lines = ["Steps:", self.describe()]
        fixed, script = self._fixed(), self.build.script
        if fixed:
            lines.append(f"Steps 1-{fixed} were built before the script; it builds on them and cannot change them.")
        lines += ["The build script:", _numbered(script)] if script else ["No build script yet."]
        return "\n".join(lines)

    def describe(self) -> str:
        """One line per step: the blocks it sets and the box they span."""
        spans: dict[int, list[Box]] = {}
        for b in self.build.boxes:
            if b.block != "air":
                spans.setdefault(b.step, []).append(b)
        lines = []
        for step in self.build.steps:
            boxes = spans.get(step.index)
            if not boxes:
                lines.append(f"{step.index + 1} {step.title}: clears only")
                continue
            x = f"{min(b.x0 for b in boxes)}-{max(b.x1 for b in boxes)}"
            z = f"{min(b.z0 for b in boxes)}-{max(b.z1 for b in boxes)}"
            y = f"{min(b.y0 for b in boxes)}-{max(b.y1 for b in boxes)}"
            n = sum(b.volume for b in boxes)
            lines.append(f"{step.index + 1} {step.title}: {n} block{'s' * (n != 1)}, x {x}, z {z}, y {y}")
        return "\n".join(lines) or "No steps yet."

    async def look(
        self, note: str = "Looked at the model", box: str = "", angle: str = "", pitch: str = "", zoom: str = ""
    ) -> Result:
        """Render the four views, or one view from `angle` and `pitch` in degrees; of the model, or only of `box`."""
        corners = [int(v) for v in re.findall(r"-?\d+", box)]
        if box and len(corners) != 6:
            return Result(f"box needs six numbers, x0 y0 z0 x1 y1 z1; got '{box}'", problems=1)
        try:
            around = float(angle) % 360 if angle else 0.0 if pitch else None
            view = View(around, float(pitch or 30), float(zoom or 1))
        except ValueError:
            return Result(f"angle, pitch and zoom are numbers; got '{angle}', '{pitch}', '{zoom}'", problems=1)
        if not 0 <= view.pitch <= 90 or not 1 <= view.zoom <= 8:
            return Result(
                f"pitch goes from 0 to 90 and zoom from 1 to 8; got {view.pitch:g} and {view.zoom:g}", problems=1
            )
        png = await self.session.render(box=corners or None, view=view)
        summary = await asyncio.to_thread(self.summary)
        if png is None:
            return Result(f"No viewer is open, so no image this time.\n{summary}", note=f"{note} (no viewer open)")
        caption = f"The render: {view.caption()}"
        if corners:
            caption = f"Close-up of x {corners[0]}-{corners[3]}, y {corners[1]}-{corners[4]}, z {corners[2]}-{corners[5]}, showing only the blocks inside: {view.caption()}"
        await self.session.say(note, role="tool", image=self.session.store.save_image(png))
        return Result(summary, images=[Picture(png, "image/png")], kind="render", caption=caption)

    async def find_reference(self, query: str) -> Result:
        try:
            photos = await reference.search(query)
        except (httpx.HTTPError, ValueError) as e:
            return Result(f"Reference search failed ({e}). Build from what you know.")
        if not photos:
            return Result(f"No photos for '{query}'. Try a more common name, or build from what you know.")
        await self.session.say(f"Found reference photos for '{query}'", role="tool")
        return Result(
            f"Found {len(photos)} photos from Wikipedia for '{query}'.",
            images=[Picture(p.data, p.mime, p.title, p.url) for p in photos],
            kind="reference",
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
        counts = world.counts()
        bounds = world.bounds()
        if bounds is None:
            return "The site is empty apart from the ground."
        (x0, _, z0), (x1, y1, z1) = bounds
        total = sum(counts.values())
        top = ", ".join(f"{name} {n}" for name, n in counts.most_common(5))
        return f"{total} blocks in {len(self.build.steps)} steps, spanning x {x0}-{x1}, z {z0}-{z1}, up to y={y1}. Most used: {top}."


def _numbered(script: str) -> str:
    return "\n".join(f"{n:>4}  {line}" for n, line in enumerate(script.splitlines(), 1))


def _line(source: list[str], n: int) -> str:
    return f"line {n} `{source[n - 1].strip()[:70]}`" if 0 < n <= len(source) else f"line {n}"


def _digest(step: dict) -> str:
    ops = [{k: v for k, v in op.items() if k != "line"} for op in step["ops"]]
    return hashlib.sha256(json.dumps([step["title"], ops], sort_keys=True).encode()).hexdigest()[:16]


async def execute(code: str, site: tuple[int, int, int]) -> dict:
    """Run a build script on a site (width, height, depth) in a fresh process with an empty environment and a time limit."""
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        "-m",
        "blockyard.script",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={},
        cwd=tempfile.gettempdir(),
    )
    try:
        out, err = await asyncio.wait_for(
            process.communicate(json.dumps({"code": code, "site": site}).encode()), SCRIPT_TIMEOUT_S
        )
    except TimeoutError:
        return {"error": f"The script ran for over {SCRIPT_TIMEOUT_S} s; look for a loop that never ends."}
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    if process.returncode:
        return {"error": f"The script runner crashed: {err.decode(errors='replace')[-500:]}"}
    return json.loads(out)
