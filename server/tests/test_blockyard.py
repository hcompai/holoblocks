import asyncio
import gzip

import pytest

from blockyard import blocks
from blockyard.builders.scripted import ScriptedBuilder
from blockyard.builders.showcases import SHOWCASES
from blockyard.model import Build
from blockyard.session import Session, Store
from blockyard.workbench import Workbench


@pytest.fixture
def bench(tmp_path):
    session = Session(Build(width=16, depth=16, height=16), Store(tmp_path))
    bench = Workbench(session)
    asyncio.run(bench.ensure_ground())
    return bench


def test_a_step_places_blocks_and_explains_every_skip(bench):
    result = asyncio.run(
        bench.run(
            "Hut",
            """
            fill(2, 1, 2, 6, 4, 6, "oak_planks", "walls");
            set(4, 1, 6, "oak_door[facing=south]");
            set(4, 1, 2, "nope");
            set(4, 1, 3, "oak_stairs[facing=up]");
            set(40, 1, 3, "stone");
            fill(0, 1, 0, 20, 1, 0, "stone");
            """,
        )
    )
    world = bench.world()
    assert world.get(2, 3, 4) == "oak_planks"
    assert world.get(4, 1, 6) == "oak_door[facing=south,half=lower]"
    assert world.get(4, 2, 6) == "oak_door[facing=south,half=upper]"
    assert world.get(4, 1, 4) == "air"
    assert world.get(15, 1, 0) == "stone"
    assert "unknown block 'nope'" in result.text
    assert "facing must be one of" in result.text
    assert "entirely outside" in result.text
    assert "clipped" in result.text
    assert bench.build.steps[1].code.strip().startswith("fill(2, 1, 2")


def test_later_steps_overwrite_and_undo_reveals_earlier_ones(bench):
    asyncio.run(bench.run("Base", 'fill(0, 1, 0, 3, 1, 3, "stone")'))
    asyncio.run(bench.run("Cover", 'fill(0, 1, 0, 3, 1, 3, "oak_planks")'))
    assert bench.world().get(1, 1, 1) == "oak_planks"
    asyncio.run(bench.undo(2))
    assert bench.world().get(1, 1, 1) == "stone"
    assert bench.build.steps[2].title == "Cover (undone)"


def test_script_errors_place_nothing(bench):
    result = asyncio.run(bench.run("Broken", 'fill(0, 1, 0, 3, 1, 3, "stone"); throw new Error("boom")'))
    assert "boom" in result.text
    assert len(bench.build.steps) == 1


def test_block_states_are_validated():
    assert str(blocks.parse("minecraft:oak_stairs[half=top,facing=north]")) == "oak_stairs[facing=north,half=top]"
    with pytest.raises(ValueError, match="takes no state"):
        blocks.parse("stone[facing=north]")
    assert "oak_stairs" in blocks.search("oak roof")


@pytest.mark.parametrize("showcase", SHOWCASES, ids=lambda s: s.key)
def test_showcases_place_every_block_and_export(tmp_path, showcase):
    session = Session(Build(), Store(tmp_path))
    asyncio.run(ScriptedBuilder(showcase, delay=0).run(session, showcase.name))
    skipped = [
        m.text for m in session.build.messages if m.role == "tool" and ("Skipped" in m.text or "failed" in m.text)
    ]
    assert not skipped, skipped
    assert session.build.name == showcase.name
    world = Workbench(session).world()
    schem = gzip.decompress(world.schematic())
    assert schem.startswith(b"\x0a\x00\x09Schematic")
    assert all(f"minecraft:{block}".encode() in schem for block in world.counts())
