"""The blocks CLI: an agent's hands on a live build, from a shell in its own workspace."""

from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

import httpx

TIMEOUT_S = 300


def call(tool: str, **args: str) -> dict:
    url = os.environ.get("BLOCKYARD_URL", "http://127.0.0.1:8000")
    build = os.environ.get("BLOCKYARD_BUILD")
    if not build:
        sys.exit("Set BLOCKYARD_BUILD to the id of the build to work on.")
    response = httpx.post(f"{url}/api/builds/{build}/tools/{tool}", json=args, timeout=TIMEOUT_S)
    if response.is_error:
        sys.exit(f"blocks {tool} failed ({response.status_code}): {response.text}")
    return response.json()


def save(images: list[dict], stem: str) -> list[str]:
    """Write each image to `stem`.ext."""
    names = []
    for image in images:
        name = f"{stem}.{image['mime'].split('/')[-1].replace('jpeg', 'jpg')}"
        Path(name).write_bytes(base64.b64decode(image["data"]))
        names.append(name)
    return names


def main() -> None:
    parser = argparse.ArgumentParser(prog="blocks", description=__doc__)
    tools = parser.add_subparsers(dest="tool", required=True)
    tools.add_parser("run", help="rebuild the model from a build script; saves render.png").add_argument(
        "script", nargs="?", default="build.py"
    )
    look = tools.add_parser(
        "look",
        help="render the four views again (render.png), one view from an angle or a camera (view.png), "
        "or a box (closeup.png)",
    )
    look.add_argument("box", nargs="*", type=int, metavar="x0 y0 z0 x1 y1 z1")
    look.add_argument("--angle", help="degrees around the model: 0 front, 90 right, 180 back, 270 left")
    look.add_argument("--pitch", help="degrees above the horizon: 0 eye level, 90 straight down (default 30)")
    look.add_argument("--zoom", help="magnification, 1 to 8 (default 1)")
    look.add_argument(
        "--from",
        dest="eye",
        nargs=3,
        type=float,
        metavar=("X", "Y", "Z"),
        help="a wide camera at this point, turned to the middle of the box or the model, level unless --pitch "
        "tilts it down (negative: up): a visitor's eye",
    )
    look.add_argument("--out", help="file name for the image, instead of render.png, view.png or closeup.png")
    tools.add_parser("find", help="search blocks by words").add_argument("query")
    tools.add_parser("name", help="name the build").add_argument("name")
    args = parser.parse_args()

    stem = args.tool
    if args.tool == "run":
        out, stem = call("run", code=Path(args.script).read_text()), "render"
    elif args.tool == "find":
        out = call("find", query=args.query)
    elif args.tool == "name":
        out = call("name", name=args.name)
    else:
        if args.box and len(args.box) != 6:
            sys.exit("blocks look takes no box, or six numbers: x0 y0 z0 x1 y1 z1")
        view = {k: v for k in ("angle", "pitch", "zoom") if (v := getattr(args, k)) is not None}
        if args.eye:
            view["eye"] = " ".join(f"{v:g}" for v in args.eye)
        out = call("look", box=" ".join(map(str, args.box)), **view)
        stem = (
            str(Path(args.out).with_suffix("")) if args.out else "closeup" if args.box else "view" if view else "render"
        )
    if out["text"]:
        print(out["text"], end="\n\n" if out["images"] else "\n")
    if out["images"]:
        names = save(out["images"], stem)
        print(f"Saved {', '.join(names)}. {out['caption']}".rstrip())
        for name in names:
            print(f"@@attach {name}")
    sys.exit(1 if out["problems"] else 0)


if __name__ == "__main__":
    main()
