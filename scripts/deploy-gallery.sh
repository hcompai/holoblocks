#!/usr/bin/env bash
# Build the read-only gallery and deploy it to Vercel: scripts/deploy-gallery.sh --preview|--prod [BUILD_ID...]
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  --preview) target=() ;;
  --prod) target=(--prod) ;;
  *) echo "usage: $0 --preview|--prod [BUILD_ID...]" >&2; exit 2 ;;
esac
shift

[[ -f web/.vercel/project.json ]] || (cd web && vercel link --yes --scope h-company --project blockyard)
(cd web && npm run build:gallery)
server/.venv/bin/blockyard-gallery web/.vercel/output/static "$@"
echo '{"version": 3}' > web/.vercel/output/config.json
(cd web && vercel deploy --prebuilt ${target[@]+"${target[@]}"})
