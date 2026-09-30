#!/usr/bin/env bash
# Build the web app with the toolkit and the showcases, and deploy it to Vercel: scripts/deploy.sh --preview|--prod
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  --preview) target=() ;;
  --prod) target=(--prod) ;;
  *) echo "usage: $0 --preview|--prod" >&2; exit 2 ;;
esac

server/.venv/bin/python scripts/pack-toolkit.py
server/.venv/bin/blockyard-gallery web/public
[[ -f web/.vercel/project.json ]] || (cd web && vercel link --yes --scope h-company --project blockyard)
# The bundle is public: it must never carry an API key.
(cd web && VITE_HAI_API_KEY= npm run build && node scripts/thumbnails.mjs)
rm -rf web/.vercel/output && mkdir -p web/.vercel/output
cp -R web/dist web/.vercel/output/static
echo '{"version": 3}' > web/.vercel/output/config.json
(cd web && vercel deploy --prebuilt --scope h-company ${target[@]+"${target[@]}"})
