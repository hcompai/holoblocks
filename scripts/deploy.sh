#!/usr/bin/env bash
# Build the web app with the toolkit and the showcases, and deploy it to Vercel: scripts/deploy.sh --preview|--prod
# Pushes to main that pass CI deploy to production: the deploy job in .github/workflows/ci.yml runs this with CI set.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  --preview) target=() ;;
  --prod) target=(--prod) ;;
  *) echo "usage: $0 --preview|--prod" >&2; exit 2 ;;
esac
vercel=(--scope h-company)
[[ -n "${VERCEL_TOKEN:-}" ]] && vercel+=(--token "$VERCEL_TOKEN")

server/.venv/bin/python scripts/pack-toolkit.py
server/.venv/bin/blockyard-gallery web/public
# A project token cannot link; CI names the project with VERCEL_ORG_ID and VERCEL_PROJECT_ID instead.
[[ -f web/.vercel/project.json || -n "${VERCEL_PROJECT_ID:-}" ]] || (cd web && vercel link --yes --project blockyard "${vercel[@]}")
# The bundle is public: it must never carry an API key.
(cd web && npm run build && node scripts/thumbnails.mjs)
rm -rf web/.vercel/output && mkdir -p web/.vercel/output
cp -R web/dist web/.vercel/output/static
(cd web && node scripts/build-api.mjs .vercel/output)
(cd web && vercel deploy --prebuilt ${target[@]+"${target[@]}"} "${vercel[@]}")
