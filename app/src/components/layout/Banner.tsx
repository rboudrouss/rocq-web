// A line under the header (a link copied, a warning), closed by its × (if
// it can be)
import type { ReactNode } from "react";

export function Banner({ children, close, kind }: { children: ReactNode; close?: () => void; kind?: "warning" }) {
  return (
    <div className={kind ? `shared ${kind}` : "shared"}>
      {children}
      {close && (
        <button onClick={close} aria-label="Close">
          ×
        </button>
      )}
    </div>
  );
}
