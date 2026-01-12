#!/bin/bash
# Functions.do Rust WASM Build Script
#
# This script compiles your Rust function to WebAssembly using wasm-pack,
# optimized for the Functions.do serverless platform.
#
# Usage:
#   ./build.sh [profile]
#
# Profiles:
#   dev     - Fast compilation, debug symbols, larger output
#   release - Optimized for size (10-50KB target), production ready
#
# Output:
#   pkg/           - wasm-pack output with JS bindings
#   target/wasm32-unknown-unknown/release/*.wasm - Raw WASM module

set -euo pipefail

PROFILE="${1:-release}"
WASM_TARGET="wasm32-unknown-unknown"

echo "=== Functions.do Rust WASM Build ==="
echo "Profile: $PROFILE"
echo ""

# Check for required tools
check_tool() {
    if ! command -v "$1" &> /dev/null; then
        echo "Error: $1 is not installed"
        echo "Install with: $2"
        exit 1
    fi
}

check_tool "rustc" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
check_tool "wasm-pack" "cargo install wasm-pack"

# Ensure the wasm32 target is installed
if ! rustup target list --installed | grep -q "$WASM_TARGET"; then
    echo "Installing $WASM_TARGET target..."
    rustup target add "$WASM_TARGET"
fi

# Build with wasm-pack
echo "Building with wasm-pack..."
if [ "$PROFILE" = "dev" ]; then
    wasm-pack build --target web --dev
else
    wasm-pack build --target web --release
fi

# Get output size
WASM_FILE=$(find pkg -name "*.wasm" -type f | head -1)
if [ -n "$WASM_FILE" ]; then
    SIZE=$(wc -c < "$WASM_FILE" | tr -d ' ')
    SIZE_KB=$((SIZE / 1024))

    echo ""
    echo "=== Build Complete ==="
    echo "Output: $WASM_FILE"
    echo "Size: ${SIZE_KB}KB ($SIZE bytes)"

    # Check if within target size
    if [ "$PROFILE" = "release" ]; then
        if [ "$SIZE_KB" -gt 50 ]; then
            echo ""
            echo "Warning: Output size (${SIZE_KB}KB) exceeds 50KB target"
            echo "Consider:"
            echo "  - Removing unused dependencies"
            echo "  - Using #[cfg(not(target_arch = \"wasm32\"))] for dev-only code"
            echo "  - Running wasm-opt for additional optimization"
        elif [ "$SIZE_KB" -lt 10 ]; then
            echo "Excellent: Output is under 10KB!"
        else
            echo "Good: Output is within 10-50KB target range"
        fi
    fi
fi

# Optional: Run wasm-opt for additional size reduction
if command -v wasm-opt &> /dev/null && [ "$PROFILE" = "release" ]; then
    echo ""
    echo "Running wasm-opt for additional optimization..."
    OPTIMIZED_FILE="${WASM_FILE%.wasm}.opt.wasm"
    wasm-opt -Oz "$WASM_FILE" -o "$OPTIMIZED_FILE"

    OPT_SIZE=$(wc -c < "$OPTIMIZED_FILE" | tr -d ' ')
    OPT_SIZE_KB=$((OPT_SIZE / 1024))
    SAVINGS=$((SIZE - OPT_SIZE))

    echo "Optimized: $OPTIMIZED_FILE"
    echo "Size: ${OPT_SIZE_KB}KB ($OPT_SIZE bytes)"
    echo "Saved: $SAVINGS bytes"

    # Replace original with optimized
    mv "$OPTIMIZED_FILE" "$WASM_FILE"
fi

echo ""
echo "=== Generated Files ==="
ls -la pkg/

echo ""
echo "To use in Functions.do, deploy with:"
echo "  func deploy pkg/"
