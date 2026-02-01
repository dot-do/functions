# Workers Static Assets

This directory contains static assets served by Cloudflare Workers Static Assets.

## Directory Structure

```
assets/
  wasm/                     # WASM binary storage
    {functionId}/           # Function-specific directory (created during deployment)
      latest.wasm           # Latest version of the WASM binary
      {version}.wasm        # Versioned WASM binaries (e.g., 1.0.0.wasm)
```

## Benefits

- **Free**: Included in Cloudflare Workers pricing
- **Edge-cached**: Globally distributed, low-latency access
- **25MB limit**: Per-file limit sufficient for WASM binaries
- **Direct Upload API**: CI/CD integration for automated deployments

## Usage

### Loading WASM from Code

```typescript
import { AssetStorage } from './core/asset-storage'

// In your worker handler
const assets = new AssetStorage(env.ASSETS)

// Load latest version
const wasm = await assets.getWasm('my-rust-function')

// Load specific version
const wasmV1 = await assets.getWasm('my-rust-function', '1.0.0')

// Check if WASM exists
const exists = await assets.hasWasm('my-rust-function')

// Get public URL for WASM
const url = assets.getWasmUrl('my-rust-function', '1.0.0')
```

### Uploading WASM (CI/CD)

```typescript
import { AssetUploader } from './core/asset-storage'

const uploader = new AssetUploader(
  process.env.CLOUDFLARE_ACCOUNT_ID,
  process.env.CLOUDFLARE_API_TOKEN,
  'functions-do'
)

// Upload single WASM
const result = await uploader.uploadWasm('my-function', '1.0.0', wasmBinary)

// Upload batch
const results = await uploader.uploadBatch([
  { functionId: 'func-a', version: '1.0.0', wasm: wasmA },
  { functionId: 'func-b', version: '1.0.0', wasm: wasmB },
])
```

## Configuration

The static assets binding is configured in `wrangler.jsonc`:

```jsonc
{
  "assets": {
    "directory": "./assets",
    "binding": "ASSETS"
  }
}
```
