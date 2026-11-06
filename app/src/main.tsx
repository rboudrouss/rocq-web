import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { examples, loadExample } from "./examples";
import { embedded, listFiles, readFile, setActiveFile, writeFile } from "./files";
import { openShared } from "./share";
import "./style.css";

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

// a file shared by a link (#share=...) first
Promise.all([
  openExample().catch(() => {}),
  openShared({ list: listFiles, read: readFile, write: writeFile, activate: setActiveFile }),
]).finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
