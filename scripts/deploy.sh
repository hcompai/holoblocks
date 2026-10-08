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
vercel=()
[[ -n "${VERCEL_TOKEN:-}" ]] && vercel=(--token "$VERCEL_TOKEN")

# A project token cannot link; CI names the project with VERCEL_ORG_ID and VERCEL_PROJECT_ID instead.
if [[ ! -f web/.vercel/project.json && -z "${VERCEL_PROJECT_ID:-}" ]]; then
  unlinked="set VERCEL_SCOPE and VERCEL_PROJECT, or link web/ with vercel link"
  : "${VERCEL_SCOPE:?$unlinked}" "${VERCEL_PROJECT:?$unlinked}"
  (cd web && vercel link --yes --scope "$VERCEL_SCOPE" --project "$VERCEL_PROJECT" ${vercel[@]+"${vercel[@]}"})
fi

server/.venv/bin/python scripts/pack-toolkit.py
server/.venv/bin/blockyard-gallery web/public
# The bundle is public: it must never carry an API key.
(cd web && npm run build && node scripts/thumbnails.mjs)
rm -rf web/.vercel/output && mkdir -p web/.vercel/output
cp -R web/dist web/.vercel/output/static
(cd web && node scripts/build-api.mjs .vercel/output)
(cd web && vercel deploy --prebuilt ${target[@]+"${target[@]}"} ${vercel[@]+"${vercel[@]}"})
