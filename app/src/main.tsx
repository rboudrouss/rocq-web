import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { examples, loadExample } from "./lib/examples";
import { openShared } from "./lib/share";
import { pickBuild } from "./lib/detect";
import { embedded, listFiles, readFile, setActiveFile, writeFile } from "./lib/storage";
import { setLibraries } from "./lib/workspaces";
import "./styles.css";

// Not cross-origin isolated (a host without COOP and COEP headers): the
// service worker public/coi.js adds them, from the next load of the page
if (import.meta.env.PROD && !crossOriginIsolated && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi.js`);
  navigator.serviceWorker.ready.then(() => {
    if (!navigator.serviceWorker.controller && !sessionStorage.getItem("rocq-web:coi")) {
      sessionStorage.setItem("rocq-web:coi", "1");
      location.reload();
    }
  });
}

// iOS zooms in on a field focused whose text is smaller than 16px (the
// editor's, on a phone): not with maximum-scale, which on iOS does not stop
// the zoom of the fingers
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
  const meta = document.querySelector('meta[name="viewport"]');
  meta?.setAttribute("content", `${meta.getAttribute("content")}, maximum-scale=1`);
}

// An example of a link (?example=ID, its file ?file=NAME active)
async function openExample() {
  const params = new URLSearchParams(location.search);
  const id = params.get("example");
  if (!id) return;
  const e = (await examples()).find((e) => e.id === id);
  if (!e) return;
  const paths = await loadExample(e);
  const file = params.get("file");
  setActiveFile(paths.find((p) => p.endsWith(`/${file}`)) ?? paths[0]);
  if (!embedded) {
    params.delete("example");
    params.delete("file");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
}

// The names of the libraries, which the workspaces' must not hide
async function libraries() {
  const r = await fetch(`${import.meta.env.BASE_URL}rocq/${pickBuild()}/packages.json`);
  const packages: { modules: string[] }[] = await r.json();
  setLibraries(packages.flatMap((p) => p.modules.map((m) => m.split(".")[0])));
}

// a file shared by a link (#share=...) first
Promise.all([
  libraries().catch(() => {}),
  openExample().catch(() => {}),
  openShared({ list: listFiles, read: readFile, write: writeFile, activate: setActiveFile }),
]).finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
