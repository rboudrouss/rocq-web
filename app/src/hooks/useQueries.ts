// Commands run at the cursor (Search, About...), the document unchanged
import { useCallback, useState } from "react";
import { isRocq } from "../lib/storage";
import { workerUri } from "../lib/workspaces";
import type { QueryResult } from "../components/panels/QueryPanel";
import type { Document } from "./useDocument";
import type { Session } from "./useRocqSession";
import type { Workspace } from "./useWorkspace";

export function useQueries({ session, ws, doc }: { session: Session; ws: Workspace; doc: Document }) {
  const [results, setResults] = useState<QueryResult[]>([]);
  const run = useCallback(
    (command: string) => {
      const c = session.client.current;
      const active = ws.current.current.active;
      if (!c || !session.ready.current || !isRocq(active)) return;
      const add = (r: QueryResult) => setResults((q) => [r, ...q.slice(0, 30)]);
      c.run(workerUri(active), doc.version.current, doc.cursor.current, command).then(
        (r) => add({ command, messages: r.feedback.map(([, m]) => m) }),
        (e: Error) => add({ command, messages: [], error: e.message }),
      );
    },
    [session, ws, doc],
  );
  return { results, run };
}
