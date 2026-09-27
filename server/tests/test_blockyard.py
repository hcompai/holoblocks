import asyncio
import gzip
import io
import json

import PIL.Image
import pytest
from fastapi.testclient import TestClient

from blockyard import blocks, gallery, script
from blockyard.builders.scripted import ScriptedBuilder
from blockyard.builders.showcases import SHOWCASES
from blockyard.model import Box, Build, Message
from blockyard.session import Session, Store, UnknownBuild
from blockyard.workbench import Workbench


@pytest.fixture
def bench(tmp_path, monkeypatch):
    session = Session(Build(width=16, depth=16, height=16), Store(tmp_path))
    monkeypatch.setattr(session, "render", lambda **_: asyncio.sleep(0))
    return Workbench(session)


HUT = """
fill(2, 1, 2, 6, 4, 6, "oak_planks", "walls")
set(4, 1, 6, "oak_door[facing=south]")
set(4, 2, 6, "oak_door[facing=south]")
set(4, 1, 2, "nope")
set(4, 1, 3, "oak_stairs[facing=up]")
set(40, 1, 3, "stone")
fill(0, 1, 0, 20, 1, 0, "stone")
fill(8, 1, 8, 9, 1, 8, "tall_grass")
"""


def test_a_script_places_blocks_and_explains_every_skip(bench):
    result = asyncio.run(bench.run_script(HUT))
    world = bench.world()
    assert world.get(2, 3, 4) == "oak_planks"
    assert world.get(4, 1, 6) == "oak_door[facing=south,half=lower]"
    assert world.get(4, 2, 6) == "oak_door[facing=south,half=upper]"
    assert world.get(4, 3, 6) == "oak_planks" and "a door is two blocks tall by itself" in result.text
    assert world.get(9, 2, 8) == "tall_grass[half=upper]"
    assert world.get(4, 1, 4) == "air"
    assert world.get(15, 1, 0) == "stone"
    assert "unknown block 'nope'" in result.text
    assert "facing must be one of" in result.text
    assert "entirely outside" in result.text
    assert "cut at the site edge, blocks at x > 15 dropped" in result.text
    assert bench.build.steps[0].code.strip().startswith("fill(2, 1, 2")


def test_later_steps_overwrite_earlier_ones(bench):
    asyncio.run(
        bench.run_script('step("Base")\nfill(0, 1, 0, 3, 1, 3, "stone")\nstep("Cover")\nset(1, 1, 1, "oak_planks")')
    )
    assert bench.world().get(1, 1, 1) == "oak_planks" and bench.world().get(0, 1, 0) == "stone"


def test_floating_blocks_are_noted_without_counting_as_a_problem(bench):
    result = asyncio.run(
        bench.run_script(
            'step("Tower")\nfill(0, 0, 0, 0, 5, 0, "stone")\nset(1, 5, 0, "lantern")\n'
            'step("Island")\nfill(5, 4, 5, 8, 4, 8, "grass_block")'
        )
    )
    assert "step 'Island': 16 blocks float" in result.text and "`blocks look 5 4 5 8 4 8`" in result.text
    assert "Tower" not in result.text.split("Steps,")[0] and result.problems == 0


LAND = """
import random
step("Land")
fill(0, 0, 0, 9, 2, 9, "70%grass_block,30%moss_block")
print(get(3, 2, 3) in ("grass_block", "moss_block"), get(3, 3, 3))
replace(0, 0, 0, 9, 9, 9, "moss_block", "gravel")
overlay(0, 0, 0, 9, 9, 9, "50%air,50%poppy")
step("Rocks")
for x in range(10):
    set(x, 5, 0, random.choice(["stone", "andesite", "diorite", "granite"]))
"""


def test_worldedit_calls_read_what_the_script_placed_and_every_run_builds_the_same_model():
    first = script.run(LAND)
    assert first == script.run(LAND) and first["printed"] == "True air\n"
    world = {}
    for op in first["steps"][0]["ops"]:
        for y in range(op["y0"], op["y1"] + 1):
            world[op["x0"], y, op["z0"]] = op["block"]
    blocks_ = set(world.values())
    assert blocks_ == {"grass_block", "gravel", "poppy"}
    poppies = [key for key, block in world.items() if block == "poppy"]
    assert {y for _, y, _ in poppies} == {3} and 20 < len(poppies) < 80

    reshuffled = script.run(LAND.replace("fill(0, 0, 0", "random.random(); fill(0, 0, 0"))
    assert reshuffled["steps"][1] == first["steps"][1]


def test_block_states_are_validated():
    assert str(blocks.parse("minecraft:oak_stairs[half=top,facing=north]")) == "oak_stairs[facing=north,half=top]"
    with pytest.raises(ValueError, match="takes no state"):
        blocks.parse("stone[facing=north]")
    assert "oak_stairs" in blocks.search("oak roof")


@pytest.mark.parametrize("showcase", SHOWCASES, ids=lambda s: s.key)
def test_showcases_replay_their_script_step_by_step_told_by_its_comments(tmp_path, showcase):
    session = Session(Build(), Store(tmp_path))
    asyncio.run(ScriptedBuilder(showcase, delay=0).run(session, showcase.name))
    steps, messages = session.build.steps, session.build.messages
    problems = [m.text for m in messages if m.role == "tool" and "\n" in m.text]
    assert not problems, problems
    told = [m.text for m in messages if m.role == "assistant"][1:-1]
    assert len(steps) == len(told) > 1 and session.build.name == showcase.name
    assert (session.build.width, session.build.height, session.build.depth) == showcase.site
    for step, text in zip(steps, told, strict=True):
        assert step.code.startswith(f"# {text[:40]}") and not step.code.splitlines()[-1].startswith("#")
    world = Workbench(session).world()
    schem = gzip.decompress(world.schematic())
    assert schem.startswith(b"\x0a\x00\x09Schematic")
    assert all(f"minecraft:{block}".encode() in schem for block in world.counts())


def test_gallery_exports_the_latest_showcase_runs_with_everything_the_viewer_reads(tmp_path):
    store = Store(tmp_path / "data")
    key = SHOWCASES[0].key
    stone = Box(x0=0, y0=0, z0=0, x1=1, y1=1, z1=1, block="stone", step=0)
    png = io.BytesIO()
    PIL.Image.new("RGBA", (896, 896), "gray").save(png, "PNG")
    render = Message(role="tool", text="Ran the script", images=[store.save_image(png.getvalue())])
    old = Build(builder=key, status="done", created=1)
    new = Build(builder=key, status="done", created=2, boxes=[stone], messages=[render])
    holo, listed = Build(builder="holo", status="done", created=3), Build(builder="holo", status="done", created=4)
    for build in (old, new, holo, listed):
        store.save(build)
    assert gallery.default_ids(store) == [new.id]
    (tmp_path / "data" / "gallery.txt").write_text(f"{listed.id}\n")
    assert gallery.default_ids(store) == [new.id, listed.id]
    out = gallery.export(store, [new.id], tmp_path / "site")
    assert [b["id"] for b in json.loads((out / "builds.json").read_text())] == [new.id]
    exported = Build.model_validate_json((out / "builds" / f"{new.id}.json").read_text())
    assert exported.boxes == [stone]
    name = exported.messages[0].images[0].removeprefix("/gallery/images/")
    assert PIL.Image.open(out / "images" / "small" / f"{name}.webp").size == (240, 240)
    assert gzip.decompress((out / "builds" / f"{new.id}.schem").read_bytes()).startswith(b"\x0a\x00\x09Schematic")
    assert "stone" in json.loads((out / "blocks.json").read_text())


def test_a_viewer_that_opens_late_still_answers_the_waiting_render(tmp_path):
    async def main():
        session = Session(Build(), Store(tmp_path))
        waiting = asyncio.create_task(session.render(timeout=5))
        await asyncio.sleep(0)
        request = session.subscribe().get_nowait()["request"]
        assert session.deliver_render(request, b"png")
        return await waiting

    assert asyncio.run(main()) == b"png"


def test_a_build_id_that_could_leave_the_store_names_no_build(tmp_path, monkeypatch):
    from blockyard import app as app_module

    store = Store(tmp_path / "data")
    (tmp_path / "data" / "leak.json").write_text(Build().model_dump_json())
    assert store.load("../leak") is None
    with pytest.raises(UnknownBuild):
        store.thumbnail("../leak")
    monkeypatch.setattr(app_module, "store", store)
    with TestClient(app_module.app) as http:
        assert http.get("/api/builds/..leak/thumbnail.png").status_code == 404
        assert http.get("/api/builds/..leak").status_code == 404
