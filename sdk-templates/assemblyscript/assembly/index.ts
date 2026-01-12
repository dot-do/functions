/**
 * Functions.do AssemblyScript Template
 *
 * This template provides the foundation for building serverless functions
 * with the Functions.do platform using AssemblyScript compiled to WebAssembly.
 *
 * AssemblyScript is a TypeScript-like language that compiles directly to WebAssembly,
 * offering near-native performance while remaining approachable to TypeScript developers.
 *
 * @module {{functionName}}
 */

// ============================================================================
// Example Functions - Replace with your own implementations
// ============================================================================

/**
 * Simple addition function
 *
 * Demonstrates basic numeric operations that can be called from
 * the Functions.do platform.
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns Sum of a and b
 */
export function add(a: i32, b: i32): i32 {
  return a + b
}

/**
 * Subtract two numbers
 *
 * @param a - First operand (minuend)
 * @param b - Second operand (subtrahend)
 * @returns Difference of a and b
 */
export function subtract(a: i32, b: i32): i32 {
  return a - b
}

/**
 * Multiply two numbers
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns Product of a and b
 */
export function multiply(a: i32, b: i32): i32 {
  return a * b
}

/**
 * Integer division
 *
 * @param a - Dividend
 * @param b - Divisor (must be non-zero)
 * @returns Quotient of a divided by b
 */
export function divide(a: i32, b: i32): i32 {
  if (b === 0) {
    return 0 // Return 0 for division by zero (WASM doesn't have exceptions)
  }
  return a / b
}

/**
 * Identity function - returns the input unchanged
 *
 * Useful for testing WASM instantiation and basic function calls.
 *
 * @param x - Input value
 * @returns Same value as input
 */
export function identity(x: i32): i32 {
  return x
}

/**
 * Get the answer to life, the universe, and everything
 *
 * @returns 42
 */
export function getAnswer(): i32 {
  return 42
}

// ============================================================================
// 64-bit Integer Operations
// ============================================================================

/**
 * Add two 64-bit integers
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns Sum as i64
 */
export function add64(a: i64, b: i64): i64 {
  return a + b
}

/**
 * Multiply two 64-bit integers
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns Product as i64
 */
export function multiply64(a: i64, b: i64): i64 {
  return a * b
}

// ============================================================================
// Floating Point Operations
// ============================================================================

/**
 * Add two 32-bit floating point numbers
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns Sum as f32
 */
export function addFloat(a: f32, b: f32): f32 {
  return a + b
}

/**
 * Add two 64-bit floating point numbers
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns Sum as f64
 */
export function addDouble(a: f64, b: f64): f64 {
  return a + b
}

/**
 * Calculate the hypotenuse of a right triangle
 *
 * Uses the Pythagorean theorem: sqrt(a^2 + b^2)
 *
 * @param a - Length of one leg
 * @param b - Length of other leg
 * @returns Length of hypotenuse
 */
export function hypotenuse(a: f64, b: f64): f64 {
  return Math.sqrt(a * a + b * b)
}

// ============================================================================
// Mathematical Functions
// ============================================================================

/**
 * Compute factorial of a number
 *
 * @param n - Non-negative integer
 * @returns n! (factorial of n)
 */
export function factorial(n: i32): i64 {
  if (n <= 1) {
    return 1
  }
  let result: i64 = 1
  for (let i: i32 = 2; i <= n; i++) {
    result *= i64(i)
  }
  return result
}

/**
 * Calculate Fibonacci number at position n
 *
 * @param n - Position in Fibonacci sequence (0-indexed)
 * @returns Fibonacci number at position n
 */
export function fibonacci(n: i32): i64 {
  if (n <= 1) {
    return i64(n)
  }
  let a: i64 = 0
  let b: i64 = 1
  for (let i: i32 = 2; i <= n; i++) {
    const temp = a + b
    a = b
    b = temp
  }
  return b
}

/**
 * Check if a number is prime
 *
 * @param n - Number to check
 * @returns 1 if prime, 0 if not prime
 */
export function isPrime(n: i32): i32 {
  if (n < 2) return 0
  if (n === 2) return 1
  if (n % 2 === 0) return 0
  for (let i: i32 = 3; i * i <= n; i += 2) {
    if (n % i === 0) return 0
  }
  return 1
}

/**
 * Greatest common divisor using Euclidean algorithm
 *
 * @param a - First number
 * @param b - Second number
 * @returns GCD of a and b
 */
export function gcd(a: i32, b: i32): i32 {
  // Ensure positive values
  if (a < 0) a = -a
  if (b < 0) b = -b

  while (b !== 0) {
    const temp = b
    b = a % b
    a = temp
  }
  return a
}

// ============================================================================
// Memory Management Helpers
// ============================================================================

/**
 * Allocate memory in WASM linear memory
 *
 * Used by the host to allocate space for passing data.
 * This is a simple bump allocator for demonstration.
 *
 * @param size - Number of bytes to allocate
 * @returns Pointer to allocated memory
 */
let heapOffset: usize = 1024 // Start heap after 1KB of static data

export function alloc(size: usize): usize {
  const ptr = heapOffset
  heapOffset += size
  // Align to 8 bytes
  heapOffset = (heapOffset + 7) & ~7
  return ptr
}

/**
 * Free previously allocated memory
 *
 * Note: This simple allocator doesn't actually free memory.
 * In production, use a proper allocator.
 *
 * @param ptr - Pointer to free
 */
export function dealloc(ptr: usize): void {
  // Simple bump allocator doesn't support deallocation
  // This is a no-op placeholder
}

/**
 * Reset the heap to initial state
 *
 * Useful for testing or when you want to reclaim all allocated memory.
 */
export function resetHeap(): void {
  heapOffset = 1024
}
