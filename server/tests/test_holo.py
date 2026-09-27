import asyncio
import base64
import io
import os
import sys
import time
from types import SimpleNamespace

import PIL.Image
import pytest
from fastapi.testclient import TestClient

from blockyard.builders.holo import HoloBuilder
from blockyard.model import Build, Message
from blockyard.session import FOUR_VIEWS, Session, Store, View
from blockyard.workbench import Workbench

RENDER = b"\x89PNG render"


@pytest.fixture
def bench(tmp_path, monkeypatch):
    session = Session(Build(width=16, depth=16, height=16), Store(tmp_path))
    monkeypatch.setattr(session, "render", lambda **_: asyncio.sleep(0))
    return Workbench(session)


HOUSE = """
step("Walls")
fill(2, 0, 2, 9, 5, 9, "stone_bricks", "walls")
step("Roof")
for k in range(5):
    fill(1, 6 + k, 1 + k, 10, 6 + k, 1 + k, "oak_stairs[facing=south]")
    fill(1, 6 + k, 10 - k, 10, 6 + k, 10 - k, "oak_stairs[facing=north]")
print("roof top", 6 + k)
step("Path")
fill(5, 0, 10, 6, 0, 15, "dirt_path")
"""


def test_a_script_rebuilds_from_its_first_changed_step_and_names_the_lines_of_its_problems(bench):
    first = asyncio.run(bench.run_script(HOUSE))
    assert first.problems == 0 and "roof top 10" in first.text, first.text
    assert [s.title for s in bench.build.steps] == ["Walls", "Roof", "Path"]
    assert bench.world().get(5, 6, 1) == "oak_stairs[facing=south]"
    walls = [b for b in bench.build.boxes if b.step == 0]

    spruce = HOUSE.replace('"oak_', '"spruce_')
    recolored = asyncio.run(bench.run_script(spruce))
    assert "kept step 1, rebuilt 2 steps" in recolored.text
    assert [b for b in bench.build.boxes if b.step == 0] == walls
    assert bench.world().get(5, 6, 1) == "spruce_stairs[facing=south]"

    stray = spruce + 'set(40, 1, 0, "stone")\nset(3, 1, 3, "stone_brik")\n'
    for _ in range(2):
        result = asyncio.run(bench.run_script(stray))
        assert result.problems == 2 and "kept steps 1 to 2, rebuilt 1 steps" in result.text, result.text
        assert 'line 11 `set(40, 1, 0, "stone")`: entirely outside the site' in result.text
        assert (
            "line 12 `set(3, 1, 3, \"stone_brik\")`: unknown block 'stone_brik'; did you mean stone_bricks"
            in result.text
        )

    again = asyncio.run(bench.run_script(stray + 'step("Again")\nfill(2, 0, 2, 9, 5, 9, "stone_bricks", "walls")\n'))
    assert "line 13 `step(\"Again\")`: step 'Again' changed no block" in again.text, again.text

    before = list(bench.build.boxes)
    broken = asyncio.run(bench.run_script(bench.build.script + "undefined()\n"))
    assert "did not change" in broken.text and "line 15 `undefined()`: NameError" in broken.text
    assert bench.build.boxes == before and "undefined()" in bench.build.script


def test_agents_build_through_the_tools_endpoint(tmp_path, monkeypatch, capsys):
    from blockyard import app as app_module
    from blockyard import client

    views = []

    async def render(self, box=None, view=FOUR_VIEWS):
        views.append(view)
        return RENDER

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    monkeypatch.setattr(Session, "render", render)
    monkeypatch.chdir(tmp_path)
    build = Build()
    store.save(build)
    tools = f"/api/builds/{build.id}/tools"
    with TestClient(app_module.app) as http:
        ran = http.post(f"{tools}/run", json={"code": 'step("Core")\nset(4, 0, 4, "stone")'}).json()
        assert ran["problems"] == 0 and "1 Core: 1 block, x 4-4" in ran["text"], ran["text"]
        assert ran["caption"].startswith("The render:") and base64.b64decode(ran["images"][0]["data"]) == RENDER
        shown = [url for m in store.load(build.id).messages for url in m.images]
        assert shown and http.get(shown[-1]).content == RENDER
        close = http.post(f"{tools}/look", json={"box": "0 0 0 8 8 8"}).json()
        assert close["caption"].startswith("Close-up of x 0-8")
        assert http.post(f"{tools}/build", json={}).status_code == 404
        assert http.post(f"{tools}/run", json={"script": "x"}).status_code == 400

        monkeypatch.setattr(client, "call", lambda tool, **args: http.post(f"{tools}/{tool}", json=args).json())
        monkeypatch.setattr(sys, "argv", ["blocks", "look", "--angle", "-90", "--zoom", "2"])
        with pytest.raises(SystemExit) as done:
            client.main()
        assert done.value.code == 0
    out = capsys.readouterr().out
    assert views[-1] == View(270, 30, 2) and views[0] == FOUR_VIEWS
    assert "Saved view.png. The render: one view from 270 degrees around (left), 30 degrees up, zoom 2x." in out
    assert (tmp_path / "view.png").read_bytes() == RENDER and out.rstrip().endswith("@@attach view.png")
    assert store.load(build.id).script.startswith('step("Core")')


def test_attached_images_are_kept_with_the_message_and_old_builds_still_load(tmp_path, monkeypatch):
    from blockyard import app as app_module

    store = Store(tmp_path)
    monkeypatch.setattr(app_module, "store", store)
    echo = SimpleNamespace(name="echo", label="Echo", max_images=2, run=lambda session, request: asyncio.sleep(0))
    monkeypatch.setitem(app_module.BUILDERS, "echo", echo)
    jpeg = io.BytesIO()
    PIL.Image.new("RGB", (1200, 900), "teal").save(jpeg, "JPEG")
    photo = "data:image/jpeg;base64," + base64.b64encode(jpeg.getvalue()).decode()
    with TestClient(app_module.app) as http:
        assert {"name": "echo", "label": "Echo", "showcase": False, "max_images": 2} in http.get("/api/builders").json()
        too_many = http.post("/api/builds", json={"prompt": "this", "builder": "echo", "images": [photo] * 3})
        assert too_many.status_code == 400 and not store.all()
        build = http.post("/api/builds", json={"prompt": "this", "builder": "echo", "images": [photo]}).json()
        asked = http.get(f"/api/builds/{build['id']}").json()["messages"][0]
        assert asked["text"] == "this" and http.get(asked["images"][0]).content == jpeg.getvalue()
        small = http.get(asked["images"][0].replace("/images/", "/images/small/") + ".webp")
        assert small.headers["content-type"] == "image/webp"
        assert PIL.Image.open(io.BytesIO(small.content)).size == (320, 240)
    old = '{"role": "tool", "text": "Ran the script", "image": "/api/images/render.png", "at": 1}'
    assert Message.model_validate_json(old).images == ["/api/images/render.png"]


def test_holo_gets_the_task_on_stdin_and_stop_ends_its_whole_process_group(tmp_path):
    agent = (
        "import os, subprocess, sys, time; "
        "open('task.txt', 'w').write(sys.stdin.read() + os.environ['BLOCKYARD_ATTACHMENTS'] + os.environ['BLOCKYARD_BUILD']); "
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
        "open('pids', 'w').write(f'{os.getpid()} {child.pid}'); "
        "time.sleep(60)"
    )
    store = Store(tmp_path)
    photo, sketch = store.save_image(b"\xff\xd8 photo", ".jpg"), store.save_image(b"\x89PNG sketch")
    messages = [
        Message(role="user", text="a lighthouse", images=[photo]),
        Message(role="user", text="a tower", images=[sketch]),
    ]
    session = Session(Build(prompt="a lighthouse", messages=messages), store)
    workspace = tmp_path / "workspaces" / session.build.id

    async def main() -> list[int]:
        run = asyncio.create_task(HoloBuilder([sys.executable, "-c", agent], "http://test").run(session, "a tower"))
        while not (workspace / "pids").exists():
            await asyncio.sleep(0.05)
        run.cancel()
        with pytest.raises(asyncio.CancelledError):
            await run
        return [int(p) for p in (workspace / "pids").read_text().split()]

    pids = asyncio.run(main())
    task = (workspace / "task.txt").read_text()
    assert task.startswith(
        "# Request\na tower\n\nAttached: `attachment-2.png`, shown below and saved in your workspace."
    )
    assert "user: a lighthouse (attached `attachment-1.jpg`)" in task and "# The build script" in task
    assert task.endswith(f"attachment-2.png{session.build.id}")
    assert (workspace / "attachment-1.jpg").read_bytes() == b"\xff\xd8 photo"
    assert "No steps yet." in task and (workspace / "build.py").exists()
    assert "`showcase/gothic-cathedral.py`" in task and "`showcase/gothic-cathedral.png`" in task
    assert (workspace / "showcase" / "gothic-cathedral.py").read_text().count('\nstep("') == 9
    assert (workspace / "showcase" / "gothic-cathedral.png").exists()
    assert not any(map(alive, pids))


def alive(pid: int) -> bool:
    for _ in range(40):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        time.sleep(0.05)
    return True
