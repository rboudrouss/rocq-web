# Deploying

The site is static: `dist/`, from `node scripts/dist.mjs` once the builds
are made ([building.md](building.md)). A host must:

- send `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (cross-origin isolation:
  the page shares memory with Rocq's worker to interrupt it, and the
  compat build cannot receive messages without it). `dist/_headers` says
  so to Netlify and Cloudflare Pages. On hosts without headers (GitHub
  Pages), a service worker (`coi.js`) adds them at the second load;
- serve `FILE.br`, when it exists, for `FILE` with `Content-Encoding: br`
  (or compress itself): the full build's libraries are 816 MB, 290 MB
  compressed, fetched file by file when a document needs them.

`scripts/serve.mjs` does both, with caching: `node scripts/serve.mjs dist
PORT`.

## Cloudflare Pages

Cloudflare serves no file over 25 MiB: the `lsp_worker.wasm` of each build
is served by an R2 bucket instead (`rocqweb`), the rest of the site by the
Pages project `rocqweb` ([rocq.rboud.com](https://rocq.rboud.com/), its
files over 25 MiB at `rocq-wasm.rboud.com`).

Once:

1. Connect the bucket to a custom domain, ASSETS_DOMAIN below (the
   `r2.dev` URL is rate-limited, for development only), and give it a
   CORS policy allowing the site's origin (Settings > CORS Policy):
   ```json
   [{ "AllowedOrigins": ["https://SITE_DOMAIN"], "AllowedMethods": ["GET", "HEAD"] }]
   ```
2. `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`).

Each deployment, once `out/full/web` and `out/compat/web` are built:

```sh
node scripts/dist.mjs                                 # dist/
node scripts/cloudflare.mjs https://ASSETS_DOMAIN     # dist-cloudflare/, dist-r2/
scripts/r2-upload.sh rocqweb                          # dist-r2/ into the bucket
npx wrangler pages deploy dist-cloudflare --project-name rocqweb --branch main
```

- `scripts/cloudflare.mjs` writes the site without the big files (and
  without the `.br`: Cloudflare compresses itself) in `dist-cloudflare/`,
  and the big files in `dist-r2/HASH/`. They must match the
  `lsp_worker.js` of the page: their directory is named after their hash,
  so an upload replaces nothing a deployed page uses, and they are cached
  for good. `dist-cloudflare/rocq/worker.js` has their URLs.
- `scripts/r2-upload.sh` can be skipped when the workers did not change
  (only the app did): `dist-r2/` then has the same `HASH` as the last
  upload. The directories of old builds stay in the bucket until deleted.
- `--branch main` makes it the production deployment whatever the branch
  checked out, if `main` is the project's production branch (Settings >
  Builds & deployments); another name gives a preview deployment.
