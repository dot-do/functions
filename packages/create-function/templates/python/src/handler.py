from js import Response

async def on_fetch(request, env, ctx):
    """
    Handle incoming HTTP requests.

    Args:
        request: The incoming Request object
        env: Environment bindings (KV, R2, etc.)
        ctx: Execution context for waitUntil, etc.

    Returns:
        A Response object
    """
    return Response.new("Hello World!")
