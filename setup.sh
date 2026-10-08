#!/bin/sh
# Install the toolkit where this script is, put `blocks` on the PATH and the showcases in BUILD_DIR: sh setup.sh [BUILD_DIR]
# BLOCKYARD_MINUTES, the session's time limit, starts the clock that `blocks run` reports.
set -eu
build=$(cd "${1:-.}" && pwd)
cd "$(dirname "$0")"
lock=$(pwd)/.setup.lock
# A lock whose setup was killed outright is free again; one still writing its pid is taken.
dead() { [ -f "$lock/pid" ] && ! kill -0 "$(cat "$lock/pid")" 2>/dev/null; }
if ! mkdir "$lock" 2>/dev/null; then
  echo "Another setup is running; waiting for it to finish."
  until mkdir "$lock" 2>/dev/null; do
    if dead; then rm -rf "$lock"; else sleep 2; fi
  done
fi
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
trap 'exit 1' INT TERM
if [ -n "${BLOCKYARD_MINUTES:-}" ] && [ ! -f "$build/.blockyard-clock" ]; then
  printf '{"started": %s, "minutes": %s}\n' "$(date +%s)" "$BLOCKYARD_MINUTES" > "$build/.blockyard-clock"
fi
(cd server && uv sync --frozen --no-dev -q)
sudo=$([ -w /usr/local/bin ] || echo sudo)
printf '#!/bin/sh\nexec %s "$@"\n' "$(pwd)/server/.venv/bin/blocks" | $sudo tee /usr/local/bin/blocks >/dev/null
$sudo chmod +x /usr/local/bin/blocks
ln -sfn "$(pwd)/agent/showcase" "$build/showcase"
echo "HoloBlocks is ready: blocks works on the build in the directory it runs in."
