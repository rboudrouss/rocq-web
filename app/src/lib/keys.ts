// The keys of the navigation, RocqIDE's: Alt and an arrow, Home or End
// (Ctrl+Cmd on macOS, whose Alt and arrows move by words)
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// CodeMirror's name of the key [k] (ArrowDown...) with the modifier
export const navKey = (k: string) => (isMac ? `Ctrl-Meta-${k}` : `Alt-${k}`);

const symbols: Record<string, string> = { ArrowDown: "↓", ArrowUp: "↑", ArrowRight: "→" };
// Its name for people (Alt+↓)
export const navLabel = (k: string) => (isMac ? "⌃⌘" : "Alt+") + (symbols[k] ?? k);
