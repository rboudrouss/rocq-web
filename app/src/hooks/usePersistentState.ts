// A state kept in the browser's local storage, under "rocq-web:KEY"
import { useCallback, useState } from "react";

export function usePersistentState<T>(key: string, initial: T) {
  const k = `rocq-web:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const s = localStorage.getItem(k);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      localStorage.setItem(k, JSON.stringify(v));
    },
    [k],
  );
  return [value, set] as const;
}
