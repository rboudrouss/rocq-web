// Which build of the worker this browser runs: "full" (wasm64 + JSPI,
// plugins fetched on demand) or "compat" (wasm32 + CPS stack).

// A module with one 64-bit memory: magic, version, memory section
// (1 memory, flags 0x04 = i64 index, min 0).
const MEMORY64 = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 0]);

export function hasMemory64() {
  try { return WebAssembly.validate(MEMORY64); } catch { return false; }
}

export function hasJSPI() {
  return typeof WebAssembly.Suspending === "function"
    && typeof WebAssembly.promising === "function";
}

export function pickBuild() {
  return hasMemory64() && hasJSPI() ? "full" : "compat";
}
