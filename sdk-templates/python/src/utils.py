"""
Functions.do Python SDK Utilities

This module provides utility functions and helpers for building
serverless functions on Functions.do.
"""

from __future__ import annotations

import json
import hashlib
import hmac
import base64
from datetime import datetime, timedelta
from typing import Any, TypeVar, Callable, Awaitable, Optional, Union
from dataclasses import dataclass, field
from functools import wraps
import asyncio

T = TypeVar("T")
R = TypeVar("R")


# =============================================================================
# Caching Utilities
# =============================================================================


@dataclass
class CacheEntry:
    """A cached value with expiration"""
    value: Any
    expires_at: datetime


class MemoryCache:
    """
    Simple in-memory cache for function results.

    Note: In Workers, cache is per-isolate and not shared across requests.
    For persistent caching, use KV or Cache API.

    Example:
        cache = MemoryCache(default_ttl=60)

        @cache.cached(key="my-key")
        async def expensive_operation():
            return await fetch_data()
    """

    def __init__(self, default_ttl: int = 300):
        """
        Initialize cache.

        Args:
            default_ttl: Default time-to-live in seconds
        """
        self._cache: dict[str, CacheEntry] = {}
        self.default_ttl = default_ttl

    def get(self, key: str) -> Any | None:
        """Get a cached value if not expired"""
        entry = self._cache.get(key)
        if entry is None:
            return None
        if datetime.utcnow() > entry.expires_at:
            del self._cache[key]
            return None
        return entry.value

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """Set a cached value with TTL"""
        ttl = ttl or self.default_ttl
        self._cache[key] = CacheEntry(
            value=value,
            expires_at=datetime.utcnow() + timedelta(seconds=ttl)
        )

    def delete(self, key: str) -> bool:
        """Delete a cached value"""
        if key in self._cache:
            del self._cache[key]
            return True
        return False

    def clear(self) -> None:
        """Clear all cached values"""
        self._cache.clear()

    def cached(
        self,
        key: str | None = None,
        ttl: int | None = None,
        key_builder: Callable[..., str] | None = None,
    ):
        """
        Decorator to cache function results.

        Args:
            key: Static cache key (use key_builder for dynamic)
            ttl: Time-to-live in seconds
            key_builder: Function to build key from arguments
        """
        def decorator(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
            @wraps(func)
            async def wrapper(*args, **kwargs) -> T:
                # Build cache key
                if key_builder:
                    cache_key = key_builder(*args, **kwargs)
                elif key:
                    cache_key = key
                else:
                    cache_key = f"{func.__name__}:{hash((args, tuple(sorted(kwargs.items()))))}"

                # Check cache
                cached = self.get(cache_key)
                if cached is not None:
                    return cached

                # Execute and cache
                result = await func(*args, **kwargs)
                self.set(cache_key, result, ttl)
                return result

            return wrapper
        return decorator


# =============================================================================
# Rate Limiting
# =============================================================================


@dataclass
class RateLimitState:
    """State for rate limiting"""
    tokens: float
    last_update: datetime


class RateLimiter:
    """
    Token bucket rate limiter.

    Note: In Workers, rate limit state is per-isolate. For distributed
    rate limiting, use Durable Objects or external rate limit service.

    Example:
        limiter = RateLimiter(rate=10, capacity=100)

        async def handler(request):
            if not limiter.allow():
                return Response.json({"error": "Rate limited"}, status=429)
            return await process_request(request)
    """

    def __init__(self, rate: float, capacity: float):
        """
        Initialize rate limiter.

        Args:
            rate: Tokens replenished per second
            capacity: Maximum token bucket capacity
        """
        self.rate = rate
        self.capacity = capacity
        self._state = RateLimitState(tokens=capacity, last_update=datetime.utcnow())

    def _refill(self) -> None:
        """Refill tokens based on elapsed time"""
        now = datetime.utcnow()
        elapsed = (now - self._state.last_update).total_seconds()
        self._state.tokens = min(
            self.capacity,
            self._state.tokens + elapsed * self.rate
        )
        self._state.last_update = now

    def allow(self, tokens: float = 1.0) -> bool:
        """
        Check if request is allowed and consume tokens.

        Args:
            tokens: Number of tokens to consume

        Returns:
            True if allowed, False if rate limited
        """
        self._refill()
        if self._state.tokens >= tokens:
            self._state.tokens -= tokens
            return True
        return False

    def remaining(self) -> float:
        """Get remaining tokens"""
        self._refill()
        return self._state.tokens


# =============================================================================
# Validation Utilities
# =============================================================================


class ValidationError(Exception):
    """Validation error with field information"""

    def __init__(self, field: str, message: str, value: Any = None):
        self.field = field
        self.message = message
        self.value = value
        super().__init__(f"{field}: {message}")


def validate_required(value: Any, field: str) -> None:
    """Validate that a value is not None or empty"""
    if value is None:
        raise ValidationError(field, "is required")
    if isinstance(value, str) and not value.strip():
        raise ValidationError(field, "cannot be empty", value)


def validate_type(value: Any, field: str, expected_type: type) -> None:
    """Validate that a value has the expected type"""
    if not isinstance(value, expected_type):
        raise ValidationError(
            field,
            f"expected {expected_type.__name__}, got {type(value).__name__}",
            value
        )


def validate_range(
    value: int | float,
    field: str,
    min_val: int | float | None = None,
    max_val: int | float | None = None,
) -> None:
    """Validate that a numeric value is within range"""
    if min_val is not None and value < min_val:
        raise ValidationError(field, f"must be at least {min_val}", value)
    if max_val is not None and value > max_val:
        raise ValidationError(field, f"must be at most {max_val}", value)


def validate_length(
    value: str | list | dict,
    field: str,
    min_len: int | None = None,
    max_len: int | None = None,
) -> None:
    """Validate that a value has the expected length"""
    length = len(value)
    if min_len is not None and length < min_len:
        raise ValidationError(field, f"must have at least {min_len} items", value)
    if max_len is not None and length > max_len:
        raise ValidationError(field, f"must have at most {max_len} items", value)


def validate_pattern(value: str, field: str, pattern: str) -> None:
    """Validate that a string matches a regex pattern"""
    import re
    if not re.match(pattern, value):
        raise ValidationError(field, f"does not match pattern {pattern}", value)


def validate_email(value: str, field: str = "email") -> None:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not value or not isinstance(value, str):
        raise ValidationError(field, "is required")
    import re
    if not re.match(pattern, value):
        raise ValidationError(field, "is not a valid email address", value)


# =============================================================================
# Crypto Utilities
# =============================================================================


def generate_token(length: int = 32) -> str:
    """Generate a cryptographically secure random token"""
    import secrets
    return secrets.token_hex(length)


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """
    Hash a password using PBKDF2.

    Args:
        password: Password to hash
        salt: Optional salt (generated if not provided)

    Returns:
        Tuple of (hash, salt)
    """
    import secrets
    if salt is None:
        salt = secrets.token_hex(16)

    hash_bytes = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return base64.b64encode(hash_bytes).decode('utf-8'), salt


def verify_password(password: str, hash_value: str, salt: str) -> bool:
    """Verify a password against its hash"""
    computed_hash, _ = hash_password(password, salt)
    return hmac.compare_digest(computed_hash, hash_value)


def hmac_sign(data: str | bytes, secret: str, algorithm: str = 'sha256') -> str:
    """Create HMAC signature"""
    if isinstance(data, str):
        data = data.encode('utf-8')
    signature = hmac.new(
        secret.encode('utf-8'),
        data,
        algorithm
    ).digest()
    return base64.b64encode(signature).decode('utf-8')


def hmac_verify(data: str | bytes, signature: str, secret: str, algorithm: str = 'sha256') -> bool:
    """Verify HMAC signature"""
    expected = hmac_sign(data, secret, algorithm)
    return hmac.compare_digest(expected, signature)


# =============================================================================
# JSON Utilities
# =============================================================================


class JSONEncoder(json.JSONEncoder):
    """Extended JSON encoder that handles common Python types"""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return base64.b64encode(obj).decode('utf-8')
        if hasattr(obj, 'to_dict'):
            return obj.to_dict()
        if hasattr(obj, '__dict__'):
            return obj.__dict__
        return super().default(obj)


def json_dumps(obj: Any, **kwargs) -> str:
    """JSON encode with extended type support"""
    return json.dumps(obj, cls=JSONEncoder, **kwargs)


def json_loads(s: str | bytes, **kwargs) -> Any:
    """JSON decode"""
    return json.loads(s, **kwargs)


def safe_json_loads(s: str | bytes, default: Any = None) -> Any:
    """JSON decode with fallback on error"""
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return default


# =============================================================================
# Async Utilities
# =============================================================================


async def gather_with_concurrency(
    limit: int,
    *tasks: Awaitable[T],
) -> list[T]:
    """
    Run async tasks with limited concurrency.

    Args:
        limit: Maximum concurrent tasks
        *tasks: Tasks to run

    Returns:
        List of results in order
    """
    semaphore = asyncio.Semaphore(limit)

    async def limited_task(task: Awaitable[T]) -> T:
        async with semaphore:
            return await task

    return await asyncio.gather(*[limited_task(t) for t in tasks])


async def retry_async(
    func: Callable[..., Awaitable[T]],
    *args,
    max_retries: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
    **kwargs,
) -> T:
    """
    Retry an async function with exponential backoff.

    Args:
        func: Async function to retry
        max_retries: Maximum number of retries
        delay: Initial delay between retries
        backoff: Multiplier for delay after each retry
        exceptions: Exception types to catch and retry

    Returns:
        Function result

    Raises:
        Last exception if all retries fail
    """
    last_exception: Exception | None = None
    current_delay = delay

    for attempt in range(max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except exceptions as e:
            last_exception = e
            if attempt < max_retries:
                await asyncio.sleep(current_delay)
                current_delay *= backoff

    raise last_exception  # type: ignore


async def timeout_async(
    func: Callable[..., Awaitable[T]],
    *args,
    timeout_seconds: float,
    **kwargs,
) -> T:
    """
    Run an async function with a timeout.

    Args:
        func: Async function to run
        timeout_seconds: Timeout in seconds

    Returns:
        Function result

    Raises:
        asyncio.TimeoutError if timeout is exceeded
    """
    return await asyncio.wait_for(
        func(*args, **kwargs),
        timeout=timeout_seconds
    )


# =============================================================================
# String Utilities
# =============================================================================


def slugify(text: str) -> str:
    """Convert text to URL-safe slug"""
    import re
    # Convert to lowercase
    text = text.lower()
    # Replace spaces and underscores with hyphens
    text = re.sub(r'[\s_]+', '-', text)
    # Remove non-alphanumeric characters (except hyphens)
    text = re.sub(r'[^a-z0-9-]', '', text)
    # Remove consecutive hyphens
    text = re.sub(r'-+', '-', text)
    # Remove leading/trailing hyphens
    return text.strip('-')


def truncate(text: str, length: int, suffix: str = '...') -> str:
    """Truncate text to specified length"""
    if len(text) <= length:
        return text
    return text[:length - len(suffix)] + suffix


def mask_secret(value: str, visible_chars: int = 4) -> str:
    """Mask a secret value, showing only first/last characters"""
    if len(value) <= visible_chars * 2:
        return '*' * len(value)
    return value[:visible_chars] + '*' * (len(value) - visible_chars * 2) + value[-visible_chars:]


# =============================================================================
# Date/Time Utilities
# =============================================================================


def utc_now() -> datetime:
    """Get current UTC datetime"""
    return datetime.utcnow()


def parse_iso_datetime(s: str) -> datetime:
    """Parse ISO 8601 datetime string"""
    # Handle common ISO formats
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    return datetime.fromisoformat(s)


def format_iso_datetime(dt: datetime) -> str:
    """Format datetime as ISO 8601 string"""
    return dt.isoformat() + 'Z'


def time_ago(dt: datetime) -> str:
    """Get human-readable time ago string"""
    now = datetime.utcnow()
    diff = now - dt

    seconds = diff.total_seconds()

    if seconds < 60:
        return "just now"
    elif seconds < 3600:
        minutes = int(seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif seconds < 604800:
        days = int(seconds / 86400)
        return f"{days} day{'s' if days != 1 else ''} ago"
    else:
        weeks = int(seconds / 604800)
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"
