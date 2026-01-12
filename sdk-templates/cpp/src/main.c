/**
 * Functions.do C SDK Template
 *
 * This is a minimal C module template for the Functions.do serverless platform.
 * Functions are exported to WebAssembly and can be called from JavaScript.
 *
 * Build:
 *   emcc -O3 -s STANDALONE_WASM=1 -o module.wasm main.c
 *
 * Or using CMake:
 *   cmake -DCMAKE_TOOLCHAIN_FILE=../cmake/emscripten.cmake -DCMAKE_BUILD_TYPE=Release ..
 *   make
 */

#include <stdint.h>
#include <stddef.h>

// ============================================================================
// Memory Management (required for string operations)
// ============================================================================

/**
 * Simple bump allocator for WASM memory
 * The host runtime can use this to allocate memory for passing data
 */
static uint8_t heap[65536];  // 64KB heap
static size_t heap_ptr = 0;

/**
 * Allocate memory in WASM linear memory
 * @param size Number of bytes to allocate
 * @return Pointer to allocated memory
 */
void* alloc(size_t size) {
    if (heap_ptr + size > sizeof(heap)) {
        return NULL;  // Out of memory
    }
    void* ptr = &heap[heap_ptr];
    // Align to 8 bytes
    heap_ptr += (size + 7) & ~7;
    return ptr;
}

/**
 * Free previously allocated memory
 * Note: This is a no-op in the bump allocator
 */
void dealloc(void* ptr, size_t size) {
    (void)ptr;
    (void)size;
    // No-op for bump allocator
}

/**
 * Reset the allocator (call between requests)
 */
void reset_heap(void) {
    heap_ptr = 0;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Add two integers
 * @param a First operand
 * @param b Second operand
 * @return Sum of a and b
 */
int add(int a, int b) {
    return a + b;
}

/**
 * Subtract b from a
 * @param a Minuend
 * @param b Subtrahend
 * @return Difference (a - b)
 */
int subtract(int a, int b) {
    return a - b;
}

/**
 * Multiply two integers
 * @param a First operand
 * @param b Second operand
 * @return Product of a and b
 */
int multiply(int a, int b) {
    return a * b;
}

/**
 * Returns the answer to life, the universe, and everything
 * @return 42
 */
int get_answer(void) {
    return 42;
}

// ============================================================================
// Advanced Examples
// ============================================================================

/**
 * Compute factorial
 * @param n Non-negative integer
 * @return n! (factorial of n)
 */
int64_t factorial(int n) {
    if (n <= 1) return 1;
    int64_t result = 1;
    for (int i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

/**
 * Compute nth Fibonacci number
 * @param n Index (0-based)
 * @return nth Fibonacci number
 */
int64_t fibonacci(int n) {
    if (n <= 0) return 0;
    if (n == 1) return 1;

    int64_t a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int64_t tmp = a + b;
        a = b;
        b = tmp;
    }
    return b;
}

/**
 * Sum an array of integers
 * @param arr Pointer to array in WASM linear memory
 * @param len Number of elements
 * @return Sum of all elements
 */
int sum_array(int* arr, int len) {
    int sum = 0;
    for (int i = 0; i < len; i++) {
        sum += arr[i];
    }
    return sum;
}

/**
 * Compute dot product of two vectors
 * @param a First vector
 * @param b Second vector
 * @param len Length of vectors
 * @return Dot product
 */
double dot_product(double* a, double* b, int len) {
    double result = 0.0;
    for (int i = 0; i < len; i++) {
        result += a[i] * b[i];
    }
    return result;
}

/**
 * Simple string length (for demonstration)
 * @param str Null-terminated string pointer
 * @return Length of string
 */
int string_length(const char* str) {
    int len = 0;
    while (str[len] != '\0') {
        len++;
    }
    return len;
}

// ============================================================================
// Native Test Main (when building without Emscripten)
// ============================================================================

#ifdef FUNCTIONS_DO_NATIVE_TEST
#include <stdio.h>
#include <assert.h>

int main(void) {
    printf("Functions.do C Module - Native Test\n");
    printf("===================================\n\n");

    // Test basic operations
    printf("Testing basic operations...\n");
    assert(add(2, 3) == 5);
    assert(add(-1, 1) == 0);
    printf("  add(2, 3) = %d\n", add(2, 3));

    assert(subtract(10, 4) == 6);
    assert(subtract(5, 10) == -5);
    printf("  subtract(10, 4) = %d\n", subtract(10, 4));

    assert(multiply(6, 7) == 42);
    assert(multiply(-3, 4) == -12);
    printf("  multiply(6, 7) = %d\n", multiply(6, 7));

    assert(get_answer() == 42);
    printf("  get_answer() = %d\n", get_answer());

    // Test advanced functions
    printf("\nTesting advanced functions...\n");
    assert(factorial(5) == 120);
    assert(factorial(0) == 1);
    printf("  factorial(5) = %lld\n", (long long)factorial(5));

    assert(fibonacci(10) == 55);
    assert(fibonacci(0) == 0);
    assert(fibonacci(1) == 1);
    printf("  fibonacci(10) = %lld\n", (long long)fibonacci(10));

    // Test array operations
    printf("\nTesting array operations...\n");
    int arr[] = {1, 2, 3, 4, 5};
    assert(sum_array(arr, 5) == 15);
    printf("  sum_array([1,2,3,4,5], 5) = %d\n", sum_array(arr, 5));

    double vec_a[] = {1.0, 2.0, 3.0};
    double vec_b[] = {4.0, 5.0, 6.0};
    double dp = dot_product(vec_a, vec_b, 3);
    assert(dp == 32.0);  // 1*4 + 2*5 + 3*6 = 32
    printf("  dot_product([1,2,3], [4,5,6], 3) = %.1f\n", dp);

    // Test string operations
    printf("\nTesting string operations...\n");
    assert(string_length("hello") == 5);
    assert(string_length("") == 0);
    printf("  string_length(\"hello\") = %d\n", string_length("hello"));

    // Test memory allocation
    printf("\nTesting memory allocation...\n");
    void* ptr1 = alloc(100);
    void* ptr2 = alloc(200);
    assert(ptr1 != NULL);
    assert(ptr2 != NULL);
    assert(ptr1 != ptr2);
    printf("  alloc(100) = %p\n", ptr1);
    printf("  alloc(200) = %p\n", ptr2);

    reset_heap();
    void* ptr3 = alloc(100);
    assert(ptr3 == ptr1);  // After reset, should reuse memory
    printf("  After reset: alloc(100) = %p (reused)\n", ptr3);

    printf("\n===================================\n");
    printf("All tests passed!\n");

    return 0;
}
#endif
