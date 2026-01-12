"""
Functions.do Python Handler Package

This package contains the main handler for the serverless function.
"""

from .handler import (
    handler,
    Handler,
    Request,
    Response,
    RpcCall,
    RpcResult,
    RpcTarget,
    Env,
    ExecutionContext,
    Headers,
    RequestMethod,
)

from .utils import (
    # Caching
    MemoryCache,
    CacheEntry,
    # Rate limiting
    RateLimiter,
    RateLimitState,
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
    JSONEncoder,
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

__all__ = [
    # Core handler
    "handler",
    "Handler",
    "Request",
    "Response",
    "RpcCall",
    "RpcResult",
    "RpcTarget",
    "Env",
    "ExecutionContext",
    "Headers",
    "RequestMethod",
    # Caching
    "MemoryCache",
    "CacheEntry",
    # Rate limiting
    "RateLimiter",
    "RateLimitState",
    # Validation
    "ValidationError",
    "validate_required",
    "validate_type",
    "validate_range",
    "validate_length",
    "validate_pattern",
    "validate_email",
    # Crypto
    "generate_token",
    "hash_password",
    "verify_password",
    "hmac_sign",
    "hmac_verify",
    # JSON
    "JSONEncoder",
    "json_dumps",
    "json_loads",
    "safe_json_loads",
    # Async
    "gather_with_concurrency",
    "retry_async",
    "timeout_async",
    # Strings
    "slugify",
    "truncate",
    "mask_secret",
    # Datetime
    "utc_now",
    "parse_iso_datetime",
    "format_iso_datetime",
    "time_ago",
]

__version__ = "0.1.0"
