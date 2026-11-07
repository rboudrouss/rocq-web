// Tabs over panels: the right column's (problems, query, log)
import { type ReactNode, useState } from "react";

// [name, content, label (default: the name)]
export function Tabs({ tabs, initial }: { tabs: [string, ReactNode, ReactNode?][]; initial?: string }) {
  const [current, setCurrent] = useState(initial ?? tabs[0][0]);
  return (
    <div className="tabs">
      <nav>
        {tabs.map(([name, , label]) => (
          <button key={name} className={name === current ? "on" : ""} onClick={() => setCurrent(name)}>
            {label ?? name}
          </button>
        ))}
      </nav>
      {tabs.map(([name, content]) => (
        <div key={name} className="tab" hidden={name !== current}>
          {content}
        </div>
      ))}
    </div>
  );
}
