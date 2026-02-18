import './wasm_polyfill';
import { parseAndBuild as tsParseAndBuild } from './parser';
import type { WasmResult } from './types';

let wasmReady = false;
let wasmInitAttempted = false;

async function tryInitWasm(): Promise<boolean> {
  if (wasmReady) return true;
  if (wasmInitAttempted) return false;
  wasmInitAttempted = true;

  try {
    // @ts-expect-error wasm_exec.js is copied from Go toolchain
    await import('./wasm_exec.js');
    const wasmModule = await import('./main.wasm');

    const go = new globalThis.Go();
    // instantiate() on an already-compiled Module returns the Instance
    // directly (not { instance }) — Workers only hand us compiled Modules.
    const instance = await WebAssembly.instantiate(wasmModule.default, go.importObject);
    // go.run blocks until the Go program exits; main() blocks forever on a
    // channel, so run it without awaiting and give it a tick to register.
    void go.run(instance);
    await Promise.resolve();

    wasmReady = typeof globalThis.traceParseAndBuild === 'function';
    return wasmReady;
  } catch (e) {
    console.warn('WASM init failed, using TS fallback parser:', e);
    return false;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var Go: new () => {
    importObject: WebAssembly.Imports;
    run: (instance: WebAssembly.Instance) => Promise<void>;
  };
  function traceParseAndBuild(logs: string, correlationId: string): string;
}

export async function runWasm(logs: string, correlationId: string): Promise<WasmResult> {
  const wasmOk = await tryInitWasm();

  if (wasmOk && typeof globalThis.traceParseAndBuild === 'function') {
    try {
      const result = globalThis.traceParseAndBuild(logs, correlationId);
      const parsed = JSON.parse(result) as WasmResult;
      // Input errors (e.g. unparseable logs) are real results, not reasons
      // to retry on the TS engine — only engine crashes fall through.
      parsed.engine = 'wasm';
      return parsed;
    } catch {
      // fall through to TS parser
    }
  }

  const { timeline, schema, stats, error } = tsParseAndBuild(logs, correlationId);
  return { timeline, schema, stats, error, engine: 'ts' };
}
