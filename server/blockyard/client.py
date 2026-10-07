"""The blocks CLI: an agent's hands on the build in its working directory."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from blockyard.workbench import Workbench
from blockyard.workspace import Workspace, write

CLOCK = ".blockyard-clock"
"""Written by setup: when it started and the session's time limit in minutes."""
FINISH_AT = 0.8
CHECK_FROM = 0.5


def tick(folder: Path) -> str:
    """Count this run on the session clock and say how much time is used, if setup started one."""
    path = folder / CLOCK
    if not path.exists():
        return ""
    clock = json.loads(path.read_text())
    clock["runs"] = clock.get("runs", 0) + 1
    write(path, json.dumps(clock))
    used, limit = round((time.time() - clock["started"]) / 60), clock["minutes"]
    if used >= FINISH_AT * limit:
        note = ": start nothing new; finish the change in hand and answer"
    elif used < CHECK_FROM * limit:
        note = f": keep improving the weakest part; the finish check opens at {round(CHECK_FROM * limit)}"
    else:
        note = ""
    return f"Run {clock['runs']} · {used} of {limit} min used{note}\n"


def main() -> None:
    parser = argparse.ArgumentParser(prog="blocks", description=__doc__)
    tools = parser.add_subparsers(dest="tool", required=True)
    tools.add_parser("run", help="rebuild the model from a build script and write model.json.gz").add_argument(
        "script", nargs="?", default="build.py"
    )
    tools.add_parser("find", help="search blocks by words").add_argument("query")
    tools.add_parser("name", help="name the build").add_argument("name")
    args = parser.parse_args()

    bench = Workbench(Workspace.open(Path.cwd()))
    if args.tool == "run":
        out = bench.run_script(Path(args.script).read_text())
        out.text = tick(Path.cwd()) + out.text
    elif args.tool == "find":
        out = bench.find_blocks(args.query)
    else:
        out = bench.rename(args.name)
    print(out.text)
    sys.exit(1 if out.problems else 0)


if __name__ == "__main__":
    main()
