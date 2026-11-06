// A JSON-RPC client of coq-lsp's server, running in a Web Worker
// (public/rocq/worker.js): messages are JSON strings.

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type Diagnostic = { range: Range; severity: number; message: string };

export type Hyp = { names: string[]; def?: string | null; ty: string };
export type Goal = { hyps: Hyp[]; ty: string };
export type GoalsResult = {
  goals?: { goals: Goal[]; stack: [Goal[], Goal[]][]; shelf: Goal[]; given_up: Goal[] };
  messages: (string | { level: number; text: string })[];
  error?: string;
};

export type CompletionItem = {
  label: string;
  insertText?: string;
  labelDetails?: { detail?: string };
  textEdit?: { range: Range; newText: string };
};
export type Hover = { contents: { kind: string; value: string } | string; range?: Range };
export type Location = { uri: string; range: Range };
export type DocumentSymbol = {
  name: string;
  detail?: string;
  kind: number;
  range: Range;
  selectionRange?: Range;
  children?: DocumentSymbol[];
};
// petanque/run_at_point: the messages of a command run at a point
export type RunResult = { feedback: [number, string][] };

type Handlers = {
  diagnostics?: (uri: string, version: number, diagnostics: Diagnostic[]) => void;
  status?: (status: string) => void;
  progress?: (uri: string, processing: Range[]) => void;
  log?: (message: string) => void;
  // a file of the libraries downloaded by the worker (web/rocq-web-fs.js)
  fetch?: (path: string, size: number) => void;
};

export class LspClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { ok: (r: unknown) => void; fail: (e: Error) => void }>();
  private handlers: Handlers;

  constructor(workerUrl: string, handlers: Handlers) {
    this.handlers = handlers;
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (e) => {
      if (typeof e.data === "string") this.receive(JSON.parse(e.data));
      else if (e.data?.rocqWebFetch) handlers.fetch?.(e.data.rocqWebFetch, e.data.size);
    };
    this.worker.onerror = (e) => handlers.log?.(`worker error: ${e.message}`);
    if (this.interruptFlag) this.worker.postMessage({ interrupt: this.interruptFlag });
  }

  private receive(msg: { id?: number; method?: string; params?: any; result?: unknown; error?: { message: string } }) {
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p?.fail(new Error(msg.error.message));
      else p?.ok(msg.result);
      return;
    }
    const h = this.handlers;
    switch (msg.method) {
      case "textDocument/publishDiagnostics":
        h.diagnostics?.(msg.params.uri, msg.params.version, msg.params.diagnostics);
        break;
      case "$/coq/serverStatus":
        h.status?.(msg.params.status);
        break;
      case "$/coq/fileProgress":
        h.progress?.(msg.params.textDocument.uri, msg.params.processing.map((p: { range: Range }) => p.range));
        break;
      case "window/logMessage":
        h.log?.(msg.params.message);
        break;
    }
  }

  // The flag Rocq reads to stop the command it checks, in memory shared
  // with the worker (only in a cross-origin isolated page)
  private interruptFlag = typeof SharedArrayBuffer === "function" && crossOriginIsolated
    ? new Int32Array(new SharedArrayBuffer(4))
    : null;

  get canInterrupt() {
    return this.interruptFlag !== null;
  }

  interrupt() {
    if (this.interruptFlag) Atomics.store(this.interruptFlag, 0, 1);
  }

  private send(msg: object) {
    this.worker.postMessage(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  }

  request<T>(method: string, params?: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((ok, fail) => {
      this.pending.set(id, { ok: ok as (r: unknown) => void, fail });
      this.send(params === undefined ? { id, method } : { id, method, params });
    });
  }

  notify(method: string, params: object) {
    this.send({ method, params });
  }

  async initialize() {
    await this.request("initialize", {
      processId: null,
      rootUri: "file:///workspace",
      capabilities: {},
      initializationOptions: { check_only_on_request: false, pp_type: 0 },
    });
    this.notify("initialized", {});
  }

  open(uri: string, text: string, version: number) {
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId: "rocq", version, text } });
  }

  change(uri: string, text: string, version: number) {
    this.interrupt();
    this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  close(uri: string) {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  // Writes the .vo of a document once it is checked (an error if it fails)
  saveVo(uri: string, version: number) {
    return this.request<null>("coq/saveVo", { textDocument: { uri, version } });
  }

  // Rechecks the documents with the .vo files written since
  workspaceUpdate() {
    this.notify("coq/workspace_update", {});
  }

  symbols(uri: string) {
    return this.request<DocumentSymbol[] | null>("textDocument/documentSymbol", { textDocument: { uri } });
  }

  definition(uri: string, position: Position) {
    return this.request<Location | Location[] | null>("textDocument/definition", { textDocument: { uri }, position });
  }

  // A command (Search, About...) run after the sentence at a point, without
  // changing the document
  run(uri: string, version: number, position: Position, command: string) {
    return this.request<RunResult>("petanque/run_at_point", { textDocument: { uri, version }, position, command });
  }

  goals(uri: string, version: number, position: Position) {
    return this.request<GoalsResult>("proof/goals", { textDocument: { uri, version }, position });
  }

  hover(uri: string, position: Position) {
    return this.request<Hover | null>("textDocument/hover", { textDocument: { uri }, position });
  }

  completion(uri: string, position: Position) {
    return this.request<CompletionItem[] | { items: CompletionItem[] } | null>("textDocument/completion", {
      textDocument: { uri },
      position,
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
