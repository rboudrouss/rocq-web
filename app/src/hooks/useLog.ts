// The log panel's lines (the last 200)
import { useCallback, useState } from "react";

export function useLog() {
  const [lines, setLines] = useState<string[]>([]);
  const log = useCallback((m: string) => setLines((l) => [...l.slice(-200), m]), []);
  return { lines, log };
}
