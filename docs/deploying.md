# Deploying

The site is static: `dist/`, from `make dist` once the builds are made
([building.md](building.md)). A host must:

- send `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (cross-origin isolation:
  the page shares memory with Rocq's worker to interrupt it, and the
  compat build cannot receive messages without it). `dist/_headers` says
  so to Netlify and Cloudflare Pages. On hosts without headers (GitHub
  Pages), a service worker (`coi.js`) adds them at the second load;
- serve `FILE.br`, when it exists, for `FILE` with `Content-Encoding: br`
  (or compress itself): the full build's libraries are 816 MB, 290 MB
  compressed, fetched file by file when a document needs them;
- preferably, serve HTTP/2 (the worker fetches 16 files at a time) and let
  the browser keep Rocq's files for good: they are fetched with their
  version (`?v=`), and else revalidated at each visit, a request each.
  `dist/_headers` says so (`Cache-Control: immutable`).

`scripts/serve.mjs` does all but HTTP/2: `make serve` (`PORT=...`).

## Cloudflare Pages

Cloudflare serves no file over 25 MiB: the `lsp_worker.wasm` of each build
is served by an R2 bucket instead (`rocqweb`), the rest of the site by the
Pages project `rocqweb` ([rocq.rboud.com](https://rocq.rboud.com/), its
files over 25 MiB at `rocq-wasm.rboud.com`).

Once:

1. Connect the bucket to a custom domain, that of `ASSETS_URL` below (the
   `r2.dev` URL is rate-limited, for development only), and give it a
   CORS policy allowing the site's origin (Settings > CORS Policy):
   ```json
   [{ "AllowedOrigins": ["https://SITE_DOMAIN"], "AllowedMethods": ["GET", "HEAD"] }]
   ```
2. `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`).

Each deployment, once `out/full/web` and `out/compat/web` are built:

```sh
make deploy
```

which is, step by step (`ASSETS_URL`, default
`https://rocq-wasm.rboud.com`; `BUCKET` and `PROJECT`, default
`rocqweb`):

```sh
make dist          # dist/
make cloudflare    # dist-cloudflare/, dist-r2/
make r2            # dist-r2/ into the bucket
make pages         # dist-cloudflare/ on Pages
```

- `make cloudflare` (`scripts/cloudflare.mjs`) writes the site without
  the big files (and without the `.br`: Cloudflare compresses itself) in
  `dist-cloudflare/`, and the big files in `dist-r2/HASH/`. They must
  match the `lsp_worker.js` of the page: their directory is named after
  their hash, so an upload replaces nothing a deployed page uses, and
  they are cached for good. `dist-cloudflare/rocq/worker.js` has their
  URLs.
- `make r2` can be skipped when the workers did not change (only the app
  did): `dist-r2/` then has the same `HASH` as the last upload. The
  directories of old builds stay in the bucket until deleted.
- `make pages` deploys with `--branch main`, which makes it the
  production deployment whatever the branch checked out, if `main` is the
  project's production branch (Settings > Builds & deployments); another
  name gives a preview deployment.
