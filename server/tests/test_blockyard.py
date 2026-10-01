import gzip
import json

import pytest

from blockyard import blocks, client, gallery, script, showcases
from blockyard.model import Build
from blockyard.showcases import SHOWCASES, Showcase, told
from blockyard.workbench import Workbench
from blockyard.workspace import BUILD, MODEL, Workspace


@pytest.fixture
def bench(tmp_path):
    return Workbench(Workspace(Build(width=16, depth=16, height=16), tmp_path))


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
    result = bench.run_script(HUT)
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
    bench.run_script('step("Base")\nfill(0, 1, 0, 3, 1, 3, "stone")\nstep("Cover")\nset(1, 1, 1, "oak_planks")')
    assert bench.world().get(1, 1, 1) == "oak_planks" and bench.world().get(0, 1, 0) == "stone"


def test_floating_blocks_are_noted_without_counting_as_a_problem(bench):
    result = bench.run_script(
        'step("Tower")\nfill(0, 0, 0, 0, 5, 0, "stone")\nset(1, 5, 0, "lantern")\n'
        'step("Island")\nfill(5, 4, 5, 8, 4, 8, "grass_block")'
    )
    assert "step 'Island': 16 blocks float" in result.text and "look box [5, 4, 5, 8, 4, 8]" in result.text
    assert "Tower" not in result.text.split("Steps,")[0] and result.problems == 0


def test_each_run_writes_the_model_the_browser_shows_and_keeps_unchanged_steps(tmp_path):
    bench = Workbench(Workspace.open(tmp_path))
    bench.rename("Hut")
    first = bench.run_script('step("Base")\nfill(0, 0, 0, 3, 0, 3, "stone")\nstep("Roof")\nset(1, 1, 1, "oak_planks")')
    revision = bench.build.revision
    assert f"revision {revision[:8]}" in first.text
    model = json.loads(gzip.decompress((tmp_path / MODEL).read_bytes()))
    assert model["name"] == "Hut" and model["revision"] == revision
    assert [s["title"] for s in model["steps"]] == ["Base", "Roof"]
    assert model["blocks"] == ["stone", "oak_planks"] and model["boxes"] == [
        0,
        0,
        0,
        3,
        0,
        3,
        0,
        0,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
    ]

    reopened = Workbench(Workspace.open(tmp_path))
    again = reopened.run_script('step("Base")\nfill(0, 0, 0, 3, 0, 3, "stone")\nstep("Roof")\nset(2, 1, 2, "glass")')
    assert "kept step 1 unchanged, rebuilt and checked 1 step" in again.text and reopened.build.name == "Hut"
    assert Build.model_validate_json((tmp_path / BUILD).read_text()).revision != revision

    stopped = reopened.run_script("fill(")
    assert (
        stopped.problems == 1
        and reopened.build.revision == Build.model_validate_json((tmp_path / BUILD).read_text()).revision
    )


def test_the_shared_model_carries_the_script_that_rebuilds_it_exactly(tmp_path):
    bench = Workbench(Workspace(Build(width=16, depth=16, height=16), tmp_path))
    bench.run_script(HUT)
    bench.run_script("fill(")
    model = json.loads(gzip.decompress((tmp_path / MODEL).read_bytes()))
    assert model["script"] == HUT
    remixed = Workbench(Workspace(Build(width=16, depth=16, height=16)))
    remixed.run_script(model["script"])
    assert remixed.build.revision == model["revision"]


def test_each_run_reports_the_session_clock_and_says_to_finish_late(tmp_path, monkeypatch):
    assert client.tick(tmp_path) == ""
    (tmp_path / client.CLOCK).write_text(json.dumps({"started": 1000, "minutes": 180}))
    monkeypatch.setattr(client.time, "time", lambda: 1000 + 60 * 41)
    assert client.tick(tmp_path) == "Run 1 · 41 of 180 min used\n"
    monkeypatch.setattr(client.time, "time", lambda: 1000 + 60 * 150)
    assert client.tick(tmp_path).startswith("Run 2 · 150 of 180 min used: start nothing new")


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
def test_showcases_build_without_problems_each_step_told_by_its_comment(showcase):
    build = showcase.build()
    assert len(build.steps) > 1 and build.name == showcase.name
    assert (build.width, build.height, build.depth) == showcase.site
    for step in build.steps:
        assert told(step) and step.code.startswith(f"# {told(step)[:40]}")
        assert not step.code.splitlines()[-1].startswith("#")


def test_gallery_exports_each_showcase_with_its_story(tmp_path, monkeypatch):
    (tmp_path / "hut.py").write_text('# Stone walls.\nstep("Walls")\nfill(0, 0, 0, 3, 2, 3, "stone")\n')
    monkeypatch.setattr(showcases, "SCRIPTS", tmp_path)
    monkeypatch.setattr(gallery, "SHOWCASES", [Showcase(key="hut", name="Hut", intro="A hut.", site=(8, 8, 8))])
    out = gallery.export(tmp_path / "site")
    [summary] = json.loads((out / "builds.json").read_text())
    model = json.loads((out / "builds" / "hut.json").read_text())
    assert summary["id"] == "hut" and summary["revision"] == model["revision"]
    assert [m["text"] for m in model["messages"]][:2] == ["A hut.", "Stone walls."] and model["status"] == "done"
