#!/usr/bin/env bash
# Uploads the files of scripts/cloudflare.mjs for the R2 bucket (DIR,
# default dist-r2) to BUCKET, brotli compressed (Content-Encoding: br) when
# FILE.br exists, cached for good (their directory changes with them):
#   scripts/r2-upload.sh BUCKET [DIR]
# with wrangler (WRANGLER, default npx wrangler; wrangler login first, or
# CLOUDFLARE_API_TOKEN)
set -euo pipefail
cd "$(dirname "$0")/.."
bucket=${1:?usage: scripts/r2-upload.sh BUCKET [DIR]}
dir=${2:-dist-r2}
read -r -a wrangler <<< "${WRANGLER:-npx wrangler}"
find "$dir" -type f ! -name '*.br' | sort | while read -r file; do
  key=${file#"$dir"/}
  case $file in
    *.wasm) type=application/wasm ;;
    *.js) type=text/javascript ;;
    *.json) type=application/json ;;
    *) type=application/octet-stream ;;
  esac
  enc=()
  if [ -f "$file.br" ]; then file=$file.br; enc=(--content-encoding br); fi
  "${wrangler[@]}" r2 object put "$bucket/$key" --remote --file "$file" --content-type "$type" "${enc[@]}" \
    --cache-control "public, max-age=31536000, immutable"
done
echo "uploaded $dir to $bucket"
