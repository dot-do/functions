#!/bin/bash
set -e

echo "Building shared runtime for WASI..."

# Clean previous builds
rm -rf bin obj

# Restore and publish with WASI target
dotnet publish -c Release \
    -r wasi-wasm \
    --self-contained true \
    -o ./out

# Check the output size
echo ""
echo "Build complete. Output files:"
ls -lh ./out/*.wasm 2>/dev/null || ls -lh ./out/

# Calculate total size
TOTAL_SIZE=$(du -sh ./out | cut -f1)
echo ""
echo "Total output size: $TOTAL_SIZE"

# If we have a .wasm file, show its size specifically
if [ -f "./out/Runtime.wasm" ]; then
    WASM_SIZE=$(stat -f%z ./out/Runtime.wasm 2>/dev/null || stat -c%s ./out/Runtime.wasm)
    echo "WASM file size: $WASM_SIZE bytes ($(echo "scale=2; $WASM_SIZE/1024/1024" | bc) MB)"
fi

echo ""
echo "Done! The runtime is ready at ./out/"
