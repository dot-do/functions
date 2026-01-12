#!/bin/bash
set -e

echo "Building thin C# stub for WASI..."

# Clean previous builds
rm -rf bin obj

# Restore and publish with WASI target
dotnet publish -c Release \
    -r wasi-wasm \
    --self-contained true \
    -p:PublishTrimmed=true \
    -p:TrimMode=full \
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
if [ -f "./out/ThinStub.wasm" ]; then
    WASM_SIZE=$(stat -f%z ./out/ThinStub.wasm 2>/dev/null || stat -c%s ./out/ThinStub.wasm)
    echo "WASM file size: $WASM_SIZE bytes ($(echo "scale=2; $WASM_SIZE/1024" | bc) KB)"
fi

echo ""
echo "Done! The stub is ready at ./out/"
