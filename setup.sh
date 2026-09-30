#!/bin/sh
# Install the toolkit where this script is, put `blocks` on the PATH and the showcases in BUILD_DIR: sh setup.sh [BUILD_DIR]
set -eu
build=$(cd "${1:-.}" && pwd)
cd "$(dirname "$0")"
(cd server && uv sync --frozen --no-dev -q)
sudo=$([ -w /usr/local/bin ] || echo sudo)
printf '#!/bin/sh\nexec %s "$@"\n' "$(pwd)/server/.venv/bin/blocks" | $sudo tee /usr/local/bin/blocks >/dev/null
$sudo chmod +x /usr/local/bin/blocks
ln -sfn "$(pwd)/agent/showcase" "$build/showcase"
echo "Blockyard is ready: blocks works on the build in the directory it runs in."
