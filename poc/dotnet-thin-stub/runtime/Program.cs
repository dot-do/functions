using System.Text.Json;
using System.Text.Json.Serialization;
using System.Reflection;
using System.Collections.Concurrent;

/// <summary>
/// Shared Runtime Worker for Functions.do
///
/// This is the "heavy" runtime that contains:
/// - Full .NET runtime capabilities
/// - Function execution engine
/// - Caching and optimization
/// - Dynamic code loading (simulated)
///
/// This runtime is shared across multiple thin stubs, amortizing the cold start
/// cost across many function invocations.
/// </summary>

// JSON serialization context
[JsonSerializable(typeof(RuntimeRequest))]
[JsonSerializable(typeof(RuntimeResponse))]
[JsonSerializable(typeof(FunctionDefinition))]
[JsonSerializable(typeof(JsonElement))]
[JsonSerializable(typeof(JsonElement[]))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
internal partial class RuntimeJsonContext : JsonSerializerContext { }

/// <summary>
/// Request from stub to runtime
/// </summary>
public record RuntimeRequest(
    string FunctionId,
    string MethodName,
    string SerializedArguments,
    string StubInstanceId
);

/// <summary>
/// Response from runtime to stub
/// </summary>
public record RuntimeResponse(
    bool Success,
    JsonElement? Result,
    string? Error,
    RuntimeMetrics Metrics
);

/// <summary>
/// Runtime execution metrics
/// </summary>
public record RuntimeMetrics(
    long DeserializationMs,
    long ExecutionMs,
    long SerializationMs,
    long TotalMs,
    bool CacheHit,
    string RuntimeInstanceId
);

/// <summary>
/// Definition of a function (loaded from registry)
/// </summary>
public record FunctionDefinition(
    string Id,
    string Name,
    string Code,
    Dictionary<string, string> Metadata
);

public static class SharedRuntime
{
    private static readonly string InstanceId = Guid.NewGuid().ToString("N")[..8];
    private static readonly long StartupTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static readonly ConcurrentDictionary<string, CompiledFunction> FunctionCache = new();

    // Simulated function registry
    private static readonly Dictionary<string, FunctionDefinition> FunctionRegistry = new()
    {
        ["add"] = new FunctionDefinition(
            "add",
            "Add Numbers",
            "return args[0] + args[1];",
            new Dictionary<string, string> { ["description"] = "Adds two numbers" }
        ),
        ["multiply"] = new FunctionDefinition(
            "multiply",
            "Multiply Numbers",
            "return args[0] * args[1];",
            new Dictionary<string, string> { ["description"] = "Multiplies two numbers" }
        ),
        ["greet"] = new FunctionDefinition(
            "greet",
            "Greeting",
            "return $\"Hello, {args[0]}!\";",
            new Dictionary<string, string> { ["description"] = "Returns a greeting" }
        ),
        ["fibonacci"] = new FunctionDefinition(
            "fibonacci",
            "Fibonacci",
            @"
                int n = (int)args[0];
                if (n <= 1) return n;
                int a = 0, b = 1;
                for (int i = 2; i <= n; i++) { int c = a + b; a = b; b = c; }
                return b;
            ",
            new Dictionary<string, string> { ["description"] = "Calculates fibonacci number" }
        ),
        ["echo"] = new FunctionDefinition(
            "echo",
            "Echo",
            "return args[0];",
            new Dictionary<string, string> { ["description"] = "Echoes back the input" }
        )
    };

    public static void Main(string[] args)
    {
        var initMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - StartupTime;

        string? input = null;

        if (args.Length > 0)
        {
            input = string.Join(" ", args);
        }
        else
        {
            using var reader = new StreamReader(Console.OpenStandardInput());
            input = reader.ReadToEnd();
        }

        if (string.IsNullOrWhiteSpace(input))
        {
            // Return runtime info
            var info = new
            {
                type = "shared-runtime",
                version = "0.1.0",
                instanceId = InstanceId,
                initMs = initMs,
                registeredFunctions = FunctionRegistry.Keys.ToArray(),
                cachedFunctions = FunctionCache.Count,
                ready = true
            };
            Console.WriteLine(JsonSerializer.Serialize(info));
            return;
        }

        // Process the runtime request
        var response = ProcessRequest(input);
        Console.WriteLine(JsonSerializer.Serialize(response, RuntimeJsonContext.Default.RuntimeResponse));
    }

    private static RuntimeResponse ProcessRequest(string input)
    {
        var totalStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        try
        {
            // Deserialize the request
            var deserStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var request = JsonSerializer.Deserialize(input, RuntimeJsonContext.Default.RuntimeRequest);

            if (request is null)
            {
                return CreateErrorResponse("Failed to parse runtime request", totalStart);
            }

            // Deserialize the arguments
            var arguments = JsonSerializer.Deserialize<JsonElement[]>(request.SerializedArguments)
                ?? Array.Empty<JsonElement>();

            var deserMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - deserStart;

            // Execute the function
            var execStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var (result, cacheHit) = ExecuteFunction(request.FunctionId, request.MethodName, arguments);
            var execMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - execStart;

            // Serialize the result
            var serStart = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var resultJson = JsonSerializer.SerializeToElement(result);
            var serMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - serStart;

            var totalMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - totalStart;

            return new RuntimeResponse(
                true,
                resultJson,
                null,
                new RuntimeMetrics(deserMs, execMs, serMs, totalMs, cacheHit, InstanceId)
            );
        }
        catch (Exception ex)
        {
            return CreateErrorResponse(ex.Message, totalStart);
        }
    }

    private static RuntimeResponse CreateErrorResponse(string error, long startTime)
    {
        var totalMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - startTime;
        return new RuntimeResponse(
            false,
            null,
            error,
            new RuntimeMetrics(0, 0, 0, totalMs, false, InstanceId)
        );
    }

    private static (object? result, bool cacheHit) ExecuteFunction(
        string functionId,
        string methodName,
        JsonElement[] arguments)
    {
        // Check if function exists in registry
        if (!FunctionRegistry.TryGetValue(functionId, out var definition))
        {
            throw new InvalidOperationException($"Function '{functionId}' not found in registry");
        }

        // Check if we have a cached compiled version
        var cacheKey = $"{functionId}:{methodName}";
        var cacheHit = FunctionCache.TryGetValue(cacheKey, out var compiled);

        if (!cacheHit)
        {
            // Compile and cache the function
            compiled = CompileFunction(definition);
            FunctionCache[cacheKey] = compiled;
        }

        // Convert JsonElement arguments to native types
        var nativeArgs = arguments.Select(ConvertJsonElement).ToArray();

        // Execute the compiled function
        var result = compiled!.Execute(nativeArgs);

        return (result, cacheHit);
    }

    private static object? ConvertJsonElement(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number when element.TryGetInt32(out var i) => i,
            JsonValueKind.Number when element.TryGetInt64(out var l) => l,
            JsonValueKind.Number => element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            JsonValueKind.Array => element.EnumerateArray().Select(ConvertJsonElement).ToArray(),
            _ => element.GetRawText()
        };
    }

    private static CompiledFunction CompileFunction(FunctionDefinition definition)
    {
        // In a real implementation, this would use Roslyn to compile C# code
        // For the POC, we use pre-defined implementations

        return definition.Id switch
        {
            "add" => new CompiledFunction(args =>
            {
                var a = Convert.ToDouble(args[0]);
                var b = Convert.ToDouble(args[1]);
                return a + b;
            }),
            "multiply" => new CompiledFunction(args =>
            {
                var a = Convert.ToDouble(args[0]);
                var b = Convert.ToDouble(args[1]);
                return a * b;
            }),
            "greet" => new CompiledFunction(args =>
            {
                return $"Hello, {args[0]}!";
            }),
            "fibonacci" => new CompiledFunction(args =>
            {
                var n = Convert.ToInt32(args[0]);
                if (n <= 1) return n;
                int a = 0, b = 1;
                for (int i = 2; i <= n; i++)
                {
                    var c = a + b;
                    a = b;
                    b = c;
                }
                return b;
            }),
            "echo" => new CompiledFunction(args => args[0]),
            _ => throw new InvalidOperationException($"No implementation for function: {definition.Id}")
        };
    }
}

/// <summary>
/// Represents a compiled function that can be executed
/// </summary>
public class CompiledFunction
{
    private readonly Func<object?[], object?> _implementation;

    public CompiledFunction(Func<object?[], object?> implementation)
    {
        _implementation = implementation;
    }

    public object? Execute(object?[] args)
    {
        return _implementation(args);
    }
}
