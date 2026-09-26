"""Scripted builder that exercises the shell: always builds the same castle, one step at a time."""

from __future__ import annotations

import asyncio

from blockyard.session import Session
from blockyard.workbench import Workbench

STEPS: list[tuple[str, str, str]] = [
    (
        "Curtain walls",
        "Curtain walls first: a hollow ring of stone bricks with a walkway and battlements on top.",
        """
fill(8, 1, 8, 55, 6, 55, "stone_bricks", "walls");
fill(9, 6, 9, 54, 6, 54, "stone_bricks", "walls");
fill(8, 7, 8, 55, 7, 55, "stone_brick_slab", "walls");
for (let i = 8; i <= 55; i += 2) {
  set(i, 7, 8, "stone_bricks"); set(i, 7, 55, "stone_bricks");
  set(8, 7, i, "stone_bricks"); set(55, 7, i, "stone_bricks");
}
""",
    ),
    (
        "Corner towers",
        "Four round-ish corner towers, taller than the walls, with pointed dark oak roofs.",
        """
for (const [cx, cz] of [[8, 8], [55, 8], [8, 55], [55, 55]]) {
  fill(cx - 3, 1, cz - 3, cx + 3, 13, cz + 3, "cobblestone", "walls");
  fill(cx - 2, 1, cz - 2, cx + 2, 12, cz + 2, "air");
  fill(cx - 3, 13, cz - 3, cx + 3, 13, cz + 3, "stone_bricks");
  for (let k = 0; k < 4; k++) fill(cx - 3 + k, 14 + k, cz - 3 + k, cx + 3 - k, 14 + k, cz + 3 - k, "dark_oak_planks");
  set(cx, 18, cz, "dark_oak_fence");
  for (let y = 4; y <= 10; y += 3) {
    set(cx - 3, y, cz, "glass_pane"); set(cx + 3, y, cz, "glass_pane");
    set(cx, y, cz - 3, "glass_pane"); set(cx, y, cz + 3, "glass_pane");
  }
}
""",
    ),
    (
        "Gatehouse",
        "A gatehouse on the south wall: two flanking towers, an arched gate with iron bars above the doors.",
        """
fill(27, 1, 54, 36, 10, 56, "stone_bricks");
fill(29, 1, 53, 34, 4, 56, "air");
fill(29, 4, 53, 34, 4, 56, "stone_brick_stairs[facing=south,half=top]");
for (let x = 27; x <= 36; x += 2) set(x, 11, 55, "stone_bricks");
fill(28, 11, 54, 35, 11, 54, "stone_brick_slab");
set(31, 1, 56, "oak_door[facing=south]"); set(32, 1, 56, "oak_door[facing=south]");
fill(30, 1, 56, 30, 3, 56, "iron_bars"); fill(33, 1, 56, 33, 3, 56, "iron_bars");
set(30, 5, 57, "lantern"); set(33, 5, 57, "lantern");
""",
    ),
    (
        "Keep",
        "The keep in the middle: thick stone brick walls, glass windows, and a stepped deepslate roof.",
        """
fill(24, 1, 24, 39, 12, 39, "stone_bricks", "walls");
fill(24, 1, 24, 39, 1, 39, "polished_andesite");
for (let y = 3; y <= 10; y += 4) for (let i = 26; i <= 37; i += 3) {
  set(i, y, 24, "glass_pane"); set(i, y, 39, "glass_pane"); set(24, y, i, "glass_pane"); set(39, y, i, "glass_pane");
}
fill(24, 13, 24, 39, 13, 39, "deepslate_tiles");
for (let k = 1; k <= 7; k++) fill(24 + k, 13 + k, 24 + k, 39 - k, 13 + k, 39 - k, "deepslate_tiles");
fill(31, 1, 39, 32, 3, 39, "air");
set(31, 1, 39, "spruce_door[facing=south]"); set(32, 1, 39, "spruce_door[facing=south]");
fill(29, 14, 29, 34, 24, 34, "deepslate_bricks", "walls");
fill(29, 25, 29, 34, 25, 34, "deepslate_bricks");
for (let k = 1; k <= 3; k++) fill(29 + k, 25 + k, 29 + k, 34 - k, 25 + k, 34 - k, "dark_oak_planks");
set(31, 29, 31, "oak_fence"); set(31, 30, 31, "red_wool");
""",
    ),
    (
        "Chapel",
        "A small quartz chapel in the north-west of the courtyard, with a spruce roof and a cross.",
        """
fill(12, 1, 12, 21, 6, 19, "quartz_block", "walls");
fill(12, 1, 12, 21, 1, 19, "smooth_quartz");
for (let x = 13; x <= 20; x += 2) { set(x, 4, 12, "blue_stained_glass_pane"); set(x, 4, 19, "blue_stained_glass_pane"); }
for (let k = 0; k <= 4; k++) {
  fill(12, 7 + k, 12 + k, 21, 7 + k, 12 + k, "spruce_stairs[facing=south]");
  fill(12, 7 + k, 19 - k, 21, 7 + k, 19 - k, "spruce_stairs[facing=north]");
}
fill(12, 7, 13, 21, 7, 18, "spruce_planks");
fill(12, 11, 15, 21, 11, 16, "spruce_planks");
set(16, 1, 20, "spruce_door[facing=south]"); set(17, 1, 20, "spruce_door[facing=south]");
fill(12, 1, 20, 21, 5, 20, "quartz_block", "walls"); fill(16, 1, 20, 17, 3, 20, "air");
set(16, 1, 20, "spruce_door[facing=south]"); set(17, 1, 20, "spruce_door[facing=south]");
fill(16, 12, 15, 17, 14, 16, "spruce_planks"); fill(15, 13, 15, 18, 13, 16, "spruce_planks");
""",
    ),
    (
        "Courtyard",
        "Gravel paths, oak trees, a well and torches to finish the courtyard.",
        """
fill(31, 1, 40, 32, 1, 53, "gravel");
fill(9, 1, 31, 23, 1, 32, "gravel");
for (const [tx, tz] of [[44, 14], [48, 44], [14, 44], [44, 30]]) {
  fill(tx, 1, tz, tx, 5, tz, "oak_log");
  fill(tx - 2, 4, tz - 2, tx + 2, 6, tz + 2, "oak_leaves");
  fill(tx - 1, 7, tz - 1, tx + 1, 7, tz + 1, "oak_leaves");
  fill(tx, 4, tz, tx, 5, tz, "oak_log");
}
fill(18, 1, 44, 20, 1, 46, "cobblestone_wall"); set(19, 1, 45, "water");
set(19, 3, 44, "oak_fence"); set(19, 3, 46, "oak_fence"); fill(18, 4, 44, 20, 4, 46, "spruce_slab");
for (let i = 12; i <= 51; i += 13) { set(i, 8, 9, "torch"); set(i, 8, 54, "torch"); set(9, 8, i, "torch"); set(54, 8, i, "torch"); }
for (const [fx, fz] of [[26, 44], [38, 44], [26, 50], [38, 50]]) { set(fx, 1, fz, "poppy"); set(fx + 1, 1, fz, "dandelion"); }
""",
    ),
]


class DemoBuilder:
    name = "demo"

    def __init__(self, delay: float = 0.6):
        self.delay = delay

    async def run(self, session: Session, request: str) -> None:
        bench = Workbench(session)
        if len(session.build.steps) > 1:
            await session.say("The demo builder only knows one castle, and it is already built.")
            return
        await session.rename("Demo Castle")
        await session.say(
            "Scripted demo builder: I always build the same castle, so you can see the shell work end to end."
        )
        await bench.ensure_ground()
        for title, message, code in STEPS:
            await session.say(message)
            result = await bench.run(title, code)
            if result.note:
                await session.say(result.text, role="tool")
            await asyncio.sleep(self.delay)
        await session.say(f"Done: {bench.summary()}")
