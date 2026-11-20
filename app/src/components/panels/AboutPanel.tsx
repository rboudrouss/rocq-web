// About: what rocq-web is, its repository, the version deployed (commits of
// the site, of the programs and of coq-lsp, written by vite.config.ts) and
// a summary of its patches of coq-lsp
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { Package } from "./PackagesPanel";

const BUILD = __ROCQ_WEB_BUILD__;
const REPOSITORY = "https://github.com/rboudrouss/rocq-web";

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Commit({ repository, commit }: { repository: string; commit: string }) {
  return (
    <Link href={`${repository}/commit/${commit}`}>
      <code>{commit.slice(0, 8)}</code>
    </Link>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en", { dateStyle: "medium" });

export function AboutPanel({ packages, build }: { packages: Package[] | null; build: string }) {
  const rocq = packages?.find((p) => p.name === "rocq-core")?.version;
  return (
    <div className="about">
      <p>
        rocq-web runs the <Link href="https://rocq-prover.org">Rocq prover</Link> and its language server coq-lsp in
        the browser, compiled to WebAssembly. There is no server, the files stay in this browser.
      </p>
      <p>
        <Link href={REPOSITORY}>
          <ExternalLink size={13} /> Source code and documentation
        </Link>
      </p>

      <h3>This version</h3>
      <dl>
        <dt>Site</dt>
        <dd>
          {BUILD.commit ? <Commit repository={REPOSITORY} commit={BUILD.commit} /> : "a local build"}
          {BUILD.date && <> ({day(BUILD.date)})</>}
        </dd>
        {BUILD.built && BUILD.built !== BUILD.commit && (
          <>
            <dt>Rocq and coq-lsp</dt>
            <dd>
              built at <Commit repository={REPOSITORY} commit={BUILD.built} />
            </dd>
          </>
        )}
        <dt>Rocq</dt>
        <dd>
          {rocq ?? "…"}, {build} build
        </dd>
        {BUILD.coqLsp && (
          <>
            <dt>coq-lsp</dt>
            <dd>
              <Commit repository={BUILD.coqLsp.repository} commit={BUILD.coqLsp.commit} /> of its v9.2 branch
            </dd>
          </>
        )}
      </dl>

      <h3>What rocq-web changes</h3>
      <p>
        Rocq and its packages are unmodified. coq-lsp gets {BUILD.patches.length} small patches. Only its libraries are
        built, for rocq-web&apos;s own server in a Web Worker. The others make any command interruptible and fix how
        files compiled in the browser are saved and required.
      </p>

      <h3>Built with</h3>
      <p>
        <Link href="https://github.com/rboudrouss/ocaml-emcc">ocaml-emcc</Link>, which compiles OCaml programs to C with{" "}
        <Link href="https://github.com/rboudrouss/C_of_ocaml">c_of_ocaml</Link>, then to WebAssembly with{" "}
        <Link href="https://emscripten.org">emscripten</Link>. Rocq&apos;s plugins become WebAssembly modules loaded by{" "}
        <code>Declare ML Module</code>.
      </p>
    </div>
  );
}
