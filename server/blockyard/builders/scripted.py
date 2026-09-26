"""Scripted builders: a showcase is a build script replayed one step at a time, told by the comment above each step."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from blockyard.session import Session
from blockyard.workbench import Workbench, execute

SCRIPTS = Path(__file__).with_name("showcases")


@dataclass(frozen=True)
class Showcase:
    key: str
    name: str
    label: str
    intro: str
    height: int = 64

    @property
    def path(self) -> Path:
        return SCRIPTS / f"{self.key}.py"


class ScriptedBuilder:
    def __init__(self, showcase: Showcase, delay: float = 0.6):
        self.showcase = showcase
        self.name = showcase.key
        self.label = showcase.label
        self.delay = delay

    async def run(self, session: Session, request: str) -> None:
        bench = Workbench(session)
        if session.build.steps:
            await session.say("This showcase is scripted and already built; start a new build to see it again.")
            return
        build = session.build
        build.height = self.showcase.height
        code = self.showcase.path.read_text()
        out = await execute(code, (build.width, build.height, build.depth))
        if "error" in out:
            raise RuntimeError(f"The {self.showcase.name} script stopped: {out['error']}")
        session.build.script = code
        await session.rename(self.showcase.name)
        await session.say(self.showcase.intro)
        source, steps = code.splitlines(), out["steps"]
        world = await asyncio.to_thread(bench.world)
        for n, step in enumerate(steps):
            await session.say(_told(source, step["line"]))
            problems = await bench.place(world, source, steps, n)
            summary = await asyncio.to_thread(bench.summary)
            await session.say("\n".join([f"Step {n + 1} '{step['title']}'. {summary}", *problems]), role="tool")
            await asyncio.sleep(self.delay)
        await session.say(f"Done: {bench.summary()}")


def _told(source: list[str], line: int) -> str:
    """The comment lines right above script line `line`, as one sentence."""
    above = []
    for text in reversed(source[: line - 1]):
        if not text.startswith("#"):
            break
        above.append(text.lstrip("# "))
    return " ".join(reversed(above))
