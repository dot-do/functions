#!/bin/bash
# Test runner with lock to prevent concurrent vitest runs consuming 100GB+ RAM

LOCKFILE="/tmp/functions-do-test.lock"
LOCKFD=200

# Try to acquire lock (non-blocking)
exec 200>"$LOCKFILE"
if ! flock -n $LOCKFD; then
    echo "⚠️  Another test is already running. Waiting for lock..."
    flock $LOCKFD
fi

# Set memory limits for Node.js
export NODE_OPTIONS="--max-old-space-size=4096"

# Run the test command
echo "🧪 Running tests with memory limits..."
"$@"
EXIT_CODE=$?

# Lock is automatically released when script exits
exit $EXIT_CODE
