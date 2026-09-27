"""HTTP API: builds, chat, a live event stream per build, the block palette and the .schem download."""

from __future__ import annotations

import asyncio
import base64
import binascii
import inspect
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from blockyard import blocks
from blockyard.builders import BUILDERS
from blockyard.builders.scripted import ScriptedBuilder
from blockyard.model import Build
from blockyard.renderer import Renderer
from blockyard.session import Builder, Session, Store, UnknownBuild
from blockyard.workbench import Workbench

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
PORT = int(os.environ.get("BLOCKYARD_PORT", "8000"))
HEARTBEAT_S = 15

MAX_ATTACHMENT_BYTES = 10_000_000
ATTACHMENT_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


class NewBuild(BaseModel):
    prompt: str
    builder: str = next(iter(BUILDERS))
    images: list[str] = []
    """Attached images as base64 data URLs."""


class Say(BaseModel):
    text: str
    images: list[str] = []
    """Attached images as base64 data URLs."""


class AgentSay(BaseModel):
    text: str
    role: Literal["assistant", "thinking"] = "assistant"


store = Store()
sessions: dict[str, Session] = {}
renderer = Renderer(f"http://127.0.0.1:{PORT}") if WEB_DIST.exists() else None
TOOLS = {
    "run": Workbench.run_script,
    "look": Workbench.look,
    "find": Workbench.find_blocks,
    "name": Workbench.rename,
}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Builds left building by a server that died are done; on shutdown, every running build stops with the server."""
    for build in store.all():
        if build.status == "building":
            build.status = "done"
            store.save(build)
    yield
    running = [s.task for s in sessions.values() if s.task and not s.task.done()]
    for task in running:
        task.cancel()
    await asyncio.gather(*running, return_exceptions=True)
    if renderer is not None:
        await renderer.stop()


app = FastAPI(title="Blockyard", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)


@app.exception_handler(UnknownBuild)
def unknown_build(_: Request, e: UnknownBuild) -> Response:
    return JSONResponse({"detail": f"no build {e}"}, status_code=404)


def session_for(build_id: str) -> Session:
    if build_id not in sessions:
        build = store.load(build_id)
        if build is None:
            raise HTTPException(404, f"no build {build_id}")
        sessions[build_id] = Session(build, store, renderer)
    return sessions[build_id]


def builder_of(build: Build) -> Builder:
    """The build's builder, or the first one when its own is gone."""
    return BUILDERS.get(build.builder) or next(iter(BUILDERS.values()))


def decode_attachments(urls: list[str], builder: Builder) -> list[tuple[bytes, str]]:
    """Each attached image's bytes and file suffix, from its data URL."""
    if len(urls) > builder.max_images:
        raise HTTPException(400, f"{builder.label} takes at most {builder.max_images} images per message")
    images = []
    for url in urls:
        head, _, data = url.partition(",")
        mime = head.removeprefix("data:").removesuffix(";base64")
        if not head.endswith(";base64") or mime not in ATTACHMENT_TYPES:
            raise HTTPException(400, f"images are base64 data URLs of {', '.join(ATTACHMENT_TYPES)}")
        try:
            image = base64.b64decode(data, validate=True)
        except binascii.Error as e:
            raise HTTPException(400, f"bad base64 image: {e}") from e
        if len(image) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(413, f"images are at most {MAX_ATTACHMENT_BYTES // 1_000_000} MB")
        images.append((image, ATTACHMENT_TYPES[mime]))
    return images


async def start(session: Session, request: str, attachments: list[tuple[bytes, str]]) -> None:
    """Post the user's request with its images to the chat and run the builder on it."""
    if session.task and not session.task.done():
        raise HTTPException(409, "this build is still running")
    images = [store.save_image(image, suffix) for image, suffix in attachments]
    await session.say(request, role="user", images=images)
    builder = builder_of(session.build)
    session.build.builder = builder.name

    async def run() -> None:
        await session.set_status("building")
        try:
            await builder.run(session, request)
            await session.set_status("done")
        except asyncio.CancelledError:
            await session.say("Stopped.", role="system")
            await session.set_status("done")
        except Exception as e:  # noqa: BLE001
            await session.say(f"Builder failed: {e}", role="system")
            await session.set_status("error")
        finally:
            if renderer is not None:
                await renderer.release(session.build.id)

    session.task = asyncio.create_task(run())


@app.get("/api/builders")
def builders() -> list[dict]:
    return [
        {"name": b.name, "label": b.label, "showcase": isinstance(b, ScriptedBuilder), "max_images": b.max_images}
        for b in BUILDERS.values()
    ]


@app.get("/api/blocks")
def palette() -> dict:
    return blocks.palette()


@app.get("/api/builds")
def list_builds() -> list[dict]:
    return [s | {"thumbnail": store.thumbnail_version(s["id"])} for s in store.summaries()]


@app.post("/api/builds")
async def create_build(body: NewBuild) -> dict:
    if body.builder not in BUILDERS:
        raise HTTPException(400, f"unknown builder {body.builder}; available: {list(BUILDERS)}")
    attachments = decode_attachments(body.images, BUILDERS[body.builder])
    build = Build(prompt=body.prompt, builder=body.builder, name=body.prompt[:48] or "Untitled build")
    store.save(build)
    await start(session_for(build.id), body.prompt, attachments)
    return build.summary()


@app.get("/api/builds/{build_id}")
def get_build(build_id: str) -> Build:
    return session_for(build_id).build


@app.post("/api/builds/{build_id}/messages")
async def post_message(build_id: str, body: Say) -> dict:
    session = session_for(build_id)
    await start(session, body.text, decode_attachments(body.images, builder_of(session.build)))
    return session.build.summary()


@app.post("/api/builds/{build_id}/stop")
def stop(build_id: str) -> dict:
    session = session_for(build_id)
    if session.task and not session.task.done():
        session.task.cancel()
    return {"ok": True}


@app.put("/api/builds/{build_id}/renders/{request}")
async def put_render(build_id: str, request: str, body: Request) -> dict:
    return {"accepted": session_for(build_id).deliver_render(request, await body.body())}


@app.get("/api/builds/{build_id}/events")
async def events(build_id: str) -> StreamingResponse:
    session = session_for(build_id)
    queue = session.subscribe()

    async def stream():
        try:
            yield f"data: {json.dumps({'type': 'hello', 'build': session.build.summary()})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), HEARTBEAT_S)
                    yield f"data: {json.dumps(event)}\n\n"
                except TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            session.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.post("/api/builds/{build_id}/tools/{tool}")
async def call_tool(build_id: str, tool: str, args: dict[str, str]) -> dict:
    """Run a workbench tool for an agent working outside the server, like Holo through the blocks CLI."""
    if tool not in TOOLS:
        raise HTTPException(404, f"unknown tool {tool}; available: {list(TOOLS)}")
    try:
        inspect.signature(TOOLS[tool]).bind(None, **args)
    except TypeError as e:
        raise HTTPException(400, f"{tool}: {e}") from e
    session = session_for(build_id)
    async with session.lock:
        result = await TOOLS[tool](Workbench(session), **args)
    return {
        "text": result.text,
        "problems": result.problems,
        "caption": result.caption,
        "images": [{"mime": p.mime, "data": base64.b64encode(p.data).decode()} for p in result.images],
    }


@app.post("/api/builds/{build_id}/say")
async def agent_say(build_id: str, body: AgentSay) -> dict:
    """Show a message or the live reasoning of an agent working outside the server."""
    session = session_for(build_id)
    if body.role == "thinking":
        session.think(body.text, reset=True)
    else:
        await session.say(body.text)
    return {"ok": True}


@app.put("/api/builds/{build_id}/thumbnail.png")
async def put_thumbnail(build_id: str, request: Request) -> dict:
    session_for(build_id)
    try:
        path = store.thumbnail(build_id)
    except UnknownBuild:
        raise HTTPException(404, "unknown build") from None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(await request.body())
    return {"ok": True}


@app.get("/api/builds/{build_id}/thumbnail.png")
def get_thumbnail(build_id: str, v: int | None = None) -> FileResponse:
    """Cached for good when `v`, the version from the build list, names the file."""
    try:
        path = store.thumbnail(build_id)
    except UnknownBuild:
        raise HTTPException(404, "unknown build") from None
    if not path.exists():
        raise HTTPException(404, "no thumbnail yet")
    cache = "public, max-age=31536000, immutable" if v is not None else "no-cache"
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": cache})


@app.get("/api/builds/{build_id}/download.schem")
async def download(build_id: str) -> Response:
    session = session_for(build_id)
    data = await asyncio.to_thread(lambda: Workbench(session).world().schematic())
    return Response(
        data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{session.build.name}.schem"'},
    )


@app.get("/api/images/{name}")
def image(name: str) -> FileResponse:
    path = store.images / name
    if "/" in name or not path.is_file():
        raise HTTPException(404, "no such image")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/images/small/{name}.webp")
def small_image(name: str) -> FileResponse:
    if "/" in name or not (store.images / name).is_file():
        raise HTTPException(404, "no such image")
    try:
        path = store.small_image(name)
    except OSError as e:
        raise HTTPException(415, f"cannot read {name}: {e}") from e
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")


def main() -> None:
    import uvicorn

    with suppress(KeyboardInterrupt):
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=PORT,
            timeout_graceful_shutdown=3,
        )
