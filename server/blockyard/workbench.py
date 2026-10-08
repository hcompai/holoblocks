"""The model an agent edits: a build script rebuilt into validated steps, and block search."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass

from blockyard import blocks
from blockyard.model import UNNAMED, Box, Build, Step
from blockyard.workspace import MODEL, Workspace
from blockyard.world import World

SCRIPT_TIMEOUT_S = 60
PROBLEM_LIMIT = 12
FLOATING_LIMIT = 5
MAX_STEP_BLOCKS = 2_000_000


@dataclass
class Result:
    text: str
    problems: int = 0


def _first(lines: list[str]) -> str:
    extra = len(lines) - PROBLEM_LIMIT
    return "\n".join(lines[:PROBLEM_LIMIT] + ([f"... and {extra} more like these."] if extra > 0 else []))


class Workbench:
    def __init__(self, workspace: Workspace):
        self.workspace = workspace

    @property
    def build(self) -> Build:
        return self.workspace.build

    def world(self) -> World:
        return World.of(self.build)

    def _check(self, ops: list[dict]) -> tuple[list[Box], list[tuple[int, str]]]:
        """Validate and clip ops; returns the boxes to place and (op index, reason) for each call skipped or clipped."""
        w, d, h = self.build.width, self.build.depth, self.build.height
        boxes, rejected = [], []
        lowers: set[tuple[int, int, int]] = set()
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
            tall = state.name != "air" and blocks.shape(state.name) in blocks.TWO_TALL and "half" not in state.props
            if tall:
                cells = [(x, z) for x in range(box.x0, box.x1 + 1) for z in range(box.z0, box.z1 + 1)]
                stacked = any((x, box.y0 - 1, z) in lowers for x, z in cells)
                if stacked or box.y1 > box.y0:
                    kind = "door" if blocks.shape(state.name) == "door" else state.name
                    rejected.append((n, f"a {kind} is two blocks tall by itself: set only its lower block"))
                if stacked:
                    continue
                box = box.model_copy(update={"y1": box.y0})
                lowers.update((x, box.y0, z) for x, z in cells)
            volume += box.volume
            if volume > MAX_STEP_BLOCKS:
                rejected.append((n, f"this step fills more than {MAX_STEP_BLOCKS} blocks; stopped here"))
                break
            boxes.append(box)
            if tall and box.y1 + 1 < h:
                lower = blocks.BlockState(state.name, {**state.props, "half": "lower"})
                upper = blocks.BlockState(state.name, {**state.props, "half": "upper"})
                boxes[-1] = box.model_copy(update={"block": str(lower)})
                boxes.append(box.model_copy(update={"y0": box.y1 + 1, "y1": box.y1 + 1, "block": str(upper)}))
        return boxes, rejected

    def run_script(self, code: str) -> Result:
        """Rebuild the model from `code`: steps up to the first changed one stay, the rest are rebuilt and checked."""
        build = self.build
        out = execute(code, (build.width, build.height, build.depth))
        printed = f"\nThe script printed:\n{out['printed']}" if out.get("printed") else ""
        if "error" in out:
            return Result(f"The script stopped, so the model did not change.\n{out['error']}{printed}", problems=1)
        steps = out["steps"]
        keys = [_digest(s) for s in steps]
        old = [s.key for s in build.steps]
        same = 0
        while same < min(len(old), len(keys)) and old[same] == keys[same]:
            same += 1
        candidate = build.model_copy(
            update={
                "script": code,
                "steps": build.steps[:same],
                "boxes": [b for b in build.boxes if b.step < same],
            }
        )
        world = World.of(candidate)
        source = code.splitlines()
        reports = []
        for n in range(same, len(steps)):
            reports += self.place(candidate, world, source, steps, n)
        self.workspace.commit(candidate)
        floating = self._floating(world)
        problems = len(reports)
        kept = "" if not same else "kept step 1 unchanged, " if same == 1 else f"kept steps 1 to {same} unchanged, "
        rebuilt = len(steps) - same
        lines = [
            f"Ran the script: {kept}rebuilt and checked {rebuilt} step{'' if rebuilt == 1 else 's'}.",
            f"Share {MODEL} to show revision {self.build.revision[:8]} to the user, then call look to see it.",
        ]
        if reports:
            lines += ["Problems, by script line:", _first(reports)]
        else:
            lines.append("No problems: every block is known, on the site, and every step shows.")
        if floating:
            lines += ["Floating, fine only if the subject flies or hangs there:", *floating]
        if out.get("backwards"):
            lines.append(
                "Spans whose end is one below their start fill both cells; skip the call if the range is empty:"
            )
            for b in out["backwards"][:PROBLEM_LIMIT]:
                times = f" ({b['count']} times)" if b["count"] > 1 else ""
                lines.append(f"{_line(source, b['line'])}: {b['axis']}{times}")
        lines.append(
            "Steps, with exact sizes and positions: blocks set, then where they sit (x, z, and y from bottom to top):"
        )
        lines.append(self.describe())
        lines.append(self.summary(world))
        return Result("\n".join(lines) + printed, problems=problems)

    def place(self, build: Build, world: World, source: list[str], steps: list[dict], n: int) -> list[str]:
        """Check step `n` of a script run and add it to `build` and `world`; returns its problems, by script line."""
        s = steps[n]
        ops = [{k: v for k, v in op.items() if k != "line"} for op in s["ops"]]
        boxes, rejected = self._check(ops)
        changed = world.apply(boxes)
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
        index = len(build.steps)
        build.steps = [*build.steps, Step(index=index, title=s["title"], code=code, key="" if lines else _digest(s))]
        build.boxes = [*build.boxes, *(b.model_copy(update={"step": index}) for b in boxes)]
        return lines

    def _floating(self, world: World) -> list[str]:
        """One problem per group of touching blocks that nothing joins to the ground, the largest first."""
        groups = world.floating()
        titles = {s.index: s.title for s in self.build.steps}
        lines = []
        for group in groups[:FLOATING_LIMIT]:
            x, y, z = group[0]
            step = next(
                b.step
                for b in reversed(self.build.boxes)
                if b.block != "air" and b.x0 <= x <= b.x1 and b.y0 <= y <= b.y1 and b.z0 <= z <= b.z1
            )
            xs, ys, zs = zip(*group)
            box = f"[{min(xs)}, {min(ys)}, {min(zs)}, {max(xs)}, {max(ys)}, {max(zs)}]"
            lines.append(
                f"step '{titles[step]}': {len(group)} blocks float, joined to nothing that reaches"
                f" the ground; see them with look box {box}"
            )
        if len(groups) > FLOATING_LIMIT:
            rest = groups[FLOATING_LIMIT:]
            lines.append(f"{len(rest)} more floating groups, {sum(map(len, rest))} blocks in all")
        return lines

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

    def find_blocks(self, query: str) -> Result:
        hits = blocks.search(query)
        return Result(", ".join(blocks.describe(h) for h in hits[:60]) if hits else f"No blocks match '{query}'.")

    def rename(self, name: str) -> Result:
        self.workspace.save(self.build.model_copy(update={"name": name.strip()[:60] or UNNAMED}))
        return Result(f"Build is now called '{self.build.name}'.")

    def summary(self, world: World | None = None) -> str:
        world = world or self.world()
        counts = world.counts()
        bounds = world.bounds()
        if bounds is None:
            return "The site is empty apart from the ground."
        (x0, _, z0), (x1, y1, z1) = bounds
        total = sum(counts.values())
        top = ", ".join(f"{name} {n}" for name, n in counts.most_common(5))
        steps = len(self.build.steps)
        return f"{total} block{'' if total == 1 else 's'} in {steps} step{'' if steps == 1 else 's'}, spanning x {x0}-{x1}, z {z0}-{z1}, up to y={y1}. Most used: {top}."


def _line(source: list[str], n: int) -> str:
    return f"line {n} `{source[n - 1].strip()[:70]}`" if 0 < n <= len(source) else f"line {n}"


def _digest(step: dict) -> str:
    ops = [{k: v for k, v in op.items() if k != "line"} for op in step["ops"]]
    return hashlib.sha256(json.dumps([step["title"], ops], sort_keys=True).encode()).hexdigest()[:16]


def execute(code: str, site: tuple[int, int, int]) -> dict:
    """Run a build script on a site (width, height, depth) in a fresh process with an empty environment and a time limit."""
    try:
        process = subprocess.run(
            [sys.executable, "-I", "-m", "blockyard.script"],
            input=json.dumps({"code": code, "site": site}).encode(),
            capture_output=True,
            env={},
            cwd=tempfile.gettempdir(),
            timeout=SCRIPT_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"error": f"The script ran for over {SCRIPT_TIMEOUT_S} s; look for a loop that never ends."}
    if process.returncode:
        return {"error": f"The script runner crashed: {process.stderr.decode(errors='replace')[-500:]}"}
    return json.loads(process.stdout)
