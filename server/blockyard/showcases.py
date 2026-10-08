"""Showcases: strong build scripts in agent/showcase, all shipped to the agent; the gallery shows the ones Holo built."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import takewhile
from pathlib import Path

from blockyard.model import Build, Step
from blockyard.workbench import Workbench
from blockyard.workspace import Workspace

SCRIPTS = Path(__file__).resolve().parents[2] / "agent" / "showcase"


@dataclass(frozen=True)
class Showcase:
    key: str
    name: str
    intro: str
    builder: str
    site: tuple[int, int, int] = (64, 64, 64)

    @property
    def path(self) -> Path:
        return SCRIPTS / f"{self.key}.py"

    def build(self) -> Build:
        width, height, depth = self.site
        bench = Workbench(Workspace(Build(name=self.name, width=width, height=height, depth=depth)))
        result = bench.run_script(self.path.read_text())
        if result.problems:
            raise ValueError(f"The {self.name} script has problems:\n{result.text}")
        return bench.build


def told(step: Step) -> str:
    """The comment above a step in its script, as one sentence."""
    return " ".join(line.lstrip("# ") for line in takewhile(lambda line: line.startswith("#"), step.code.splitlines()))


SHOWCASES = [
    Showcase(
        key="steampunk-manor",
        name="Overgrown Steampunk Manor",
        intro=(
            "Scripted showcase: an overgrown steampunk manor with a steep copper roof, timber-framed plaster and "
            "smoking chimneys."
        ),
        builder="claude",
    ),
    Showcase(
        key="gothic-cathedral",
        name="Gothic Cathedral",
        intro=(
            "Scripted showcase: a dark gothic cathedral with flying buttresses, rose windows, gargoyles and "
            "two openwork stone spires, built one step at a time."
        ),
        builder="claude",
        site=(64, 96, 64),
    ),
    Showcase(
        key="bag-end",
        name="Bag End, Under the Hill",
        intro=(
            "Scripted showcase: Bilbo's round green door dug into a grassy hill under a great oak, with Bagshot Row, "
            "fields, hedgerows and sheep around it."
        ),
        builder="claude",
        site=(128, 100, 128),
    ),
    Showcase(
        key="caras-galadhon",
        name="Caras Galadhon, Lothlorien",
        intro=(
            "Scripted showcase: the elven city in the gold mallorn trees, flets and winding stairs on a hill ringed "
            "by a green wall and a moat, hanging bridges and Galadriel's pavilion near the top."
        ),
        builder="claude",
        site=(112, 100, 112),
    ),
]
