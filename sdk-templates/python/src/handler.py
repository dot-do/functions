"""
Functions.do Python Handler

This module implements a serverless function handler compatible with
Functions.do and Cloudflare Workers Python (Pyodide).

The handler uses capnweb-style RPC for type-safe communication with
JavaScript and other language runtimes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, TypeVar, Generic, Optional, Union, Awaitable
from enum import Enum

# Type variables for generic handlers
T = TypeVar("T")
R = TypeVar("R")


# =============================================================================
# Core Types
# =============================================================================


class RequestMethod(Enum):
    """HTTP request methods"""
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"


@dataclass
class Headers:
    """HTTP headers wrapper with case-insensitive access"""
    _headers: dict[str, str] = field(default_factory=dict)

    def get(self, key: str, default: str | None = None) -> str | None:
        """Get a header value (case-insensitive)"""
        return self._headers.get(key.lower(), default)

    def set(self, key: str, value: str) -> None:
        """Set a header value"""
        self._headers[key.lower()] = value

    def items(self) -> list[tuple[str, str]]:
        """Get all headers as key-value pairs"""
        return list(self._headers.items())

    def to_dict(self) -> dict[str, str]:
        """Convert to dictionary"""
        return dict(self._headers)

    @classmethod
    def from_dict(cls, headers: dict[str, str]) -> "Headers":
        """Create from dictionary"""
        h = cls()
        for k, v in headers.items():
            h.set(k, v)
        return h


@dataclass
class Request:
    """
    Incoming request to the function.

    This mirrors the Cloudflare Workers Request API for compatibility.
    """
    method: RequestMethod
    url: str
    headers: Headers
    body: bytes | None = None
    cf: dict[str, Any] = field(default_factory=dict)

    @property
    def path(self) -> str:
        """Extract path from URL"""
        from urllib.parse import urlparse
        return urlparse(self.url).path

    @property
    def query(self) -> dict[str, str]:
        """Extract query parameters from URL"""
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.url)
        return {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def json(self) -> Any:
        """Parse body as JSON"""
        if self.body is None:
            return None
        return json.loads(self.body.decode("utf-8"))

    def text(self) -> str:
        """Get body as text"""
        if self.body is None:
            return ""
        return self.body.decode("utf-8")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Request":
        """Create Request from dictionary (for capnweb deserialization)"""
        return cls(
            method=RequestMethod(data.get("method", "GET")),
            url=data.get("url", "/"),
            headers=Headers.from_dict(data.get("headers", {})),
            body=data.get("body", "").encode() if data.get("body") else None,
            cf=data.get("cf", {}),
        )


@dataclass
class Response:
    """
    Outgoing response from the function.

    This mirrors the Cloudflare Workers Response API for compatibility.
    """
    body: str | bytes | None = None
    status: int = 200
    headers: Headers = field(default_factory=Headers)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary (for capnweb serialization)"""
        body = self.body
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        return {
            "body": body,
            "status": self.status,
            "headers": self.headers.to_dict(),
        }

    @classmethod
    def json(cls, data: Any, status: int = 200) -> "Response":
        """Create a JSON response"""
        headers = Headers()
        headers.set("content-type", "application/json")
        return cls(
            body=json.dumps(data),
            status=status,
            headers=headers,
        )

    @classmethod
    def text(cls, text: str, status: int = 200) -> "Response":
        """Create a plain text response"""
        headers = Headers()
        headers.set("content-type", "text/plain; charset=utf-8")
        return cls(body=text, status=status, headers=headers)

    @classmethod
    def html(cls, html: str, status: int = 200) -> "Response":
        """Create an HTML response"""
        headers = Headers()
        headers.set("content-type", "text/html; charset=utf-8")
        return cls(body=html, status=status, headers=headers)

    @classmethod
    def redirect(cls, url: str, status: int = 302) -> "Response":
        """Create a redirect response"""
        headers = Headers()
        headers.set("location", url)
        return cls(body=None, status=status, headers=headers)


# =============================================================================
# Capnweb RPC Integration
# =============================================================================


@dataclass
class RpcCall:
    """
    Represents an incoming RPC call via capnweb protocol.

    This provides type-safe method invocation across language boundaries.
    """
    method: str
    args: list[Any]
    kwargs: dict[str, Any] = field(default_factory=dict)
    call_id: str = ""
    timestamp: datetime = field(default_factory=datetime.utcnow)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RpcCall":
        """Deserialize from capnweb format"""
        return cls(
            method=data.get("method", ""),
            args=data.get("args", []),
            kwargs=data.get("kwargs", {}),
            call_id=data.get("callId", ""),
        )


@dataclass
class RpcResult:
    """
    Result of an RPC call.
    """
    value: Any = None
    error: str | None = None
    call_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize to capnweb format"""
        result: dict[str, Any] = {"callId": self.call_id}
        if self.error:
            result["error"] = self.error
        else:
            result["value"] = self.value
        return result

    @classmethod
    def success(cls, value: Any, call_id: str = "") -> "RpcResult":
        """Create a successful result"""
        return cls(value=value, call_id=call_id)

    @classmethod
    def failure(cls, error: str, call_id: str = "") -> "RpcResult":
        """Create an error result"""
        return cls(error=error, call_id=call_id)


class RpcTarget:
    """
    Base class for RPC-enabled services.

    Extend this class and define methods that can be called via capnweb RPC.
    Methods starting with underscore are considered private and not exposed.

    Example:
        class MyService(RpcTarget):
            def greet(self, name: str) -> str:
                return f"Hello, {name}!"

            async def fetch_data(self, url: str) -> dict:
                # Async methods are supported
                return {"url": url, "data": "..."}
    """

    def _get_methods(self) -> list[str]:
        """Get list of public RPC methods"""
        return [
            name for name in dir(self)
            if not name.startswith("_")
            and callable(getattr(self, name))
        ]

    async def _invoke(self, call: RpcCall) -> RpcResult:
        """Invoke an RPC method"""
        method_name = call.method

        if method_name.startswith("_") or not hasattr(self, method_name):
            return RpcResult.failure(
                f"Method '{method_name}' not found",
                call.call_id
            )

        method = getattr(self, method_name)
        if not callable(method):
            return RpcResult.failure(
                f"'{method_name}' is not callable",
                call.call_id
            )

        try:
            result = method(*call.args, **call.kwargs)
            # Handle async methods
            if hasattr(result, "__await__"):
                result = await result
            return RpcResult.success(result, call.call_id)
        except Exception as e:
            return RpcResult.failure(str(e), call.call_id)

    def _dispose(self) -> None:
        """Clean up resources. Override in subclasses."""
        pass


# =============================================================================
# Environment and Bindings
# =============================================================================


@dataclass
class Env:
    """
    Environment bindings provided by Cloudflare Workers.

    Access KV namespaces, D1 databases, R2 buckets, and other bindings.
    """
    _bindings: dict[str, Any] = field(default_factory=dict)

    def get(self, name: str) -> Any:
        """Get a binding by name"""
        return self._bindings.get(name)

    def __getattr__(self, name: str) -> Any:
        """Access bindings as attributes"""
        if name.startswith("_"):
            raise AttributeError(name)
        return self._bindings.get(name)

    @classmethod
    def from_dict(cls, bindings: dict[str, Any]) -> "Env":
        """Create from dictionary"""
        return cls(_bindings=bindings)


@dataclass
class ExecutionContext:
    """
    Execution context for the function.

    Provides waitUntil for background tasks and passThroughOnException.
    """
    _wait_until_promises: list[Awaitable[Any]] = field(default_factory=list)

    def wait_until(self, promise: Awaitable[Any]) -> None:
        """
        Schedule a background task that continues after response is sent.
        """
        self._wait_until_promises.append(promise)

    def pass_through_on_exception(self) -> None:
        """
        Allow the request to pass through to origin on exception.
        Only applicable when used as a Cloudflare Worker.
        """
        pass


# =============================================================================
# Handler Types
# =============================================================================


# Type for fetch handler
FetchHandler = Callable[[Request, Env, ExecutionContext], Union[Response, Awaitable[Response]]]

# Type for RPC handler
RpcHandler = Callable[[RpcCall, Env], Union[RpcResult, Awaitable[RpcResult]]]

# Type for scheduled handler
ScheduledHandler = Callable[[dict[str, Any], Env, ExecutionContext], Awaitable[None]]


# =============================================================================
# Default Handler Implementation
# =============================================================================


class Handler(RpcTarget):
    """
    Default handler implementation with fetch, RPC, and scheduled support.

    Override methods to customize behavior:
    - fetch: Handle HTTP requests
    - handle_rpc: Handle RPC calls
    - scheduled: Handle cron triggers
    """

    def __init__(self, env: Env | None = None) -> None:
        self.env = env or Env()

    async def fetch(self, request: Request, ctx: ExecutionContext) -> Response:
        """
        Handle incoming HTTP request.

        Override this method to implement your function logic.
        """
        # Check for RPC calls (POST with specific content-type)
        if (
            request.method == RequestMethod.POST
            and request.headers.get("content-type", "").startswith("application/json")
            and request.headers.get("x-capnweb-rpc") == "1"
        ):
            try:
                data = request.json()
                call = RpcCall.from_dict(data)
                result = await self._invoke(call)
                return Response.json(result.to_dict())
            except Exception as e:
                return Response.json(
                    RpcResult.failure(str(e)).to_dict(),
                    status=500
                )

        # Default response
        return Response.json({
            "message": "Hello from Functions.do!",
            "path": request.path,
            "method": request.method.value,
            "timestamp": datetime.utcnow().isoformat(),
        })

    async def scheduled(self, event: dict[str, Any], ctx: ExecutionContext) -> None:
        """
        Handle scheduled/cron trigger.

        Override this method to implement scheduled task logic.
        """
        pass

    # Example RPC methods - override or add your own

    def ping(self) -> str:
        """Simple health check"""
        return "pong"

    def echo(self, message: str) -> str:
        """Echo back the message"""
        return message

    def info(self) -> dict[str, Any]:
        """Get handler information"""
        return {
            "methods": self._get_methods(),
            "version": "0.1.0",
            "runtime": "python",
        }


# =============================================================================
# Entry Point
# =============================================================================


# Global handler instance
_handler: Handler | None = None


def get_handler() -> Handler:
    """Get or create the handler instance"""
    global _handler
    if _handler is None:
        _handler = Handler()
    return _handler


async def handler(args: dict[str, Any]) -> dict[str, Any]:
    """
    Main entry point for Functions.do.

    This function is called by the runtime with the incoming request.
    """
    h = get_handler()

    # Determine request type
    request_type = args.get("type", "fetch")

    if request_type == "fetch":
        # HTTP request
        request = Request.from_dict(args.get("request", {}))
        env = Env.from_dict(args.get("env", {}))
        ctx = ExecutionContext()

        response = await h.fetch(request, ctx)
        return response.to_dict()

    elif request_type == "rpc":
        # RPC call
        call = RpcCall.from_dict(args.get("call", {}))
        result = await h._invoke(call)
        return result.to_dict()

    elif request_type == "scheduled":
        # Scheduled trigger
        event = args.get("event", {})
        env = Env.from_dict(args.get("env", {}))
        ctx = ExecutionContext()

        await h.scheduled(event, ctx)
        return {"success": True}

    else:
        return {"error": f"Unknown request type: {request_type}"}


def main() -> None:
    """CLI entry point for local testing"""
    import asyncio

    async def test():
        # Test fetch
        result = await handler({
            "type": "fetch",
            "request": {
                "method": "GET",
                "url": "https://example.com/test",
                "headers": {},
            },
        })
        print("Fetch result:", json.dumps(result, indent=2))

        # Test RPC
        result = await handler({
            "type": "rpc",
            "call": {
                "method": "ping",
                "args": [],
            },
        })
        print("RPC result:", json.dumps(result, indent=2))

    asyncio.run(test())


if __name__ == "__main__":
    main()
