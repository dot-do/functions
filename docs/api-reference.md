# API Reference

## Overview

The Functions.do API provides a complete interface for deploying, invoking, and managing serverless functions. This reference documents all available endpoints, authentication methods, request/response schemas, and error handling.

**Base URL:** `https://functions.do`

All API requests should use `Content-Type: application/json` for request bodies and will return JSON responses.

## API Versioning

The API supports versioned endpoints with the `/v1/` prefix. This allows for future API changes while maintaining backwards compatibility.

**Recommended:** Use versioned endpoints (e.g., `/v1/api/functions`) for all new integrations.

**Legacy Support:** Unversioned endpoints (e.g., `/api/functions`) remain available for backwards compatibility but may be deprecated in future releases.

| Versioned Endpoint | Legacy Endpoint | Description |
|-------------------|-----------------|-------------|
| `POST /v1/api/functions` | `POST /api/functions` | Deploy a function |
| `GET /v1/api/functions/:id` | `GET /api/functions/:id` | Get function info |
| `DELETE /v1/api/functions/:id` | `DELETE /api/functions/:id` | Delete a function |
| `GET /v1/functions/:id/logs` | `GET /functions/:id/logs` | Get function logs |
| `POST /v1/functions/:id` | `POST /functions/:id` | Invoke a function |
| `POST /v1/functions/:id/invoke` | `POST /functions/:id/invoke` | Invoke a function (explicit) |

## Authentication

The Functions.do API uses API key-based authentication via the `X-API-Key` header.

### API Key Header

Include your API key in the `X-API-Key` header for all authenticated requests:

```
X-API-Key: your-api-key-here
```

### Public Endpoints

The following endpoints do not require authentication:

- `/` - Root endpoint
- `/health` - Health check endpoint

### Authentication Errors

| Status | Description |
|--------|-------------|
| 401 Unauthorized | Missing API key - no `X-API-Key` header provided |
| 401 Unauthorized | Invalid API key - the provided key is not valid or has been revoked |

API keys may have an expiration date. Expired keys will return a 401 Unauthorized response. Contact your administrator to rotate or renew expired API keys.

### cURL Example with Authentication

```bash
curl -X POST https://functions.do/v1/api/functions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{"id": "my-function", "version": "1.0.0", "language": "typescript", "entryPoint": "index.ts", "dependencies": {}}'
```

## Endpoints

### POST /v1/api/functions

Deploy a new function or update an existing function.

**Request Body:**

```json
{
  "id": "my-function",
  "version": "1.0.0",
  "language": "typescript",
  "entryPoint": "index.ts",
  "dependencies": {
    "lodash": "^4.17.21"
  }
}
```

**Deploy Response:**

```json
{
  "id": "my-function",
  "version": "1.0.0",
  "language": "typescript",
  "entryPoint": "index.ts",
  "dependencies": {
    "lodash": "^4.17.21"
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### POST /v1/functions/:functionId

Invoke a function by ID. Supports both direct fetch handler invocation and RPC-style method calls.

**Path Parameters:**
- `functionId` - The unique function identifier (1-255 alphanumeric characters with hyphens and underscores)

**Invoke Request Body (RPC-style):**

```json
{
  "method": "processData",
  "params": ["arg1", "arg2"]
}
```

**Invoke Response:**

```json
{
  "result": "processed data output"
}
```

**Invoke Example:**

```bash
curl -X POST https://functions.do/v1/functions/my-function \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{"method": "hello", "params": ["world"]}'
```

### POST /v1/functions/:functionId/invoke

Alternative endpoint to invoke a function. Behaves identically to `POST /v1/functions/:functionId`.

**Request Body:**

```json
{
  "method": "getData",
  "params": []
}
```

### GET /v1/api/functions

List all deployed functions. Returns an array of function metadata.

**List Response:**

```json
[
  {
    "id": "my-function",
    "version": "1.0.0",
    "language": "typescript",
    "entryPoint": "index.ts",
    "dependencies": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  {
    "id": "another-function",
    "version": "2.1.0",
    "language": "javascript",
    "entryPoint": "main.js",
    "dependencies": {},
    "createdAt": "2024-01-14T09:00:00.000Z",
    "updatedAt": "2024-01-15T08:00:00.000Z"
  }
]
```

The response may also be wrapped in a `functions` object:

```json
{
  "functions": [
    {
      "id": "my-function",
      "version": "1.0.0"
    }
  ]
}
```

### GET /v1/api/functions/:functionId

Get details and metadata for a specific function.

**Response:**

```json
{
  "id": "my-function",
  "status": "loaded",
  "version": "1.0.0",
  "fromCache": true,
  "loadTimeMs": 45
}
```

### GET /v1/api/functions/:functionId/info

Alternative endpoint to get function details. Returns function metadata and loading information.

### DELETE /v1/api/functions/:functionId

Delete a function and all its versions. This operation cascades to remove:
- The current active function
- All version snapshots
- Version history records

**Response:**

```json
{
  "status": "deleted",
  "id": "my-function"
}
```

### POST /v1/api/functions/:functionId/rollback

Rollback a function to a previous version. This restores the function metadata and code from the specified version.

**Rollback Request Body:**

```json
{
  "version": "1.0.0"
}
```

**Rollback Response:**

```json
{
  "id": "my-function",
  "version": "1.0.0",
  "status": "restored",
  "previous": "2.0.0",
  "updatedAt": "2024-01-15T12:00:00.000Z"
}
```

### GET /v1/functions/:functionId/logs

Retrieve execution logs for a function.

**Query Parameters:**
- `level` - Filter logs by level (debug, info, warn, error)
- `timestamp` - Filter logs after a specific timestamp
- `limit` - Maximum number of log entries to return

**Response:**

```json
{
  "logs": [
    {
      "timestamp": "2024-01-15T10:30:00.000Z",
      "level": "info",
      "message": "Function executed successfully"
    }
  ]
}
```

### GET /health

Health check endpoint to verify API status. This is a public endpoint that does not require authentication.

**Health Response:**

```json
{
  "status": "ok",
  "service": "Functions.do"
}
```

## Request/Response Schemas

### FunctionMetadata Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique function identifier (1-255 chars, alphanumeric with hyphens and underscores) |
| `version` | string | Yes | Semantic version (semver format: `1.0.0`, `2.1.0-beta.1`) |
| `language` | string | Yes | Programming language (see supported languages) |
| `entryPoint` | string | Yes | Entry point file path (relative path, e.g., `index.ts`, `src/main.js`) |
| `dependencies` | object | Yes | Dependencies object with package names and semver versions |
| `createdAt` | string | No | ISO 8601 timestamp when function was created |
| `updatedAt` | string | No | ISO 8601 timestamp when function was last updated |

### Function ID Validation

Function IDs must follow these rules:
- Length: 1-255 characters
- Characters: alphanumeric (a-z, A-Z, 0-9), hyphens (-), underscores (_)
- No leading or trailing hyphens or underscores

Valid examples: `my-function`, `processData_v2`, `api123`

### Supported Languages

The following programming languages are supported:

- `typescript` - TypeScript functions
- `javascript` - JavaScript functions
- `rust` - Rust compiled to WebAssembly
- `python` - Python functions (via Pyodide)
- `go` - Go compiled to WebAssembly
- `zig` - Zig compiled to WebAssembly
- `assemblyscript` - AssemblyScript functions
- `csharp` - C# functions

### Entry Point Validation

Entry points must be valid relative paths:
- Must not start with `/` (absolute paths not allowed)
- Must not contain `..` (parent directory references)
- Must have a valid file extension (`.ts`, `.js`, `.py`, etc.)

### Dependencies Format

Dependencies are specified as an object mapping package names to semver version ranges:

```json
{
  "dependencies": {
    "lodash": "^4.17.21",
    "axios": "~1.0.0",
    "express": ">=4.0.0"
  }
}
```

Supported version formats:
- Exact: `1.0.0`
- Caret range: `^1.0.0` (compatible with version)
- Tilde range: `~1.0.0` (approximately equivalent)
- Comparison: `>=1.0.0`, `<2.0.0`
- Range: `1.0.0 - 2.0.0`
- Wildcard: `*`, `latest`

### LoadResult Schema

When loading functions, the API returns detailed information:

| Field | Type | Description |
|-------|------|-------------|
| `stub` | object | The loaded function stub (handler interface) |
| `success` | boolean | Whether the load was successful |
| `fromCache` | boolean | Whether the function was served from cache |
| `loadTimeMs` | number | Time taken to load the function in milliseconds |
| `degraded` | boolean | Whether the function is running in degraded mode |
| `degradationReason` | string | Reason for degradation if applicable |

### Response Headers

API responses include standard headers:

- `Content-Type: application/json`

Rate limited responses include additional headers (see Rate Limiting section).

## Error Handling

### Error Response Format

All errors return a JSON response with an `error` field:

```json
{
  "error": "Function not found",
  "message": "The requested function does not exist",
  "context": {
    "resource": "Function",
    "id": "non-existent-function"
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid input data (function ID, version, metadata) |
| `NOT_FOUND` | Requested resource (function, version) does not exist |
| `AUTHENTICATION_ERROR` | Authentication failed (missing or invalid API key) |
| `RATE_LIMIT_ERROR` | Rate limit exceeded for IP or function |
| `INVOCATION_ERROR` | Function invocation failed during execution |

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 OK | Request successful |
| 400 Bad Request | Invalid request parameters or body (validation error) |
| 401 Unauthorized | Authentication required or failed |
| 404 Not Found | Function or resource not found |
| 405 Method Not Allowed | HTTP method not supported for endpoint |
| 429 Too Many Requests | Rate limit exceeded |
| 500 Internal Server Error | Server-side error during processing |

### Error Examples

**Validation Error (400):**

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid function ID: must be alphanumeric with hyphens and underscores",
  "context": {
    "field": "id",
    "value": "invalid..id"
  }
}
```

**Not Found Error (404):**

```json
{
  "error": "NOT_FOUND",
  "message": "Function not found: my-function",
  "context": {
    "resource": "Function",
    "id": "my-function"
  }
}
```

**Authentication Error (401):**

```json
{
  "error": "AUTHENTICATION_ERROR",
  "message": "Invalid API key"
}
```

## Rate Limiting

The API implements rate limiting to ensure fair usage and protect against abuse.

### Rate Limit Types

**Per-IP Rate Limit:**
- 100 requests per minute (60 second window)
- Applied to all requests from a single client IP

**Per-Function Rate Limit:**
- 1000 requests per minute (60 second window)
- Applied to invocations of a specific function

### Rate Limit Response Headers

When rate limited, the response includes these headers:

| Header | Description |
|--------|-------------|
| `Retry-After` | Seconds until the rate limit resets |
| `X-RateLimit-Remaining` | Number of requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (milliseconds) when the limit resets |

### Rate Limit Error Response (429)

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for ip. Please retry after 45 seconds.",
  "retryAfter": 45,
  "resetAt": 1705312800000
}
```

### Rate Limit Window

The rate limit window is 60 seconds (1 minute). After the window resets, your request quota is restored to the maximum.

## Versioning

### Function Versioning

Functions support semantic versioning (semver) for version management:

- Format: `MAJOR.MINOR.PATCH` (e.g., `1.0.0`, `2.1.0`)
- Pre-release versions: `1.0.0-beta.1`, `2.0.0-rc.1`
- Build metadata: `1.0.0+build.123`

### Version History

Each deployment is recorded in the version history. You can:
- View all deployed versions
- Rollback to any previous version
- Track deployment timestamps

### Deployment History

The API maintains a complete deployment history for each function, allowing you to:
- View when each version was deployed
- Rollback to restore previous functionality
- Audit changes over time
