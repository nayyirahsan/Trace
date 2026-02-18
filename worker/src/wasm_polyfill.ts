// Polyfills required by Go's wasm_exec.js in runtimes that lack them.
// Modern workerd provides both performance and crypto natively; these
// guards matter for older runtimes and for running the code under tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

if (typeof g.performance === 'undefined') {
  const start = Date.now();
  g.performance = {
    now: () => Date.now() - start,
    timeOrigin: start,
  };
}

if (typeof g.crypto === 'undefined') {
  g.crypto = {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
  };
}

export {};
