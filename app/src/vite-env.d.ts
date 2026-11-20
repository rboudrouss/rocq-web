/// <reference types="vite/client" />

/** The build, for the About panel (vite.config.ts) */
declare const __ROCQ_WEB_BUILD__: {
  commit: string | null;
  date: string | null;
  built: string | null;
  coqLsp: { repository: string; commit: string } | null;
  patches: string[];
};
