"""
Tests for Functions.do Python Handler
"""

import pytest
from src.handler import (
    handler,
    Handler,
    Request,
    Response,
    RequestMethod,
    Headers,
    RpcCall,
    RpcResult,
    RpcTarget,
    Env,
    ExecutionContext,
)


class TestRequest:
    """Tests for Request class"""

    def test_from_dict_minimal(self):
        """Test creating request with minimal data"""
        request = Request.from_dict({})
        assert request.method == RequestMethod.GET
        assert request.url == "/"
        assert request.body is None

    def test_from_dict_full(self):
        """Test creating request with full data"""
        request = Request.from_dict({
            "method": "POST",
            "url": "https://example.com/api/users?page=1",
            "headers": {"content-type": "application/json"},
            "body": '{"name": "test"}',
            "cf": {"country": "US"},
        })

        assert request.method == RequestMethod.POST
        assert request.url == "https://example.com/api/users?page=1"
        assert request.headers.get("content-type") == "application/json"
        assert request.json() == {"name": "test"}
        assert request.cf["country"] == "US"

    def test_path_extraction(self):
        """Test extracting path from URL"""
        request = Request.from_dict({
            "url": "https://example.com/api/users/123"
        })
        assert request.path == "/api/users/123"

    def test_query_extraction(self):
        """Test extracting query parameters"""
        request = Request.from_dict({
            "url": "https://example.com/search?q=test&page=2"
        })
        assert request.query == {"q": "test", "page": "2"}

    def test_text_body(self):
        """Test getting body as text"""
        request = Request.from_dict({
            "body": "Hello, World!"
        })
        assert request.text() == "Hello, World!"

    def test_empty_body(self):
        """Test handling empty body"""
        request = Request.from_dict({})
        assert request.json() is None
        assert request.text() == ""


class TestResponse:
    """Tests for Response class"""

    def test_json_response(self):
        """Test creating JSON response"""
        response = Response.json({"message": "Hello"})

        assert response.status == 200
        assert response.headers.get("content-type") == "application/json"
        assert response.body == '{"message": "Hello"}'

    def test_json_response_with_status(self):
        """Test JSON response with custom status"""
        response = Response.json({"error": "Not found"}, status=404)
        assert response.status == 404

    def test_text_response(self):
        """Test creating text response"""
        response = Response.text("Hello, World!")

        assert response.status == 200
        assert response.headers.get("content-type") == "text/plain; charset=utf-8"
        assert response.body == "Hello, World!"

    def test_html_response(self):
        """Test creating HTML response"""
        response = Response.html("<h1>Hello</h1>")

        assert response.status == 200
        assert response.headers.get("content-type") == "text/html; charset=utf-8"
        assert response.body == "<h1>Hello</h1>"

    def test_redirect_response(self):
        """Test creating redirect response"""
        response = Response.redirect("https://example.com/new")

        assert response.status == 302
        assert response.headers.get("location") == "https://example.com/new"
        assert response.body is None

    def test_redirect_with_status(self):
        """Test redirect with custom status"""
        response = Response.redirect("https://example.com/new", status=301)
        assert response.status == 301

    def test_to_dict(self):
        """Test converting response to dict"""
        response = Response.json({"test": True})
        result = response.to_dict()

        assert result["status"] == 200
        assert result["body"] == '{"test": true}'
        assert result["headers"]["content-type"] == "application/json"


class TestHeaders:
    """Tests for Headers class"""

    def test_case_insensitive_get(self):
        """Test case-insensitive header access"""
        headers = Headers()
        headers.set("Content-Type", "application/json")

        assert headers.get("content-type") == "application/json"
        assert headers.get("Content-Type") == "application/json"
        assert headers.get("CONTENT-TYPE") == "application/json"

    def test_default_value(self):
        """Test default value for missing header"""
        headers = Headers()
        assert headers.get("missing") is None
        assert headers.get("missing", "default") == "default"

    def test_from_dict(self):
        """Test creating headers from dict"""
        headers = Headers.from_dict({
            "Content-Type": "application/json",
            "X-Custom-Header": "value"
        })

        assert headers.get("content-type") == "application/json"
        assert headers.get("x-custom-header") == "value"

    def test_to_dict(self):
        """Test converting headers to dict"""
        headers = Headers()
        headers.set("Content-Type", "application/json")
        result = headers.to_dict()

        assert result["content-type"] == "application/json"

    def test_items(self):
        """Test getting header items"""
        headers = Headers()
        headers.set("A", "1")
        headers.set("B", "2")
        items = headers.items()

        assert len(items) == 2
        assert ("a", "1") in items
        assert ("b", "2") in items


class TestRpcCall:
    """Tests for RpcCall class"""

    def test_from_dict_minimal(self):
        """Test creating RPC call with minimal data"""
        call = RpcCall.from_dict({})
        assert call.method == ""
        assert call.args == []
        assert call.kwargs == {}

    def test_from_dict_full(self):
        """Test creating RPC call with full data"""
        call = RpcCall.from_dict({
            "method": "greet",
            "args": ["World"],
            "kwargs": {"formal": True},
            "callId": "123"
        })

        assert call.method == "greet"
        assert call.args == ["World"]
        assert call.kwargs == {"formal": True}
        assert call.call_id == "123"


class TestRpcResult:
    """Tests for RpcResult class"""

    def test_success(self):
        """Test creating successful result"""
        result = RpcResult.success("Hello", call_id="123")

        assert result.value == "Hello"
        assert result.error is None
        assert result.call_id == "123"

    def test_failure(self):
        """Test creating error result"""
        result = RpcResult.failure("Something went wrong", call_id="123")

        assert result.value is None
        assert result.error == "Something went wrong"
        assert result.call_id == "123"

    def test_to_dict_success(self):
        """Test serializing successful result"""
        result = RpcResult.success({"data": "test"}, call_id="abc")
        data = result.to_dict()

        assert data["callId"] == "abc"
        assert data["value"] == {"data": "test"}
        assert "error" not in data

    def test_to_dict_failure(self):
        """Test serializing error result"""
        result = RpcResult.failure("Error message", call_id="xyz")
        data = result.to_dict()

        assert data["callId"] == "xyz"
        assert data["error"] == "Error message"


class TestRpcTarget:
    """Tests for RpcTarget class"""

    def test_get_methods(self):
        """Test getting public methods"""
        class MyService(RpcTarget):
            def public_method(self):
                return "public"

            def _private_method(self):
                return "private"

        service = MyService()
        methods = service._get_methods()

        assert "public_method" in methods
        assert "_private_method" not in methods
        assert "_get_methods" not in methods

    @pytest.mark.asyncio
    async def test_invoke_success(self):
        """Test invoking method successfully"""
        class MyService(RpcTarget):
            def add(self, a, b):
                return a + b

        service = MyService()
        call = RpcCall.from_dict({
            "method": "add",
            "args": [2, 3],
            "callId": "test"
        })

        result = await service._invoke(call)

        assert result.value == 5
        assert result.error is None
        assert result.call_id == "test"

    @pytest.mark.asyncio
    async def test_invoke_async_method(self):
        """Test invoking async method"""
        class MyService(RpcTarget):
            async def async_greet(self, name):
                return f"Hello, {name}!"

        service = MyService()
        call = RpcCall.from_dict({
            "method": "async_greet",
            "args": ["World"]
        })

        result = await service._invoke(call)
        assert result.value == "Hello, World!"

    @pytest.mark.asyncio
    async def test_invoke_method_not_found(self):
        """Test invoking non-existent method"""
        service = RpcTarget()
        call = RpcCall.from_dict({
            "method": "nonexistent",
            "args": []
        })

        result = await service._invoke(call)

        assert result.error is not None
        assert "not found" in result.error

    @pytest.mark.asyncio
    async def test_invoke_private_method_blocked(self):
        """Test that private methods cannot be invoked"""
        class MyService(RpcTarget):
            def _secret(self):
                return "secret"

        service = MyService()
        call = RpcCall.from_dict({
            "method": "_secret",
            "args": []
        })

        result = await service._invoke(call)

        assert result.error is not None
        assert "not found" in result.error

    @pytest.mark.asyncio
    async def test_invoke_handles_exception(self):
        """Test that exceptions are caught and returned"""
        class MyService(RpcTarget):
            def failing_method(self):
                raise ValueError("Something went wrong")

        service = MyService()
        call = RpcCall.from_dict({
            "method": "failing_method",
            "args": []
        })

        result = await service._invoke(call)

        assert result.error is not None
        assert "Something went wrong" in result.error


class TestEnv:
    """Tests for Env class"""

    def test_get_binding(self):
        """Test getting binding by name"""
        env = Env.from_dict({"MY_KV": {"type": "kv"}})
        assert env.get("MY_KV") == {"type": "kv"}
        assert env.get("MISSING") is None

    def test_attribute_access(self):
        """Test accessing bindings as attributes"""
        env = Env.from_dict({"MY_KV": {"type": "kv"}})
        assert env.MY_KV == {"type": "kv"}
        assert env.MISSING is None


class TestHandler:
    """Tests for main handler function"""

    @pytest.mark.asyncio
    async def test_fetch_request(self):
        """Test handling fetch request"""
        result = await handler({
            "type": "fetch",
            "request": {
                "method": "GET",
                "url": "https://example.com/test",
                "headers": {},
            },
        })

        assert result["status"] == 200
        assert "body" in result

    @pytest.mark.asyncio
    async def test_rpc_ping(self):
        """Test RPC ping method"""
        result = await handler({
            "type": "rpc",
            "call": {
                "method": "ping",
                "args": [],
            },
        })

        assert result["value"] == "pong"
        assert result.get("error") is None

    @pytest.mark.asyncio
    async def test_rpc_echo(self):
        """Test RPC echo method"""
        result = await handler({
            "type": "rpc",
            "call": {
                "method": "echo",
                "args": ["test message"],
            },
        })

        assert result["value"] == "test message"

    @pytest.mark.asyncio
    async def test_rpc_info(self):
        """Test RPC info method"""
        result = await handler({
            "type": "rpc",
            "call": {
                "method": "info",
                "args": [],
            },
        })

        assert "methods" in result["value"]
        assert "version" in result["value"]
        assert result["value"]["runtime"] == "python"

    @pytest.mark.asyncio
    async def test_unknown_type(self):
        """Test handling unknown request type"""
        result = await handler({
            "type": "unknown",
        })

        assert "error" in result
        assert "Unknown request type" in result["error"]

    @pytest.mark.asyncio
    async def test_scheduled_request(self):
        """Test handling scheduled request"""
        result = await handler({
            "type": "scheduled",
            "event": {
                "cron": "0 * * * *",
                "scheduledTime": 1234567890,
            },
        })

        assert result["success"] is True
