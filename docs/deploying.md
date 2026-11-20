# Deploying

The site is static. `make dist` writes it to `dist/` once the builds are
made ([building.md](building.md)). Any host works if it does the following.

- **Cross-origin isolation.** Send `Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: require-corp`. The page shares memory
  with Rocq's worker to interrupt it, and the compat build cannot receive
  messages without it. Also send `Cross-Origin-Resource-Policy:
  cross-origin`, without which a cross-origin isolated page cannot embed the
  site. `dist/_headers` sets them on Netlify and Cloudflare Pages. On hosts
  without custom headers (GitHub Pages), a service worker (`coi.js`) adds
  them from the second load on. It does nothing in an iframe, which only the
  page around it can isolate.
- **Brotli.** Serve `FILE.br` with `Content-Encoding: br` when it exists, or
  compress on the fly. The full build's libraries are 816 MB, 290 MB
  compressed, fetched file by file when a document needs them.
- **HTTP/2 and caching** (recommended). The worker fetches 16 files at a
  time, and Rocq's files are fetched with their version (`?v=`), so the
  browser can keep them for good instead of revalidating each one on every
  visit. `dist/_headers` sets `Cache-Control: immutable`.

`make serve` (`scripts/serve.mjs`, `PORT=...`) does all of this except
HTTP/2.

## Cloudflare Pages

```sh
make deploy
```

Cloudflare Pages serves no file over 25 MiB, so the `lsp_worker.wasm` of each
build is served from an R2 bucket (`rocqweb`) and the rest of the site by the
Pages project `rocqweb`. The site is [rocq.rboud.com](https://rocq.rboud.com/)
and the big files are at `rocq-wasm.rboud.com`.

### Setup, once

1. Connect the bucket to a custom domain, the one of `ASSETS_URL` below (the
   `r2.dev` URL is rate-limited and meant for development). Give it a CORS
   policy allowing the site's origin in Settings > CORS Policy.
   ```json
   [{ "AllowedOrigins": ["https://SITE_DOMAIN"], "AllowedMethods": ["GET", "HEAD"] }]
   ```
2. Run `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN`.

### Each deployment

Once `out/full/web` and `out/compat/web` are built, `make deploy` runs these
steps.

```sh
make dist          # dist/
make cloudflare    # dist-cloudflare/ and dist-r2/
make r2            # dist-r2/ into the bucket
make pages         # dist-cloudflare/ on Pages
```

`ASSETS_URL` defaults to `https://rocq-wasm.rboud.com`, `BUCKET` and
`PROJECT` to `rocqweb`.

`make cloudflare` (`scripts/cloudflare.mjs`) writes the site without the big
files to `dist-cloudflare/`, and without the `.br` since Cloudflare
compresses by itself. The big files go to `dist-r2/HASH/`. They must match
the page's `lsp_worker.js`, so their directory is named after their hash. An
upload then never replaces a file a deployed page uses, and the files can be
cached for good. `dist-cloudflare/rocq/worker.js` holds their URLs.

`make r2` can be skipped when only the app changed, as `dist-r2/` then has
the same `HASH` as the last upload. Directories of old builds stay in the
bucket until deleted by hand.

`make pages` deploys with `--branch main`. If `main` is the project's
production branch (Settings > Builds & deployments), this is a production
deployment whatever branch is checked out. Any other branch name gives a
preview deployment.

## Continuous deployment

`.github/workflows/deploy.yml` builds and deploys the site on GitHub's
runners, for each push to `main` and every Monday when the `v9.2` branch of
[rocq-lsp](https://github.com/rocq-community/rocq-lsp) has a new commit.
`scripts/update-coq-lsp.sh` then points the recipe at that commit, and the
workflow pushes the recipe once the site is deployed. Running the workflow
by hand makes a full build.

The opam switch (`.github/opam/`) is installed once and kept in GitHub's
cache, again when `.github/opam/` changes. Its install takes hours, so a run
stopped by the 6 hour limit saves what it installed and the next run goes on
from there. ocaml-emcc's libraries for wasm64 are cached the same way, by
the commits of ocaml-emcc and c_of_ocaml and the recipes. `full` and
`compat` are then built in parallel, and kept 90 days as artifacts.

A push that changes, since the last full build, only the app, the docs, the
tests, the workflow, `LICENSE` or the site's scripts (`dist.mjs`,
`cloudflare.mjs`, `serve.mjs`) runs only `make dist cloudflare pages`, with
that build's artifacts. Any other change rebuilds everything, the plugins
too, since they are linked against the programs.

The workflow needs the repository secrets `CLOUDFLARE_API_TOKEN` (with R2
and Pages edit permissions) and `CLOUDFLARE_ACCOUNT_ID`.
