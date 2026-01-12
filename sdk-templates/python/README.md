# Functions.do Python Template

A serverless Python function template for [Functions.do](https://functions.do) running on Cloudflare Workers.

## Overview

This template provides a starting point for building Python serverless functions that run on Cloudflare Workers via Pyodide (Python compiled to WebAssembly).

## Project Structure

```
.
├── pyproject.toml          # Project configuration and dependencies
├── requirements.txt        # pip-compatible dependencies
├── README.md              # This file
├── src/
│   ├── __init__.py        # Package initialization
│   └── handler.py         # Main handler with capnweb RPC integration
└── tests/                 # Test files (optional)
    └── test_handler.py
```

## Getting Started

### Prerequisites

- Python 3.10 or later
- pip or uv for package management

### Local Development

1. **Install dependencies:**

   ```bash
   # Using pip
   pip install -e ".[dev]"

   # Using uv (faster)
   uv pip install -e ".[dev]"
   ```

2. **Run locally:**

   ```bash
   python -m src.handler
   ```

3. **Run tests:**

   ```bash
   pytest
   ```

### Deployment

Deploy to Functions.do using the CLI:

```bash
functions deploy
```

Or using Wrangler:

```bash
wrangler deploy
```

## Handler Structure

The main handler in `src/handler.py` supports three trigger types:

### HTTP Requests (fetch)

```python
class Handler(RpcTarget):
    async def fetch(self, request: Request, ctx: ExecutionContext) -> Response:
        # Handle HTTP requests
        return Response.json({"message": "Hello!"})
```

### RPC Calls (capnweb)

```python
class Handler(RpcTarget):
    def greet(self, name: str) -> str:
        """RPC method callable from JavaScript"""
        return f"Hello, {name}!"

    async def process_data(self, data: dict) -> dict:
        """Async RPC method"""
        result = await some_async_operation(data)
        return result
```

### Scheduled Triggers (cron)

```python
class Handler(RpcTarget):
    async def scheduled(self, event: dict, ctx: ExecutionContext) -> None:
        # Handle cron triggers
        print(f"Running scheduled task at {event['scheduledTime']}")
```

## Capnweb RPC Integration

This template includes capnweb-style RPC support for type-safe communication with JavaScript and other Workers.

### Calling Python from JavaScript

```javascript
// From a JavaScript Worker
const result = await pythonWorker.greet('World');
// Returns: "Hello, World!"
```

### RPC Request Format

```json
{
  "type": "rpc",
  "call": {
    "method": "greet",
    "args": ["World"],
    "kwargs": {},
    "callId": "unique-id"
  }
}
```

### RPC Response Format

```json
{
  "callId": "unique-id",
  "value": "Hello, World!"
}
```

## Environment Variables

Access environment variables and bindings through the `Env` class:

```python
async def fetch(self, request: Request, ctx: ExecutionContext) -> Response:
    # Access KV namespace
    kv = self.env.get("MY_KV")

    # Access environment variable
    api_key = self.env.get("API_KEY")

    return Response.json({"status": "ok"})
```

## Configuration

### pyproject.toml Settings

```toml
[tool.functions-do]
runtime = "python"
handler = "src.handler:handler"

[tool.functions-do.snapshot]
enabled = true
preload_modules = ["json", "datetime", "re"]

[tool.functions-do.bindings]
kv_namespaces = ["MY_KV"]
d1_databases = ["MY_DB"]
```

### Memory Snapshots

Enable memory snapshots for faster cold starts by preloading modules:

```toml
[tool.functions-do.snapshot]
enabled = true
preload_modules = [
    "json",
    "datetime",
    "re",
    "collections",
]
```

## Pyodide Compatibility

This template is designed for Pyodide compatibility. Some limitations apply:

### Supported Features
- Pure Python packages from PyPI
- Standard library (json, datetime, re, collections, etc.)
- Async/await
- Most numpy/pandas operations

### Not Supported
- Native C extensions (unless pre-compiled for Pyodide)
- File system operations (use KV, R2, or D1)
- Subprocess/threading (use service bindings)
- Raw socket connections (use fetch API)

### Compatible Packages

See the [Pyodide packages list](https://pyodide.org/en/stable/usage/packages-in-pyodide.html) for supported packages.

## Type Safety

The template includes full type annotations for IDE support:

```python
from src.handler import Request, Response, RpcTarget

class MyHandler(RpcTarget):
    def process(self, data: dict[str, Any]) -> dict[str, Any]:
        # Full type checking and autocompletion
        return {"processed": True}
```

Generate type stubs for JavaScript interop:

```bash
functions generate-types --output types.d.ts
```

## Testing

```python
# tests/test_handler.py
import pytest
from src.handler import handler, Request, Response

@pytest.mark.asyncio
async def test_fetch():
    result = await handler({
        "type": "fetch",
        "request": {
            "method": "GET",
            "url": "https://example.com/",
            "headers": {},
        },
    })

    assert result["status"] == 200
    assert "message" in result["body"]

@pytest.mark.asyncio
async def test_rpc_ping():
    result = await handler({
        "type": "rpc",
        "call": {
            "method": "ping",
            "args": [],
        },
    })

    assert result["value"] == "pong"
```

## License

MIT
