"""The blocks CLI: an agent's hands on the build in its working directory."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from blockyard.workbench import Workbench
from blockyard.workspace import Workspace


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
    elif args.tool == "find":
        out = bench.find_blocks(args.query)
    else:
        out = bench.rename(args.name)
    print(out.text)
    sys.exit(1 if out.problems else 0)


if __name__ == "__main__":
    main()
