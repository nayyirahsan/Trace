#!/bin/bash
set -euo pipefail

# Compile Go to WASM for Cloudflare Workers
GOOS=js GOARCH=wasm go build -o ../worker/src/main.wasm .

# Copy the Go WASM runtime shim
# Go 1.24+ moved wasm_exec.js to lib/wasm/
GOROOT="$(go env GOROOT)"
if [ -f "$GOROOT/lib/wasm/wasm_exec.js" ]; then
  cp "$GOROOT/lib/wasm/wasm_exec.js" ../worker/src/wasm_exec.js
elif [ -f "$GOROOT/misc/wasm/wasm_exec.js" ]; then
  cp "$GOROOT/misc/wasm/wasm_exec.js" ../worker/src/wasm_exec.js
else
  echo "error: wasm_exec.js not found in GOROOT" >&2
  exit 1
fi

echo "Built main.wasm ($(du -sh ../worker/src/main.wasm | cut -f1))"
