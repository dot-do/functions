//! Functions.do Zig SDK Template
//!
//! This template provides the foundation for building serverless functions
//! with the Functions.do platform using Zig compiled to WebAssembly.
//!
//! Zig produces extremely efficient WASM binaries (10-50KB typical) with
//! zero runtime overhead, making it ideal for performance-critical functions.
//!
//! ## Usage
//!
//! Define your functions using `export fn`:
//!
//! ```zig
//! export fn my_function(input: i32) i32 {
//!     return input * 2;
//! }
//! ```
//!
//! ## Building
//!
//! ```bash
//! zig build -Doptimize=ReleaseSmall
//! ```
//!
//! ## capnweb Integration
//!
//! Functions.do automatically generates TypeScript bindings and capnweb
//! RPC wrappers from your exported function signatures.

const std = @import("std");

// ============================================================================
// Memory Management for WASM
// ============================================================================

/// Page allocator for WASM linear memory
/// Uses the WASM memory.grow instruction under the hood
var gpa = std.heap.page_allocator;

/// Allocate memory in WASM linear memory
/// Called by the host to allocate space for passing data
export fn alloc(size: usize) ?[*]u8 {
    const slice = gpa.alloc(u8, size) catch return null;
    return slice.ptr;
}

/// Free previously allocated memory
export fn dealloc(ptr: [*]u8, size: usize) void {
    const slice = ptr[0..size];
    gpa.free(slice);
}

// ============================================================================
// capnweb Buffer Implementation
// ============================================================================

/// capnweb-style message buffer for efficient serialization
/// Uses a simple length-prefixed format compatible with Cap'n Proto style
pub const CapnwebBuffer = struct {
    data: std.ArrayList(u8),

    const Self = @This();

    /// Create a new empty buffer
    pub fn init(allocator: std.mem.Allocator) Self {
        return .{
            .data = std.ArrayList(u8).init(allocator),
        };
    }

    /// Create with pre-allocated capacity
    pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !Self {
        var list = std.ArrayList(u8).init(allocator);
        try list.ensureTotalCapacity(capacity);
        return .{ .data = list };
    }

    /// Clean up resources
    pub fn deinit(self: *Self) void {
        self.data.deinit();
    }

    /// Get current buffer length
    pub fn len(self: *const Self) usize {
        return self.data.items.len;
    }

    /// Check if buffer is empty
    pub fn isEmpty(self: *const Self) bool {
        return self.data.items.len == 0;
    }

    /// Write an i32 to the buffer (little-endian)
    pub fn writeI32(self: *Self, value: i32) !void {
        const bytes = std.mem.toBytes(value);
        try self.data.appendSlice(&bytes);
    }

    /// Write an i64 to the buffer (little-endian)
    pub fn writeI64(self: *Self, value: i64) !void {
        const bytes = std.mem.toBytes(value);
        try self.data.appendSlice(&bytes);
    }

    /// Write a string to the buffer (length-prefixed)
    pub fn writeString(self: *Self, value: []const u8) !void {
        try self.writeI32(@intCast(value.len));
        try self.data.appendSlice(value);
    }

    /// Get the buffer as a slice
    pub fn slice(self: *const Self) []const u8 {
        return self.data.items;
    }

    /// Get pointer to data
    pub fn ptr(self: *const Self) [*]const u8 {
        return self.data.items.ptr;
    }

    /// Clear the buffer
    pub fn clear(self: *Self) void {
        self.data.clearRetainingCapacity();
    }
};

/// capnweb reader for deserializing incoming messages
pub const CapnwebReader = struct {
    data: []const u8,
    position: usize,

    const Self = @This();

    /// Create a reader from raw bytes
    pub fn init(data: []const u8) Self {
        return .{
            .data = data,
            .position = 0,
        };
    }

    /// Read an i32 from the buffer
    pub fn readI32(self: *Self) ?i32 {
        if (self.position + 4 > self.data.len) return null;
        const bytes = self.data[self.position..][0..4];
        self.position += 4;
        return std.mem.bytesToValue(i32, bytes);
    }

    /// Read an i64 from the buffer
    pub fn readI64(self: *Self) ?i64 {
        if (self.position + 8 > self.data.len) return null;
        const bytes = self.data[self.position..][0..8];
        self.position += 8;
        return std.mem.bytesToValue(i64, bytes);
    }

    /// Read a length-prefixed string from the buffer
    pub fn readString(self: *Self) ?[]const u8 {
        const length = self.readI32() orelse return null;
        const len: usize = @intCast(length);
        if (self.position + len > self.data.len) return null;
        const str = self.data[self.position .. self.position + len];
        self.position += len;
        return str;
    }

    /// Check if there's more data to read
    pub fn hasMore(self: *const Self) bool {
        return self.position < self.data.len;
    }

    /// Get remaining bytes count
    pub fn remaining(self: *const Self) usize {
        return self.data.len - self.position;
    }
};

// ============================================================================
// Example Functions - Replace with your own
// ============================================================================

/// Simple addition function
///
/// Demonstrates a basic numeric function that can be called from
/// the Functions.do platform.
export fn add(a: i32, b: i32) i32 {
    return a + b;
}

/// Subtract two numbers
export fn subtract(a: i32, b: i32) i32 {
    return a - b;
}

/// Multiply two numbers
export fn multiply(a: i32, b: i32) i32 {
    return a * b;
}

/// Identity function - returns the input unchanged
export fn identity(x: i32) i32 {
    return x;
}

/// Get a constant answer
export fn get_answer() i32 {
    return 42;
}

/// Compute a simple expression: x * 2 + 1
export fn compute(x: i32) i32 {
    return x * 2 + 1;
}

/// Float addition
export fn add_floats(a: f32, b: f32) f32 {
    return a + b;
}

/// Double precision addition
export fn add_doubles(a: f64, b: f64) f64 {
    return a + b;
}

/// 64-bit integer addition
export fn add_i64(a: i64, b: i64) i64 {
    return a + b;
}

/// Boolean identity
export fn bool_identity(x: bool) bool {
    return x;
}

/// Void function (side effect only)
export fn no_op() void {
    // Does nothing, but is a valid export
}

// ============================================================================
// String Handling (Advanced)
// ============================================================================

/// Process a string in WASM memory
/// Takes a pointer and length, returns the processed length
///
/// Example: Calculate string length (echo back the length)
export fn string_length(ptr: [*]const u8, len: usize) usize {
    // In a real implementation, you could process the string here
    _ = ptr;
    return len;
}

/// Copy a string to a new buffer
/// Returns pointer to new buffer (caller must free with dealloc)
export fn string_copy(src_ptr: [*]const u8, len: usize) ?[*]u8 {
    const dst = alloc(len) orelse return null;
    const src = src_ptr[0..len];
    const dst_slice = dst[0..len];
    @memcpy(dst_slice, src);
    return dst;
}

// ============================================================================
// Unit Tests
// ============================================================================

test "add function" {
    try std.testing.expectEqual(@as(i32, 5), add(2, 3));
    try std.testing.expectEqual(@as(i32, 0), add(-1, 1));
    try std.testing.expectEqual(@as(i32, -3), add(-1, -2));
}

test "subtract function" {
    try std.testing.expectEqual(@as(i32, 2), subtract(5, 3));
    try std.testing.expectEqual(@as(i32, -2), subtract(3, 5));
}

test "multiply function" {
    try std.testing.expectEqual(@as(i32, 20), multiply(4, 5));
    try std.testing.expectEqual(@as(i32, -6), multiply(-2, 3));
}

test "identity function" {
    try std.testing.expectEqual(@as(i32, 42), identity(42));
    try std.testing.expectEqual(@as(i32, -1), identity(-1));
}

test "get_answer function" {
    try std.testing.expectEqual(@as(i32, 42), get_answer());
}

test "compute function" {
    try std.testing.expectEqual(@as(i32, 11), compute(5));
    try std.testing.expectEqual(@as(i32, 21), compute(10));
    try std.testing.expectEqual(@as(i32, 1), compute(0));
}

test "CapnwebBuffer basic operations" {
    var buf = CapnwebBuffer.init(std.testing.allocator);
    defer buf.deinit();

    try std.testing.expect(buf.isEmpty());

    try buf.writeI32(42);
    try std.testing.expectEqual(@as(usize, 4), buf.len());

    try buf.writeString("hello");
    try std.testing.expectEqual(@as(usize, 4 + 4 + 5), buf.len());
}

test "CapnwebReader basic operations" {
    var buf = CapnwebBuffer.init(std.testing.allocator);
    defer buf.deinit();

    try buf.writeI32(42);
    try buf.writeString("hello");

    var reader = CapnwebReader.init(buf.slice());
    try std.testing.expectEqual(@as(?i32, 42), reader.readI32());

    const str = reader.readString();
    try std.testing.expect(str != null);
    try std.testing.expectEqualStrings("hello", str.?);

    try std.testing.expect(!reader.hasMore());
}

test "CapnwebBuffer i64 operations" {
    var buf = CapnwebBuffer.init(std.testing.allocator);
    defer buf.deinit();

    try buf.writeI64(9223372036854775807);
    try std.testing.expectEqual(@as(usize, 8), buf.len());

    var reader = CapnwebReader.init(buf.slice());
    try std.testing.expectEqual(@as(?i64, 9223372036854775807), reader.readI64());
}
