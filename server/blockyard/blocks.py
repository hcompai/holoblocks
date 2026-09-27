"""The block palette: what a builder may place, and how the viewer draws it."""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

PALETTE_PATH = Path(__file__).with_name("blocks.json")
STATE = re.compile(r"^([a-z0-9_]+)(?:\[([a-z0-9_=,]*)\])?$")

STATE_KEYS = {
    "stairs": {"facing": {"north", "south", "east", "west"}, "half": {"top", "bottom"}},
    "slab": {"type": {"top", "bottom", "double"}},
    "log": {"axis": {"x", "y", "z"}},
    "door": {"facing": {"north", "south", "east", "west"}, "half": {"lower", "upper"}},
    "trapdoor": {"facing": {"north", "south", "east", "west"}, "half": {"top", "bottom"}, "open": {"true", "false"}},
}


@dataclass(frozen=True)
class BlockState:
    name: str
    props: dict[str, str] = field(default_factory=dict)

    def __str__(self) -> str:
        if not self.props:
            return self.name
        return f"{self.name}[{','.join(f'{k}={v}' for k, v in sorted(self.props.items()))}]"

    @property
    def minecraft(self) -> str:
        return f"minecraft:{self}"


@cache
def palette() -> dict[str, dict]:
    return json.loads(PALETTE_PATH.read_text())


def shape(name: str) -> str:
    return palette()[name].get("shape", "cube")


def parse(text: str) -> BlockState:
    """A block id with optional state, like `oak_stairs[facing=north]`; raises ValueError with the reason."""
    m = STATE.match(text.strip().removeprefix("minecraft:"))
    if not m:
        raise ValueError(f"'{text}' is not a block id like stone_bricks or oak_stairs[facing=north]")
    name, props = m.group(1), {}
    if name != "air" and name not in palette():
        close = difflib.get_close_matches(name, palette(), n=3, cutoff=0.7)
        hint = f"did you mean {' or '.join(close)}?" if close else "search with `blocks find`"
        raise ValueError(f"unknown block '{name}'; {hint}")
    allowed = STATE_KEYS.get(shape(name), {}) if name != "air" else {}
    for pair in filter(None, (m.group(2) or "").split(",")):
        key, _, value = pair.partition("=")
        if key not in allowed:
            raise ValueError(f"'{name}' takes no state '{key}'" + (f"; it takes {sorted(allowed)}" if allowed else ""))
        if value not in allowed[key]:
            raise ValueError(f"'{name}' {key} must be one of {sorted(allowed[key])}, not '{value}'")
        props[key] = value
    return BlockState(name, props)


def search(query: str) -> list[str]:
    words = query.lower().split()
    return [name for name in palette() if all(w in name or w in palette()[name].get("tags", "") for w in words)]


def describe(name: str) -> str:
    info = palette()[name]
    kind = info.get("shape", "cube")
    states = STATE_KEYS.get(kind)
    extra = f" [{', '.join(f'{k}={"|".join(sorted(v))}' for k, v in states.items())}]" if states else ""
    return f"{name}{extra}"
