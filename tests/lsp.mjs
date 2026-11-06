// Drives the LSP worker under node (stdio), as an editor would:
//   node tests/lsp.mjs WORKER.js FILE.v LINE:CHAR...
// opens FILE.v, prints its diagnostics once checked, then the goals at each
// LINE:CHAR (0-based), and exits.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [worker, file, ...positions] = process.argv.slice(2);
const uri = pathToFileURL(resolve(file)).href;
const child = spawn(process.execPath, [worker], { stdio: ["pipe", "pipe", "inherit"] });

let buffer = Buffer.alloc(0);
const handlers = new Map();
const listeners = [];
let nextId = 1;

const trace = process.env.LSP_TRACE;
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const len = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + len) return;
    const msg = JSON.parse(buffer.subarray(end + 4, end + 4 + len).toString("utf8"));
    buffer = buffer.subarray(end + 4 + len);
    if (trace) console.error(`<- ${msg.method ?? "response " + msg.id} ${JSON.stringify(msg.params ?? msg.result ?? null).slice(0, 150)}`);
    if (msg.id !== undefined && handlers.has(msg.id)) {
      handlers.get(msg.id)(msg);
      handlers.delete(msg.id);
    } else listeners.forEach((l) => l(msg));
  }
});

function send(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8");
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}
function request(method, params) {
  const id = nextId++;
  return new Promise((ok) => {
    handlers.set(id, ok);
    send(params === null ? { id, method } : { id, method, params });
  });
}
function notification(method) {
  return new Promise((ok) => {
    const l = (msg) => {
      if (msg.method === method) {
        listeners.splice(listeners.indexOf(l), 1);
        ok(msg.params);
      }
    };
    listeners.push(l);
  });
}

const t0 = Date.now();
const init = await request("initialize", {
  processId: process.pid,
  rootUri: pathToFileURL(resolve(".")).href,
  capabilities: {},
  initializationOptions: { check_only_on_request: false },
});
console.log(`initialize: ${init.result ? "ok" : JSON.stringify(init.error)} (${Date.now() - t0} ms)`);
send({ method: "initialized", params: {} });

const checked = new Promise((ok) => {
  listeners.push((msg) => {
    if (msg.method === "$/coq/serverStatus" && msg.params.status === "Idle") ok();
  });
});
const diagnostics = [];
listeners.push((msg) => {
  if (msg.method === "textDocument/publishDiagnostics") diagnostics.splice(0, diagnostics.length, ...msg.params.diagnostics);
});
const t1 = Date.now();
send({
  method: "textDocument/didOpen",
  params: { textDocument: { uri, languageId: "rocq", version: 1, text: readFileSync(file, "utf8") } },
});
await Promise.race([checked, new Promise((ok) => setTimeout(ok, 120000))]);
await new Promise((ok) => setTimeout(ok, 100));
console.log(`checked in ${Date.now() - t1} ms, ${diagnostics.length} diagnostics`);
for (const d of diagnostics)
  console.log(`  ${d.range.start.line}:${d.range.start.character} [${d.severity}] ${String(d.message).split("\n")[0]}`);

for (const p of positions) {
  const [line, character] = p.split(":").map(Number);
  const r = await request("proof/goals", { textDocument: { uri, version: 1 }, position: { line, character } });
  const goals = r.result?.goals?.goals ?? [];
  console.log(`goals at ${p}: ${goals.length}`);
  for (const g of goals) console.log(`  ${g.hyps.map((h) => h.names.join(",") + " : " + h.ty).join("; ")} |- ${g.ty}`);
}

await request("shutdown", null);
send({ method: "exit" });
setTimeout(() => child.kill(), 2000).unref();
