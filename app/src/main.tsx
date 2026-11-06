import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { listFiles, readFile, setActiveFile, writeFile } from "./files";
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

// a file shared by a link (#share=...) first
openShared({ list: listFiles, read: readFile, write: writeFile, activate: setActiveFile }).finally(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
