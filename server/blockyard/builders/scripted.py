"""Scripted builders: a showcase is a fixed list of titled JavaScript steps, replayed with a short pause."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from blockyard.session import Session
from blockyard.workbench import Workbench


@dataclass(frozen=True)
class Showcase:
    key: str
    name: str
    label: str
    intro: str
    steps: list[tuple[str, str, str]]
    ground: bool = True
    height: int = 64


class ScriptedBuilder:
    def __init__(self, showcase: Showcase, delay: float = 0.6):
        self.showcase = showcase
        self.name = showcase.key
        self.label = showcase.label
        self.delay = delay

    async def run(self, session: Session, request: str) -> None:
        bench = Workbench(session)
        if len(session.build.steps) > 1:
            await session.say("This showcase is scripted and already built; start a new build to see it again.")
            return
        session.build.height = self.showcase.height
        await session.rename(self.showcase.name)
        await session.say(self.showcase.intro)
        if self.showcase.ground:
            await bench.ensure_ground()
        for title, message, code in self.showcase.steps:
            await session.say(message)
            result = await bench.run(title, code)
            if result.note:
                await session.say(result.text, role="tool")
            await asyncio.sleep(self.delay)
        await session.say(f"Done: {bench.summary()}")
