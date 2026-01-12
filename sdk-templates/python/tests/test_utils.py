"""
Tests for Functions.do Python SDK Utilities
"""

import pytest
import asyncio
from datetime import datetime, timedelta
from src.utils import (
    # Caching
    MemoryCache,
    # Rate limiting
    RateLimiter,
    # Validation
    ValidationError,
    validate_required,
    validate_type,
    validate_range,
    validate_length,
    validate_pattern,
    validate_email,
    # Crypto
    generate_token,
    hash_password,
    verify_password,
    hmac_sign,
    hmac_verify,
    # JSON
    json_dumps,
    json_loads,
    safe_json_loads,
    # Async
    gather_with_concurrency,
    retry_async,
    timeout_async,
    # Strings
    slugify,
    truncate,
    mask_secret,
    # Datetime
    utc_now,
    parse_iso_datetime,
    format_iso_datetime,
    time_ago,
)


class TestMemoryCache:
    """Tests for MemoryCache"""

    def test_set_and_get(self):
        """Test basic set and get operations"""
        cache = MemoryCache()
        cache.set("key", "value")
        assert cache.get("key") == "value"

    def test_get_missing_key(self):
        """Test getting non-existent key"""
        cache = MemoryCache()
        assert cache.get("missing") is None

    def test_expiration(self):
        """Test that cached values expire"""
        cache = MemoryCache(default_ttl=0)  # Immediate expiration
        cache.set("key", "value", ttl=0)

        # Force expiration by manipulating internal state
        entry = cache._cache["key"]
        entry.expires_at = datetime.utcnow() - timedelta(seconds=1)

        assert cache.get("key") is None

    def test_delete(self):
        """Test deleting cached values"""
        cache = MemoryCache()
        cache.set("key", "value")
        assert cache.delete("key") is True
        assert cache.get("key") is None
        assert cache.delete("key") is False

    def test_clear(self):
        """Test clearing all cached values"""
        cache = MemoryCache()
        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.clear()
        assert cache.get("key1") is None
        assert cache.get("key2") is None

    @pytest.mark.asyncio
    async def test_cached_decorator(self):
        """Test caching decorator"""
        cache = MemoryCache()
        call_count = 0

        @cache.cached(key="test-key")
        async def expensive_operation():
            nonlocal call_count
            call_count += 1
            return "result"

        # First call
        result1 = await expensive_operation()
        assert result1 == "result"
        assert call_count == 1

        # Second call should use cache
        result2 = await expensive_operation()
        assert result2 == "result"
        assert call_count == 1  # Not incremented


class TestRateLimiter:
    """Tests for RateLimiter"""

    def test_allow_within_limit(self):
        """Test requests within limit are allowed"""
        limiter = RateLimiter(rate=10, capacity=10)
        assert limiter.allow() is True
        assert limiter.allow() is True

    def test_block_over_limit(self):
        """Test requests over limit are blocked"""
        limiter = RateLimiter(rate=0, capacity=2)  # No refill

        assert limiter.allow() is True
        assert limiter.allow() is True
        assert limiter.allow() is False

    def test_remaining_tokens(self):
        """Test getting remaining tokens"""
        limiter = RateLimiter(rate=0, capacity=5)

        assert limiter.remaining() == 5
        limiter.allow()
        assert limiter.remaining() == 4


class TestValidation:
    """Tests for validation utilities"""

    def test_validate_required_passes(self):
        """Test required validation passes for valid values"""
        validate_required("value", "field")  # Should not raise
        validate_required(0, "field")  # 0 is valid
        validate_required(False, "field")  # False is valid

    def test_validate_required_fails_none(self):
        """Test required validation fails for None"""
        with pytest.raises(ValidationError) as exc:
            validate_required(None, "field")
        assert exc.value.field == "field"
        assert "required" in exc.value.message

    def test_validate_required_fails_empty_string(self):
        """Test required validation fails for empty string"""
        with pytest.raises(ValidationError):
            validate_required("", "field")
        with pytest.raises(ValidationError):
            validate_required("   ", "field")

    def test_validate_type_passes(self):
        """Test type validation passes"""
        validate_type("hello", "field", str)
        validate_type(123, "field", int)
        validate_type([], "field", list)

    def test_validate_type_fails(self):
        """Test type validation fails"""
        with pytest.raises(ValidationError) as exc:
            validate_type("hello", "field", int)
        assert "expected int, got str" in exc.value.message

    def test_validate_range(self):
        """Test range validation"""
        validate_range(5, "field", min_val=0, max_val=10)

        with pytest.raises(ValidationError):
            validate_range(-1, "field", min_val=0)

        with pytest.raises(ValidationError):
            validate_range(11, "field", max_val=10)

    def test_validate_length(self):
        """Test length validation"""
        validate_length("hello", "field", min_len=1, max_len=10)
        validate_length([1, 2, 3], "field", min_len=1)

        with pytest.raises(ValidationError):
            validate_length("", "field", min_len=1)

        with pytest.raises(ValidationError):
            validate_length("toolong", "field", max_len=5)

    def test_validate_pattern(self):
        """Test pattern validation"""
        validate_pattern("abc123", "field", r"^[a-z0-9]+$")

        with pytest.raises(ValidationError):
            validate_pattern("ABC", "field", r"^[a-z]+$")

    def test_validate_email(self):
        """Test email validation"""
        validate_email("user@example.com")
        validate_email("user.name+tag@example.co.uk")

        with pytest.raises(ValidationError):
            validate_email("invalid")

        with pytest.raises(ValidationError):
            validate_email("@example.com")


class TestCrypto:
    """Tests for crypto utilities"""

    def test_generate_token(self):
        """Test token generation"""
        token1 = generate_token()
        token2 = generate_token()

        assert len(token1) == 64  # 32 bytes = 64 hex chars
        assert token1 != token2

    def test_generate_token_custom_length(self):
        """Test token generation with custom length"""
        token = generate_token(16)
        assert len(token) == 32  # 16 bytes = 32 hex chars

    def test_hash_and_verify_password(self):
        """Test password hashing and verification"""
        password = "mysecretpassword"
        hash_value, salt = hash_password(password)

        assert verify_password(password, hash_value, salt) is True
        assert verify_password("wrongpassword", hash_value, salt) is False

    def test_hash_password_with_salt(self):
        """Test hashing with provided salt"""
        password = "test"
        salt = "fixedsalt123456789012345678901234"
        hash1, _ = hash_password(password, salt)
        hash2, _ = hash_password(password, salt)

        assert hash1 == hash2

    def test_hmac_sign_and_verify(self):
        """Test HMAC signing and verification"""
        data = "important message"
        secret = "mysecret"

        signature = hmac_sign(data, secret)
        assert hmac_verify(data, signature, secret) is True
        assert hmac_verify("tampered", signature, secret) is False
        assert hmac_verify(data, signature, "wrongsecret") is False

    def test_hmac_sign_bytes(self):
        """Test HMAC with bytes input"""
        data = b"binary data"
        secret = "secret"

        signature = hmac_sign(data, secret)
        assert hmac_verify(data, signature, secret) is True


class TestJSON:
    """Tests for JSON utilities"""

    def test_json_dumps_datetime(self):
        """Test serializing datetime"""
        dt = datetime(2024, 1, 15, 12, 30, 45)
        result = json_dumps({"timestamp": dt})
        assert "2024-01-15T12:30:45" in result

    def test_json_dumps_bytes(self):
        """Test serializing bytes"""
        data = {"binary": b"hello"}
        result = json_dumps(data)
        # bytes should be base64 encoded
        assert "aGVsbG8=" in result  # base64 of "hello"

    def test_json_loads(self):
        """Test JSON decoding"""
        data = json_loads('{"key": "value"}')
        assert data == {"key": "value"}

    def test_safe_json_loads_valid(self):
        """Test safe JSON loads with valid JSON"""
        data = safe_json_loads('{"key": "value"}')
        assert data == {"key": "value"}

    def test_safe_json_loads_invalid(self):
        """Test safe JSON loads with invalid JSON"""
        data = safe_json_loads('not json', default={})
        assert data == {}


class TestAsync:
    """Tests for async utilities"""

    @pytest.mark.asyncio
    async def test_gather_with_concurrency(self):
        """Test gathering with limited concurrency"""
        results = []

        async def task(n):
            results.append(n)
            return n * 2

        output = await gather_with_concurrency(
            2,
            task(1),
            task(2),
            task(3),
        )

        assert output == [2, 4, 6]
        assert set(results) == {1, 2, 3}

    @pytest.mark.asyncio
    async def test_retry_async_success(self):
        """Test retry with eventual success"""
        attempts = 0

        async def flaky_operation():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise ValueError("Temporary failure")
            return "success"

        result = await retry_async(
            flaky_operation,
            max_retries=3,
            delay=0.01,
            exceptions=(ValueError,)
        )

        assert result == "success"
        assert attempts == 3

    @pytest.mark.asyncio
    async def test_retry_async_failure(self):
        """Test retry exhaustion"""
        async def always_fail():
            raise ValueError("Always fails")

        with pytest.raises(ValueError):
            await retry_async(
                always_fail,
                max_retries=2,
                delay=0.01
            )

    @pytest.mark.asyncio
    async def test_timeout_async_success(self):
        """Test timeout with fast operation"""
        async def fast_op():
            return "done"

        result = await timeout_async(fast_op, timeout_seconds=1.0)
        assert result == "done"

    @pytest.mark.asyncio
    async def test_timeout_async_exceeded(self):
        """Test timeout exceeded"""
        async def slow_op():
            await asyncio.sleep(10)
            return "done"

        with pytest.raises(asyncio.TimeoutError):
            await timeout_async(slow_op, timeout_seconds=0.01)


class TestStrings:
    """Tests for string utilities"""

    def test_slugify(self):
        """Test slug generation"""
        assert slugify("Hello World") == "hello-world"
        assert slugify("Python_3.12") == "python-312"
        assert slugify("  Multiple   Spaces  ") == "multiple-spaces"
        assert slugify("Special!@#$%Characters") == "specialcharacters"

    def test_truncate(self):
        """Test string truncation"""
        assert truncate("Hello World", 20) == "Hello World"
        assert truncate("Hello World", 8) == "Hello..."
        assert truncate("Hello World", 8, suffix="..") == "Hello .."

    def test_mask_secret(self):
        """Test secret masking"""
        assert mask_secret("mysecretkey123") == "myse******3123"
        assert mask_secret("abc") == "***"
        assert mask_secret("12345678", visible_chars=2) == "12****78"


class TestDatetime:
    """Tests for datetime utilities"""

    def test_utc_now(self):
        """Test getting current UTC time"""
        before = datetime.utcnow()
        result = utc_now()
        after = datetime.utcnow()

        assert before <= result <= after

    def test_parse_iso_datetime(self):
        """Test parsing ISO datetime strings"""
        dt = parse_iso_datetime("2024-01-15T12:30:45")
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 15
        assert dt.hour == 12

    def test_parse_iso_datetime_with_z(self):
        """Test parsing ISO datetime with Z suffix"""
        dt = parse_iso_datetime("2024-01-15T12:30:45Z")
        assert dt.year == 2024

    def test_format_iso_datetime(self):
        """Test formatting datetime as ISO string"""
        dt = datetime(2024, 1, 15, 12, 30, 45)
        result = format_iso_datetime(dt)
        assert result == "2024-01-15T12:30:45Z"

    def test_time_ago_just_now(self):
        """Test time ago for recent time"""
        result = time_ago(datetime.utcnow() - timedelta(seconds=30))
        assert result == "just now"

    def test_time_ago_minutes(self):
        """Test time ago for minutes"""
        result = time_ago(datetime.utcnow() - timedelta(minutes=5))
        assert "5 minutes ago" == result

    def test_time_ago_hours(self):
        """Test time ago for hours"""
        result = time_ago(datetime.utcnow() - timedelta(hours=3))
        assert "3 hours ago" == result

    def test_time_ago_days(self):
        """Test time ago for days"""
        result = time_ago(datetime.utcnow() - timedelta(days=2))
        assert "2 days ago" == result

    def test_time_ago_weeks(self):
        """Test time ago for weeks"""
        result = time_ago(datetime.utcnow() - timedelta(weeks=3))
        assert "3 weeks ago" == result
