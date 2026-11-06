import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
