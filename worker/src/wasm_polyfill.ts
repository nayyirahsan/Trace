// Polyfills required by Go's wasm_exec.js in the Workers runtime
if (typeof globalThis.performance === 'undefined') {
  const start = Date.now();
  globalThis.performance = {
    now: () => Date.now() - start,
    timeOrigin: start,
  } as Performance;
}

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
  } as Crypto;
}
