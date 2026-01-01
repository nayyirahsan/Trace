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
    const result = await WebAssembly.instantiate(wasmModule.default, go.importObject);
    go.run(result.instance);

    wasmReady = typeof globalThis.traceParseAndBuild === 'function';
    return wasmReady;
  } catch {
    return false;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var Go: new () => {
    importObject: WebAssembly.Imports;
    run: (instance: WebAssembly.Instance) => void;
  };
  function traceParseAndBuild(logs: string, correlationId: string): string;
}

export async function runWasm(logs: string, correlationId: string): Promise<WasmResult> {
  const wasmOk = await tryInitWasm();

  if (wasmOk && typeof globalThis.traceParseAndBuild === 'function') {
    try {
      const result = globalThis.traceParseAndBuild(logs, correlationId);
      const parsed = JSON.parse(result) as WasmResult;
      if (!parsed.error) return parsed;
    } catch {
      // fall through to TS parser
    }
  }

  const { timeline, schema, error } = tsParseAndBuild(logs, correlationId);
  return { timeline, schema, error };
}
