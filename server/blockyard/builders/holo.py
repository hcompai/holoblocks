"""Holo as a builder: a sagent agent that edits build.py in its own workspace and runs it with the blocks CLI."""

from __future__ import annotations

import asyncio
import os
import shutil
import signal
import sys
import time
from pathlib import Path

import yaml

from blockyard.builders.showcases import SHOWCASES
from blockyard.model import Build
from blockyard.session import Session

AGENT = Path(__file__).resolve().parents[3] / "agent" / "holo.py"
RENDERS = AGENT.parent / "showcase"
STOP_S = 10


class HoloBuilder:
    """Runs the agent command once per request, with the request on stdin and the build in BLOCKYARD_* variables."""

    name = "holo"
    label = "Holo"
    max_images: int = yaml.safe_load(AGENT.with_name("holo.yaml").read_text())["max_images"]["message"]

    def __init__(self, command: list[str], url: str):
        self.command = command
        self.url = url

    @classmethod
    def from_env(cls) -> HoloBuilder | None:
        """Holo needs a hai checkout with its venv, in HAI_ROOT, for sagent."""
        python = Path(os.environ.get("HAI_ROOT", "/nonexistent")) / ".venv" / "bin" / "python"
        if not python.exists():
            return None
        return cls([str(python), str(AGENT)], f"http://127.0.0.1:{os.environ.get('BLOCKYARD_PORT', '8000')}")

    async def run(self, session: Session, request: str) -> None:
        build = session.build
        workspace = session.store.root.parent / "workspaces" / build.id
        runs = workspace / "runs"
        runs.mkdir(parents=True, exist_ok=True)
        (workspace / "build.py").write_text(build.script)
        await asyncio.to_thread(_shelve, workspace / "showcase")
        names = await asyncio.to_thread(_attach, session, workspace)
        run = runs / time.strftime("%Y%m%d-%H%M%S")
        env = os.environ | {
            "BLOCKYARD_URL": self.url,
            "BLOCKYARD_BUILD": build.id,
            "BLOCKYARD_WORKSPACE": str(workspace),
            "BLOCKYARD_TRAJECTORY": f"{run}.jsonl",
            "BLOCKYARD_BIN": str(Path(sys.executable).parent),
            "BLOCKYARD_ATTACHMENTS": os.pathsep.join(names[url] for url in build.messages[-1].images),
        }
        log = await asyncio.to_thread(open, f"{run}.log", "wb")
        with log:
            process = await asyncio.create_subprocess_exec(
                *self.command,
                stdin=asyncio.subprocess.PIPE,
                stdout=log,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
                cwd=workspace,
                start_new_session=True,
            )
            try:
                await process.communicate(request.encode())
            finally:
                if process.returncode is None:
                    await _stop(process)
        if process.returncode:
            raise RuntimeError(f"Holo exited with code {process.returncode}; its log is {run}.log")


def attachment_names(build: Build) -> dict[str, str]:
    """Each image the user attached, by URL, and its file in the workspace: attachment-1.jpg, attachment-2.png..."""
    urls = [url for m in build.messages if m.role == "user" for url in m.images]
    return {url: f"attachment-{n}{Path(url).suffix}" for n, url in enumerate(urls, 1)}


def _attach(session: Session, workspace: Path) -> dict[str, str]:
    """Copy the images the user attached into the workspace; returns their names there."""
    names = attachment_names(session.build)
    for url, name in names.items():
        if not (workspace / name).exists():
            shutil.copy(session.store.images / Path(url).name, workspace / name)
    return names


def _shelve(shelf: Path) -> None:
    """Copy the showcases into the workspace: each one's build script and its renders."""
    shelf.mkdir(exist_ok=True)
    for showcase in SHOWCASES:
        shutil.copy(showcase.path, shelf / showcase.path.name)
    for render in RENDERS.glob("*.png"):
        shutil.copy(render, shelf / render.name)


async def _stop(process: asyncio.subprocess.Process) -> None:
    """Ask the agent's process group to stop, then kill it."""
    os.killpg(process.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), STOP_S)
    except TimeoutError:
        os.killpg(process.pid, signal.SIGKILL)
        await process.wait()
