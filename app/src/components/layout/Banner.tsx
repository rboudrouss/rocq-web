// A line under the header (a link copied...), closed by its ×
import type { ReactNode } from "react";

export function Banner({ children, close }: { children: ReactNode; close: () => void }) {
  return (
    <div className="shared">
      {children}
      <button onClick={close} aria-label="Close">
        ×
      </button>
    </div>
  );
}
