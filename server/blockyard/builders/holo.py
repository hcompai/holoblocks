"""Holo as a builder: a streaming tool-calling loop over the workbench, reasoning shown live in the chat."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import uuid
from dataclasses import dataclass, field

import httpx

from blockyard import blocks
from blockyard.session import Session
from blockyard.workbench import Result, Workbench

THINK_FLUSH_S = 0.25
RETRIES = 3

PROMPT = """You are Holo, a Minecraft architect working in Blockyard. You design what the user asks on a {width}x{depth} site \
by writing small JavaScript steps that place blocks, while the user watches each step appear in 3D.

How to work
- For a new build: call set_name, then find_reference with a concrete name of the real thing (like "Bodiam Castle" or \
"Kinkaku-ji"; search again if the photos are off). Then write a short plan: a map of the site as rectangles \
(x, z, w, d) for each building, tower, street, garden or water, the height of each, and the palette.
- Build with the build tool, one manual step per call, big shapes first: walls and floors, then roofs, then details. \
Each step is JavaScript with these functions:
  fill(x0, y0, z0, x1, y1, z1, block, mode) fills the inclusive box; mode is "solid" (default), "hollow" (a shell) or \
"walls" (four sides, no floor or ceiling).
  set(x, y, z, block) places one block. clear(x0, y0, z0, x1, y1, z1) removes blocks. log(text) reports back to you.
  Loops and Math are available; there are no other globals. Later calls overwrite earlier ones, so fill a solid box \
then clear the inside, or fill a wall then set windows into it. A fill also overwrites earlier steps' blocks in its \
box, so lay out ground, water and paths before the buildings, or fill them only where nothing stands (a moat is four \
strips around the walls, not a slab across the site).
- Call look every 3 or 4 steps. Compare the render with the reference photos and your plan: name what is off \
(proportions, missing features, floating parts, flat facades, wrong colors), fix it with clear and new steps or \
undo_step, then continue.
- Before each tool call, say in one short sentence what you are about to do.
- When the model is finished and you have looked at it, reply with a two-sentence summary and no tool call.

Quality bar
- Match the real proportions: tall things are tall. A tower is three to five times taller than it is wide.
- Aim for a rich model that fills the site: the main subject, plus a setting with paths, gardens, water, trees, \
lamps and small props. Vary the ground with dirt paths, gravel, grass and flowers.
- Buildings are hollow with windows on every side, doors, and a real roof: stairs stepping in course by course, \
slabs for the ridge and eaves, an overhang of one block. Never leave a box with a flat lid.
- Facades need depth: pillars or corner blocks in a contrasting material, window sills with slabs, a plinth of a \
darker block, battlements of alternating blocks and slabs, lanterns and torches.
- Use block states for shapes: stairs take [facing=north|south|east|west] (facing points from the low step to the tall half, so \
roof stairs face the ridge: the south eave uses facing=north, the east eave facing=west; half=top for upside down), slabs take [type=bottom|top|double], logs take [axis=x|y|z] for horizontal beams. \
Doors take [facing=...] and fill two blocks by themselves. Trapdoors are thin plates: [half=top] under a ceiling, or \
[open=true,facing=south] for a shutter standing flat against the south face of a wall (facing is the side the plate \
shows). Chains and lightning rods are thin vertical rods. Fences, walls and panes connect on their own.
- Trees: a log trunk 4 to 6 tall, a leaves ball two blocks wider than the trunk, a smaller ball on top.

Coordinates
- x runs 0-{xmax} from west (left) to east (right), z runs 0-{zmax} from north (back) to south (front), y is the \
height: y=0 is the grass ground, so build from y=1 up to y={ymax}.
- The front of the site faces south (high z). A door on a south wall is at that wall's z with facing=south.
- Blocks outside the site are skipped and reported; unknown block names are skipped and reported; fix and resend.

Blocks (add [state] where noted; use find_blocks for colors, woods and more)
{blocks}"""

CODE = {"type": "string", "description": "JavaScript for this step, using fill, set, clear and log"}
TITLE = {"type": "string", "description": "manual step title"}


def _tool(name: str, description: str, /, optional: tuple[str, ...] = (), **properties: dict) -> dict:
    schema = {"type": "object", "properties": properties, "required": [p for p in properties if p not in optional]}
    return {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}


TOOLS = [
    _tool(
        "build",
        "Run one step of JavaScript that places blocks with fill, set and clear. Returns what was placed, anything "
        "skipped and why, and your log lines.",
        title=TITLE,
        code=CODE,
    ),
    _tool("undo_step", "Remove everything a step placed, so earlier steps show through.", index={"type": "integer"}),
    _tool("look", "Render the model: 3/4 front-right, 3/4 back-left, front and top views, as one image."),
    _tool(
        "find_blocks", "Search the block palette by words, e.g. 'red roof' or 'white flower'.", query={"type": "string"}
    ),
    _tool(
        "find_reference",
        "Photos of the real object from Wikipedia, up to 3, with their page titles.",
        query={"type": "string", "description": "a concrete name, like 'Bodiam Castle'"},
    ),
    _tool("set_name", "Name the build.", name={"type": "string"}),
]

FEATURED = [
    "stone_bricks", "mossy_stone_bricks", "cobblestone", "stone_brick_stairs", "stone_brick_slab", "stone_brick_wall",
    "polished_andesite", "deepslate_bricks", "deepslate_tiles", "deepslate_tile_stairs", "bricks", "brick_stairs",
    "sandstone", "smooth_sandstone", "quartz_block", "smooth_quartz", "quartz_pillar", "terracotta", "mud_bricks",
    "oak_planks", "spruce_planks", "dark_oak_planks", "oak_log", "spruce_log", "stripped_oak_log", "oak_stairs",
    "spruce_stairs", "dark_oak_stairs", "oak_slab", "spruce_slab", "oak_fence", "spruce_fence", "oak_door", "spruce_door",
    "oak_trapdoor", "oak_leaves", "spruce_leaves", "birch_leaves", "azalea_leaves", "flowering_azalea_leaves",
    "glass", "glass_pane", "white_stained_glass_pane", "iron_bars", "lantern", "torch", "white_wool", "red_wool",
    "white_concrete", "red_concrete", "gray_concrete", "white_terracotta", "red_terracotta", "copper_block",
    "oxidized_copper", "cut_copper_stairs", "gold_block", "grass_block", "dirt", "dirt_path", "coarse_dirt", "gravel",
    "sand", "moss_block", "water", "snow_block", "hay_block", "short_grass", "fern", "poppy", "dandelion",
    "cornflower", "oxeye_daisy", "white_carpet", "red_carpet", "cobblestone_wall", "chiseled_stone_bricks",
    "sea_lantern", "glowstone", "bookshelf", "cobweb", "ladder",
]  # fmt: skip


def system_prompt(width: int = 64, depth: int = 64, height: int = 64) -> str:
    names = ", ".join(blocks.describe(b) for b in FEATURED if b in blocks.palette())
    return PROMPT.format(blocks=names, width=width, depth=depth, xmax=width - 1, zmax=depth - 1, ymax=height - 1)


@dataclass
class Reply:
    content: str = ""
    finish: str | None = None
    calls: dict[int, dict] = field(default_factory=dict)

    def message(self) -> dict:
        """The assistant turn for the history; arguments that are not JSON become {} so the API accepts the history."""
        message: dict = {"role": "assistant", "content": self.content}
        if self.calls:
            message["tool_calls"] = [
                {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": _json_or_empty(c)}}
                for c in self.calls.values()
            ]
        return message


def _json_or_empty(call: dict) -> str:
    try:
        json.loads(call["arguments"] or "{}")
    except json.JSONDecodeError:
        return "{}"
    return call["arguments"] or "{}"


class HoloBuilder:
    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str,
        max_turns: int = 80,
        max_tokens: int = 12000,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.name = "holo"
        self.label = "Holo"
        self.model = model
        self.url = f"{base_url.rstrip('/')}/chat/completions"
        self.api_key = api_key
        self.max_turns = max_turns
        self.max_tokens = max_tokens
        self.transport = transport

    @classmethod
    def from_env(cls) -> HoloBuilder | None:
        key = os.environ.get("HOLO_API_KEY") or os.environ.get("HAI_API_KEY")
        if not key:
            return None
        model = os.environ.get("HOLO_MODEL", "holo4-27b")
        base_url = os.environ.get("HOLO_BASE_URL", f"https://api.hcompany.ai/v1/models/{model}")
        return cls(model, base_url, key)

    async def run(self, session: Session, request: str) -> None:
        bench = Workbench(session)
        await bench.ensure_ground()
        build = session.build
        messages = [
            {"role": "system", "content": system_prompt(build.width, build.depth, build.height)},
            *self._history(session, request, await asyncio.to_thread(bench.describe)),
        ]
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=30), transport=self.transport) as client:
            for _ in range(self.max_turns):
                reply = await self._complete(client, session, messages)
                if reply.finish == "length":
                    reply.calls = {}
                messages.append(reply.message())
                if reply.content:
                    await session.say(reply.content)
                if not reply.calls:
                    if reply.finish == "length":
                        messages.append(
                            {"role": "user", "content": "You ran out of tokens. Take one smaller step now."}
                        )
                        continue
                    return
                for call in reply.calls.values():
                    result = await self._call(bench, call)
                    messages.append({"role": "tool", "tool_call_id": call["id"], "content": result.text})
                    if result.note:
                        await session.say(result.note, role="tool")
                    if result.images:
                        self._show(messages, result)
        await session.say(f"Stopped after {self.max_turns} turns.", role="system")

    @staticmethod
    def _history(session: Session, request: str, state: str) -> list[dict]:
        earlier = [
            {"role": m.role, "content": m.text} for m in session.build.messages[:-1] if m.role in ("user", "assistant")
        ]
        return [*earlier, {"role": "user", "content": f"{request}\n\nCurrent model:\n{state}"}]

    @staticmethod
    def _show(messages: list[dict], result: Result) -> None:
        """Attach images for the model to see; older images of the same kind leave the context."""
        for m in messages:
            if result.kind and m.get("kind") == result.kind:
                m["content"] = f"(Older {result.kind} images were here.)"
                del m["kind"]
        images = [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}}
            for data, mime in result.images
        ]
        messages.append(
            {"role": "user", "content": [{"type": "text", "text": result.caption}, *images], "kind": result.kind}
        )

    @staticmethod
    async def _call(bench: Workbench, call: dict) -> Result:
        try:
            args = json.loads(call["arguments"] or "{}")
        except json.JSONDecodeError as e:
            return Result(f"Arguments are not valid JSON ({e}). Resend the call.")
        tools = {
            "build": lambda: bench.run(str(args.get("title", "Step")), str(args.get("code", ""))),
            "undo_step": lambda: bench.undo(int(args.get("index", -1))),
            "look": bench.look,
            "find_blocks": lambda: bench.find_blocks(str(args.get("query", ""))),
            "find_reference": lambda: bench.find_reference(str(args.get("query", ""))),
            "set_name": lambda: bench.rename(str(args.get("name", ""))),
        }
        if call["name"] not in tools:
            return Result(f"Unknown tool {call['name']}. Available: {', '.join(tools)}.")
        return await tools[call["name"]]()

    async def _complete(self, client: httpx.AsyncClient, session: Session, messages: list[dict]) -> Reply:
        body = {
            "model": self.model,
            "messages": [{k: v for k, v in m.items() if k != "kind"} for m in messages],
            "tools": TOOLS,
            "stream": True,
            "max_tokens": self.max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        for attempt in range(RETRIES):
            session.think("", reset=True)
            try:
                async with client.stream("POST", self.url, json=body, headers=headers) as response:
                    if response.status_code >= 500 and attempt < RETRIES - 1:
                        await asyncio.sleep(2**attempt)
                        continue
                    if response.status_code != 200:
                        size = len(json.dumps(body["messages"]))
                        raise RuntimeError(
                            f"Holo API {response.status_code}: {(await response.aread()).decode()[:300]} "
                            f"({len(messages)} messages, {size} characters)"
                        )
                    return await self._read(response, session)
            except (httpx.TransportError, httpx.RemoteProtocolError):
                if attempt == RETRIES - 1:
                    raise
                await asyncio.sleep(2**attempt)
        raise RuntimeError("Holo API kept failing")

    @staticmethod
    async def _read(response: httpx.Response, session: Session) -> Reply:
        reply = Reply()
        thinking, flushed = "", time.monotonic()
        async for line in response.aiter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                thinking += delta.get("reasoning") or delta.get("reasoning_content") or ""
                reply.content += delta.get("content") or ""
                for t in delta.get("tool_calls") or []:
                    call = reply.calls.setdefault(
                        t["index"], {"id": t.get("id") or uuid.uuid4().hex[:12], "name": "", "arguments": ""}
                    )
                    call["name"] += t.get("function", {}).get("name") or ""
                    call["arguments"] += t.get("function", {}).get("arguments") or ""
                reply.finish = choice.get("finish_reason") or reply.finish
            if thinking and time.monotonic() - flushed > THINK_FLUSH_S:
                session.think(thinking)
                thinking, flushed = "", time.monotonic()
        if thinking:
            session.think(thinking)
        reply.content = reply.content.strip()
        return reply
