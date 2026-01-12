using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Thin C# stub for Functions.do
///
/// This stub is compiled to WASI/WASM with aggressive trimming to minimize size.
/// Its sole purpose is to:
/// 1. Receive function invocation requests
/// 2. Serialize arguments to JSON
/// 3. Delegate to the shared runtime worker
/// 4. Return the result
///
/// The stub itself contains no business logic - all execution happens in the runtime.
/// </summary>

// Request/Response types with source generation for trimming compatibility
[JsonSerializable(typeof(StubRequest))]
[JsonSerializable(typeof(StubResponse))]
[JsonSerializable(typeof(RuntimeDelegation))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
internal partial class StubJsonContext : JsonSerializerContext { }

/// <summary>
/// Incoming request to the stub
/// </summary>
public record StubRequest(
    string FunctionId,
    string MethodName,
    JsonElement[] Arguments
);

/// <summary>
/// Response from the stub
/// </summary>
public record StubResponse(
    bool Success,
    JsonElement? Result,
    string? Error,
    StubMetrics Metrics
);

/// <summary>
/// Timing metrics for cold start analysis
/// </summary>
public record StubMetrics(
    long StubInitMs,
    long SerializationMs,
    long DelegationMs,
    long TotalMs
);

/// <summary>
/// Data to delegate to the runtime worker
/// </summary>
public record RuntimeDelegation(
    string FunctionId,
    string MethodName,
    string SerializedArguments,
    string StubInstanceId
);

public static class ThinStub
{
    private static readonly string InstanceId = Guid.NewGuid().ToString("N")[..8];
    private static readonly long StartupTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static bool _initialized = false;

    public static void Main(string[] args)
    {
        // Mark initialization complete
        var initTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var initMs = initTime - StartupTime;
        _initialized = true;

        // In WASI mode, we read from stdin and write to stdout
        // This simulates the request/response pattern

        string? input = null;

        // Check if we have arguments (for testing) or read from stdin
        if (args.Length > 0)
        {
            input = string.Join(" ", args);
        }
        else
        {
            // Read from stdin
            using var reader = new StreamReader(Console.OpenStandardInput());
            input = reader.ReadToEnd();
        }

        if (string.IsNullOrWhiteSpace(input))
        {
            // If no input, return stub info
            var info = new
            {
                type = "thin-stub",
                version = "0.1.0",
                instanceId = InstanceId,
                initMs = initMs,
                ready = true
            };
            Console.WriteLine(JsonSerializer.Serialize(info));
            return;
        }

        // Process the request
        var response = ProcessRequest(input, initMs);
        Console.WriteLine(JsonSerializer.Serialize(response, StubJsonContext.Default.StubResponse));
    }

    private static StubResponse ProcessRequest(string input, long initMs)
    {
        var totalStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        try
        {
            // Deserialize the incoming request
            var serializationStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var request = JsonSerializer.Deserialize(input, StubJsonContext.Default.StubRequest);

            if (request is null)
            {
                return new StubResponse(
                    false,
                    null,
                    "Failed to parse request",
                    new StubMetrics(initMs, 0, 0, 0)
                );
            }

            // Serialize arguments for delegation
            var serializedArgs = JsonSerializer.Serialize(request.Arguments);
            var serializationMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - serializationStart;

            // Create delegation payload
            var delegationStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var delegation = new RuntimeDelegation(
                request.FunctionId,
                request.MethodName,
                serializedArgs,
                InstanceId
            );

            // In the actual implementation, this would call out to the runtime worker
            // For the POC, we simulate the delegation by outputting the delegation request
            // The Cloudflare Worker will intercept this and route to the runtime

            // Simulate delegation (in real impl, this calls the runtime via host function)
            var delegationPayload = JsonSerializer.Serialize(delegation, StubJsonContext.Default.RuntimeDelegation);

            // Write delegation marker to stderr for the worker to intercept
            Console.Error.WriteLine($"__DELEGATE__:{delegationPayload}");

            var delegationMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - delegationStart;
            var totalMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - totalStart;

            // Return success with metrics
            // The actual result will be filled in by the runtime
            return new StubResponse(
                true,
                JsonDocument.Parse("null").RootElement,
                null,
                new StubMetrics(initMs, serializationMs, delegationMs, totalMs)
            );
        }
        catch (Exception ex)
        {
            var totalMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - totalStart;
            return new StubResponse(
                false,
                null,
                ex.Message,
                new StubMetrics(initMs, 0, 0, totalMs)
            );
        }
    }
}
