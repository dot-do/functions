# C# Guide

C# functions on Functions.do are compiled to WebAssembly using .NET Native AOT (Ahead-of-Time) compilation. This guide covers .NET setup, WASM compilation, and deploying C# functions.

## What is .NET Native AOT?

.NET Native AOT compiles C# code directly to native WebAssembly, bypassing the traditional JIT compilation. This produces:

- Smaller binary sizes through trimming
- Faster cold starts (no JIT warmup)
- True ahead-of-time compilation
- Self-contained deployments

## Quick Start

Set up a C# function project:

```bash
# Install .NET 8 SDK
# macOS
brew install dotnet@8

# Windows
winget install Microsoft.DotNet.SDK.8

# Verify installation
dotnet --version

# Install WASM workload
dotnet workload install wasm-experimental
```

## Installation

### Prerequisites

1. **.NET 8.0+**: Required for WASM AOT support
2. **wasm-experimental workload**: .NET WASM tooling
3. **Node.js**: For wrangler deployment

```bash
# Install .NET 8 or higher
# Check version (net8.0 required)
dotnet --version

# Install the WASM workload for WebAssembly support
dotnet workload install wasm-experimental
dotnet workload install wasm-tools
```

## Project Configuration

### .csproj Configuration

Configure your C# project for WASM AOT:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <RuntimeIdentifier>browser-wasm</RuntimeIdentifier>
    <OutputType>Exe</OutputType>
    <PublishAot>true</PublishAot>
    <WasmEnableThreads>false</WasmEnableThreads>
    <InvariantGlobalization>true</InvariantGlobalization>
    <TrimMode>link</TrimMode>
    <PublishTrimmed>true</PublishTrimmed>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="DotDo.Functions.Sdk" Version="0.1.0" />
    <PackageReference Include="System.Text.Json" Version="8.0.0" />
  </ItemGroup>
</Project>
```

Key settings:
- `PublishAot`: Enables AOT compilation
- `TrimMode`: Removes unused code for smaller binary size
- `PublishTrimmed`: Enables IL trimming for optimization
- `RuntimeIdentifier`: Targets browser-wasm runtime

### wrangler.toml

Configure wrangler for C# WASM deployment:

```toml
name = "my-csharp-function"
main = "build/worker.mjs"
compatibility_date = "2024-01-01"

[build]
command = "dotnet publish -c Release -o build"

[vars]
ENVIRONMENT = "production"
```

## Code Examples

### Hello World Function

A basic C# function for WASM export:

```csharp
using System;
using System.Runtime.InteropServices.JavaScript;

namespace MyFunction;

// Simple hello world function with JSExport
public partial class Handler
{
    [JSExport]
    public static string HelloWorld()
    {
        return "Hello, World from C#!";
    }

    public static void Main()
    {
        Console.WriteLine("Function initialized");
    }
}
```

### JSON API Handler

Handle JSON requests with System.Text.Json:

```csharp
using System;
using System.Text.Json;
using System.Runtime.InteropServices.JavaScript;
using System.Threading.Tasks;

namespace MyFunction;

public class RequestBody
{
    public string Name { get; set; } = "";
    public int Age { get; set; }
}

public class ResponseBody
{
    public string Message { get; set; } = "";
    public bool IsAdult { get; set; }
    public DateTime Timestamp { get; set; }
}

// JSON API handler with request/response processing
public partial class Handler
{
    [JSExport]
    public static async Task<string> HandleRequest(string requestJson)
    {
        try
        {
            // Parse JSON request
            var request = JsonSerializer.Deserialize<RequestBody>(requestJson);

            if (request == null)
            {
                return JsonSerializer.Serialize(new { error = "Invalid request" });
            }

            // Build response
            var response = new ResponseBody
            {
                Message = $"Hello, {request.Name}!",
                IsAdult = request.Age >= 18,
                Timestamp = DateTime.UtcNow
            };

            return JsonSerializer.Serialize(response);
        }
        catch (JsonException ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
    }

    public static void Main() { }
}
```

### SDK Integration

Integrate with the Functions.do SDK:

```csharp
using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Runtime.InteropServices.JavaScript;
using DotDo.Functions.Sdk;

namespace MyFunction;

// SDK integration with Functions.do
public partial class Handler
{
    private static readonly FunctionsClient Client = new(new ClientOptions
    {
        ApiKey = Environment.GetEnvironmentVariable("API_KEY") ?? "",
        Endpoint = "https://api.functions.do",
        Timeout = TimeSpan.FromSeconds(30)
    });

    [JSExport]
    public static async Task<string> Fetch(string requestJson)
    {
        // Log request received
        await Client.LogAsync(new LogEntry
        {
            Level = LogLevel.Info,
            Message = "Request received"
        });

        // Parse request
        var request = JsonSerializer.Deserialize<Dictionary<string, object>>(requestJson);

        // Invoke another function
        var result = await Client.InvokeAsync("helper-function", request);

        // Log completion
        await Client.LogAsync(new LogEntry
        {
            Level = LogLevel.Info,
            Message = "Request processed"
        });

        return JsonSerializer.Serialize(new { result });
    }

    public static void Main() { }
}
```

### Async Task Handler

Handle async operations with Task:

```csharp
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using System.Runtime.InteropServices.JavaScript;

namespace MyFunction;

// Async handler with Task support
public partial class AsyncHandler
{
    [JSExport]
    public static async Task<string> ProcessDataAsync(string inputJson)
    {
        // Simulate async work
        await Task.Delay(10);

        var data = JsonSerializer.Deserialize<List<int>>(inputJson) ?? new List<int>();

        // Process data asynchronously
        var result = await Task.Run(() =>
        {
            var sum = 0;
            foreach (var num in data)
            {
                sum += num;
            }
            return new
            {
                count = data.Count,
                sum = sum,
                average = data.Count > 0 ? (double)sum / data.Count : 0
            };
        });

        return JsonSerializer.Serialize(result);
    }

    public static void Main() { }
}
```

## Building

### Build Commands

Build your C# project to WASM:

```bash
# Build for development
dotnet build

# Publish for production with AOT
dotnet publish -c Release

# Publish with explicit WASM target
dotnet publish -c Release -r browser-wasm
```

### Binary Size Optimization

Configure trimming for smaller binary size in .csproj:

```xml
<PropertyGroup>
  <!-- Enable aggressive trimming -->
  <TrimMode>link</TrimMode>
  <PublishTrimmed>true</PublishTrimmed>

  <!-- Remove unused assemblies -->
  <TrimmerRemoveSymbols>true</TrimmerRemoveSymbols>

  <!-- Disable features to reduce size -->
  <InvariantGlobalization>true</InvariantGlobalization>
  <UseSystemResourceKeys>true</UseSystemResourceKeys>

  <!-- AOT-specific optimizations -->
  <PublishAot>true</PublishAot>
  <OptimizationPreference>Size</OptimizationPreference>
</PropertyGroup>
```

Typical binary sizes:
- Minimal function: 2-5 MB
- With JSON: 3-6 MB
- With SDK: 4-8 MB

## NuGet Packages

Install required NuGet packages:

```bash
# Add Functions.do SDK
dotnet add package DotDo.Functions.Sdk

# Add JSON support
dotnet add package System.Text.Json
```

### Package References

```xml
<ItemGroup>
  <PackageReference Include="DotDo.Functions.Sdk" Version="0.1.0" />
  <PackageReference Include="System.Text.Json" Version="8.0.0" />
  <PackageReference Include="Microsoft.Extensions.Logging" Version="8.0.0" />
</ItemGroup>
```

## Testing

### Unit Tests

Test your C# functions:

```csharp
using Xunit;
using System.Text.Json;

namespace MyFunction.Tests;

public class HandlerTests
{
    [Fact]
    public void HelloWorld_ReturnsGreeting()
    {
        var result = Handler.HelloWorld();
        Assert.Equal("Hello, World from C#!", result);
    }

    [Fact]
    public async Task HandleRequest_ProcessesValidJson()
    {
        var request = JsonSerializer.Serialize(new { Name = "Alice", Age = 25 });
        var result = await Handler.HandleRequest(request);

        var response = JsonSerializer.Deserialize<ResponseBody>(result);
        Assert.Equal("Hello, Alice!", response?.Message);
        Assert.True(response?.IsAdult);
    }
}
```

### Running Tests

```bash
# Run tests
dotnet test

# Run with coverage
dotnet test --collect:"XPlat Code Coverage"
```

## Deployment

Deploy your C# WASM function to Functions.do:

```bash
# Publish the project
dotnet publish -c Release -o ./build

# Deploy with wrangler
npx wrangler deploy
```

### Deployment Script

```bash
#!/bin/bash
set -e

# Clean previous build
rm -rf ./build

# Publish with AOT
dotnet publish -c Release -o ./build

# Display binary size
ls -lh ./build/*.wasm

# Deploy to Functions.do
npx wrangler deploy

echo "Deployment complete!"
```

## SDK Configuration

The Functions.Do C# SDK provides configuration options:

```csharp
using System;
using System.Threading.Tasks;
using DotDo.Functions.Sdk;

namespace MyFunction;

// SDK configuration and usage example
public class SdkExample
{
    public static async Task ConfigureAndUseSdk()
    {
        // Configure SDK with options
        var client = new FunctionsClient(new ClientOptions
        {
            ApiKey = "your-api-key",
            Endpoint = "https://api.functions.do",
            Timeout = TimeSpan.FromSeconds(30),
            EnableLogging = true
        });

        // SDK methods
        await client.LogAsync(new LogEntry { Message = "Hello" });

        var result = await client.InvokeAsync("function-name", new { data = "value" });

        var metadata = await client.GetMetadataAsync();
    }
}
```

## Troubleshooting

### Common Issues

#### WASM Workload Not Installed

```bash
# Install required workloads
dotnet workload install wasm-experimental
dotnet workload install wasm-tools
```

#### Trimming Warnings

Some code may not be trim-safe. Add preserve attributes:

```csharp
using System.Diagnostics.CodeAnalysis;

// Preserve types from trimming
[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.All)]
public class MyClass
{
    // Properties preserved for serialization
    public string Name { get; set; } = "";
}
```

#### Large Binary Size

Reduce binary size:

1. Enable `PublishTrimmed`
2. Set `TrimMode` to `link`
3. Disable unused features
4. Use `InvariantGlobalization`
5. Minimize NuGet dependencies

```xml
<PropertyGroup>
  <PublishTrimmed>true</PublishTrimmed>
  <TrimMode>link</TrimMode>
  <InvariantGlobalization>true</InvariantGlobalization>
</PropertyGroup>
```

#### JSExport Not Working

Ensure proper attributes and partial class:

```csharp
using System.Runtime.InteropServices.JavaScript;

// Class must be partial for JSExport
public partial class Handler
{
    [JSExport]
    public static string MyMethod() => "Hello";
}
```

#### Async Issues

Ensure Task-based async patterns:

```csharp
using System.Threading.Tasks;
using System.Runtime.InteropServices.JavaScript;

// Use Task for async methods
public partial class AsyncExample
{
    [JSExport]
    public static async Task<string> AsyncMethod()
    {
        await Task.Delay(10);
        return "Done";
    }
}
```

### FAQ

**Q: What .NET version is required?**
A: .NET 8.0 or higher for full WASM AOT support.

**Q: Why is the binary large?**
A: .NET includes runtime code. Use trimming and AOT to reduce size. Typical size is 2-8 MB.

**Q: Can I use any NuGet package?**
A: Most packages work, but some require trim-safe configuration. Packages with native dependencies may not work.

**Q: How does AOT differ from JIT?**
A: AOT compiles ahead of time, producing native WASM. JIT compiles at runtime. AOT has faster cold starts.

**Q: Can I use reflection?**
A: Limited. Reflection requires special handling for trimmed applications. Use source generators when possible.

## Next Steps

- [SDK Reference](/docs/sdk/csharp)
- [.NET WASM Documentation](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools)
- [Examples Repository](https://github.com/dotdo/functions-examples-csharp)
