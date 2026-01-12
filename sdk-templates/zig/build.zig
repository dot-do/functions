const std = @import("std");

/// Functions.do Zig SDK build configuration
///
/// This build file produces a WebAssembly module optimized for
/// the Functions.do serverless platform.
///
/// Usage:
///   zig build              # Build debug WASM
///   zig build -Doptimize=ReleaseSmall  # Build optimized WASM (10-50KB)
///   zig build -Doptimize=ReleaseFast   # Build for speed
///   zig build test         # Run unit tests
pub fn build(b: *std.Build) void {
    // Target: WebAssembly (freestanding, no OS)
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    // Optimization: default to ReleaseSmall for smallest binaries
    const optimize = b.standardOptimizeOption(.{
        .preferred_optimize_mode = .ReleaseSmall,
    });

    // Main library module
    const lib = b.addExecutable(.{
        .name = "functions",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    // WASM-specific settings for minimal binary size
    lib.entry = .disabled; // No _start entry point
    lib.rdynamic = true; // Export all pub functions

    // Strip dead code and debug info in release builds
    if (optimize != .Debug) {
        lib.root_module.strip = true;
    }

    // Stack size: 64KB is sufficient for most functions
    lib.stack_size = 64 * 1024;

    // Install artifact
    b.installArtifact(lib);

    // =========================================================================
    // Unit Tests
    // =========================================================================
    const main_tests = b.addTest(.{
        .root_source_file = b.path("src/main.zig"),
        .target = b.host, // Run tests on host, not WASM
        .optimize = optimize,
    });

    const run_main_tests = b.addRunArtifact(main_tests);

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_main_tests.step);

    // =========================================================================
    // Additional Build Steps
    // =========================================================================

    // Clean step
    const clean_step = b.step("clean", "Remove build artifacts");
    clean_step.dependOn(&b.addRemoveDirTree(b.path("zig-out")).step);
    clean_step.dependOn(&b.addRemoveDirTree(b.path(".zig-cache")).step);

    // Size check step (for optimization verification)
    const size_step = b.step("size", "Show WASM binary size");
    const size_cmd = b.addSystemCommand(&[_][]const u8{
        "sh",
        "-c",
        "wc -c zig-out/bin/functions.wasm | awk '{print $1 \" bytes (\" int($1/1024) \"KB)\"}' 2>/dev/null || echo 'Build first: zig build'",
    });
    size_step.dependOn(&size_cmd.step);
    size_step.dependOn(b.getInstallStep());

    // Deploy step (placeholder for Functions.do CLI integration)
    const deploy_step = b.step("deploy", "Deploy to Functions.do");
    const deploy_cmd = b.addSystemCommand(&[_][]const u8{
        "sh",
        "-c",
        "echo 'Deploying zig-out/bin/functions.wasm...' && func deploy zig-out/bin/functions.wasm 2>/dev/null || echo 'Install Functions.do CLI: npm install -g functions.do'",
    });
    deploy_step.dependOn(&deploy_cmd.step);
    deploy_step.dependOn(b.getInstallStep());
}
