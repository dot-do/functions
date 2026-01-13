# Python Guide

Python functions on Functions.do run via Pyodide, a Python runtime compiled to WebAssembly. This enables Python code, including popular data science libraries, to run in the browser and edge environments.

## What is Pyodide?

Pyodide is a port of CPython to WebAssembly/WASI. It allows running Python code in web browsers and serverless environments by compiling the Python interpreter itself to WASM.

Key features:
- Full CPython 3.11+ runtime in WASM
- Support for NumPy, Pandas, and many pure Python packages
- Async/await support
- Direct JavaScript interop

## Quick Start

Create a Python function for Functions.do:

```bash
# Create project directory
mkdir my-python-function
cd my-python-function

# Create virtual environment (for local testing)
python3 -m venv venv
source venv/bin/activate

# Install local dependencies
pip install functions-do-sdk pytest
```

## Installation

### Prerequisites

1. **Python 3.10+**: Required for type hints and async features
2. **Pyodide-compatible packages**: Not all packages work in WASM
3. **Node.js**: For wrangler deployment

```bash
# Check Python version (3.10 or higher required)
python3 --version

# Install the Functions.do SDK
pip install functions-do-sdk
```

### Pyodide-Compatible Packages

Pyodide supports many packages, but with limitations:

**Fully Supported:**
- Pure Python packages
- NumPy, Pandas, SciPy
- Matplotlib (limited)
- scikit-learn
- Most data processing libraries

**Limited or Not Supported:**
- Packages with C extensions (unless pre-built for Pyodide)
- Network-dependent packages
- OS-specific packages
- Packages requiring file system access

Check package compatibility at [Pyodide packages](https://pyodide.org/en/stable/usage/packages-in-pyodide.html).

## Project Configuration

### pyproject.toml

Configure your Python project:

```toml
[project]
name = "my-function"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "functions-do-sdk>=0.1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-asyncio>=0.21",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

### wrangler.toml

Configure wrangler for Python deployment:

```toml
name = "my-python-function"
main = "src/worker.py"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
PYTHON_VERSION = "3.11"

# Enable Python support
[build]
command = "pip install -r requirements.txt -t ./vendor"
```

### requirements.txt

List your Python dependencies:

```text
functions-do-sdk>=0.1.0
```

## Code Examples

### Hello World Handler

A basic Python function:

```python
# Simple hello world handler
from typing import Optional

def handler(request: dict) -> dict:
    """Handle incoming request and return greeting."""
    name: str = request.get("name", "World")
    return {
        "message": f"Hello, {name}!",
        "status": "success"
    }
```

### Async Request Handler

Handle HTTP requests with async/await:

```python
import json
from typing import Optional, Dict, Any

# Async HTTP request handler with type hints
async def handler(request: Request) -> Response:
    """Process incoming HTTP request asynchronously."""
    # Get request method
    method: str = request.method

    if method == "GET":
        return Response(
            json.dumps({"message": "Hello, World!"}),
            headers={"Content-Type": "application/json"}
        )

    elif method == "POST":
        # Parse JSON body
        body: Dict[str, Any] = await request.json()
        name: str = body.get("name", "Anonymous")
        age: int = body.get("age", 0)

        response_data = {
            "greeting": f"Hello, {name}!",
            "is_adult": age >= 18,
            "received": body
        }

        return Response(
            json.dumps(response_data),
            headers={"Content-Type": "application/json"}
        )

    return Response("Method not allowed", status=405)
```

### SDK Integration

Integrate with the Functions.do SDK:

```python
from functions_do_sdk import FunctionsClient, Config
from typing import Dict, Any, Optional
import json

# Initialize SDK client with configuration
config = Config(
    api_key="your-api-key",
    endpoint="https://api.functions.do",
    timeout=30000
)

client = FunctionsClient(config)

async def handler(request: Request) -> Response:
    """Handler with SDK integration for logging and function invocation."""
    # Log request received
    await client.log({
        "level": "info",
        "message": "Request received",
        "path": request.url
    })

    # Parse request
    data: Dict[str, Any] = await request.json()

    # Invoke another function via SDK
    result: Optional[Dict] = await client.invoke(
        "helper-function",
        {"input": data}
    )

    # Log completion
    await client.log({
        "level": "info",
        "message": "Request processed"
    })

    return Response(
        json.dumps({"result": result}),
        headers={"Content-Type": "application/json"}
    )
```

### Data Processing Example

Process data with Python libraries:

```python
from typing import List, Dict, Any
import json

# Data processing handler with Python
async def process_data(request: Request) -> Response:
    """Process numerical data from request."""
    body: Dict[str, Any] = await request.json()
    numbers: List[float] = body.get("numbers", [])

    if not numbers:
        return Response(
            json.dumps({"error": "No numbers provided"}),
            status=400,
            headers={"Content-Type": "application/json"}
        )

    # Calculate statistics
    result = {
        "count": len(numbers),
        "sum": sum(numbers),
        "mean": sum(numbers) / len(numbers),
        "min": min(numbers),
        "max": max(numbers)
    }

    return Response(
        json.dumps(result),
        headers={"Content-Type": "application/json"}
    )
```

## Request/Response Classes

Python handlers use Request and Response classes:

```python
from typing import Dict, Optional, Any

class Request:
    """HTTP Request object available in handlers."""
    method: str
    url: str
    headers: Dict[str, str]

    async def json(self) -> Dict[str, Any]:
        """Parse body as JSON."""
        ...

    async def text(self) -> str:
        """Get body as text."""
        ...

class Response:
    """HTTP Response object to return from handlers."""
    def __init__(
        self,
        body: str,
        status: int = 200,
        headers: Optional[Dict[str, str]] = None
    ):
        ...
```

## Testing

### Local Testing with pytest

Test your Python functions locally:

```python
import pytest
from my_function import handler

# Test the handler function
@pytest.mark.asyncio
async def test_handler_get():
    """Test GET request handling."""
    request = MockRequest(method="GET")
    response = await handler(request)
    assert response.status == 200

@pytest.mark.asyncio
async def test_handler_post():
    """Test POST request with JSON body."""
    request = MockRequest(
        method="POST",
        body={"name": "Alice", "age": 25}
    )
    response = await handler(request)
    data = response.json()
    assert data["greeting"] == "Hello, Alice!"
    assert data["is_adult"] == True
```

### Running Tests

```bash
# Install test dependencies
pip install pytest pytest-asyncio

# Run tests
pytest -v

# Run with coverage
pytest --cov=src
```

## Deployment

Deploy your Python function to Functions.do:

```bash
# Install dependencies to vendor directory
pip install -r requirements.txt -t ./vendor

# Deploy with wrangler
npx wrangler deploy
```

### Deployment Configuration

Structure your project for deployment:

```
my-function/
  src/
    worker.py
    handler.py
  vendor/
    functions_do_sdk/
  requirements.txt
  wrangler.toml
  pyproject.toml
```

## Memory and Performance

### Cold Start Considerations

Pyodide has longer cold start times (~50ms) compared to native Workers:

- Initial load includes Python runtime
- Large packages increase cold start time
- Use smaller dependencies when possible

### Performance Tips

1. **Minimize imports**: Only import what you need
2. **Lazy loading**: Import packages inside functions if not always needed
3. **Avoid large packages**: NumPy/Pandas add significant cold start time
4. **Cache computations**: Reuse expensive calculations

```python
# Lazy import for better cold start
async def handler(request: Request) -> Response:
    # Only import when needed
    if request.path == "/analyze":
        import numpy as np
        # Use numpy...
```

### Memory Limits

- Default memory: 128MB
- Maximum memory: 1GB (paid plan)
- Monitor memory usage in production

## SDK Configuration

The Functions.do Python SDK provides configuration options:

```python
from functions_do_sdk import FunctionsClient, Config

# Configure SDK settings
config = Config(
    api_key="your-api-key",
    endpoint="https://api.functions.do",
    timeout=30000,
    debug=False
)

client = FunctionsClient(config)

# SDK methods
await client.log({"message": "Hello"})
result = await client.invoke("function-name", {"data": "value"})
metadata = await client.get_metadata()
```

## Troubleshooting

### Common Issues

#### Package Not Available

If a package isn't available in Pyodide:

1. Check if it's pure Python
2. Check Pyodide package list
3. Consider alternative packages

```python
# Check if running in Pyodide
import sys
if "pyodide" in sys.modules:
    # Use Pyodide-compatible alternative
    from alternative_package import feature
else:
    from original_package import feature
```

#### Import Errors

Some standard library modules aren't available:

- `multiprocessing`: Not supported
- `subprocess`: Not supported
- `socket`: Limited support

#### Async/Await Issues

Ensure proper async handling:

```python
# Wrong - missing await
async def handler(request):
    data = request.json()  # Missing await!

# Correct
async def handler(request):
    data = await request.json()
```

#### Memory Errors

If you hit memory limits:

1. Reduce data in memory
2. Process in chunks
3. Use generators
4. Upgrade plan for more memory

### FAQ

**Q: What Python version does Pyodide use?**
A: Pyodide currently supports Python 3.10 and 3.11.

**Q: Can I use any pip package?**
A: Only pure Python packages and pre-built Pyodide packages. C extensions require Pyodide builds.

**Q: Why is cold start slow?**
A: Pyodide loads the entire Python runtime. Minimize imports to reduce cold start time.

**Q: Can I use machine learning libraries?**
A: Yes, scikit-learn and basic TensorFlow work. Large models may hit memory limits.

**Q: How do I handle type hints?**
A: Use `typing` module for type hints. They help with IDE support and documentation.

## Next Steps

- [SDK Reference](/docs/sdk/python)
- [Pyodide Documentation](https://pyodide.org/en/stable/)
- [Examples Repository](https://github.com/dotdo/functions-examples-python)
