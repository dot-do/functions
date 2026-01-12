/**
 * Benchmark script for comparing cold start times
 *
 * This script runs local benchmarks to simulate the difference between:
 * 1. Thin stub + shared runtime approach
 * 2. Monolithic bundled approach
 *
 * Run with: node benchmark.js
 */

// Simulated file sizes (in KB)
const THIN_STUB_SIZE = 5; // 5 KB - aggressively trimmed .NET WASI
const SHARED_RUNTIME_SIZE = 20 * 1024; // 20 MB - full .NET runtime (loaded once)
const MONOLITHIC_SIZE = 15 * 1024; // 15 MB - full .NET bundled per function

// Simulated load times based on Cloudflare's WASM loading characteristics
// Approximately 0.01ms per KB for WASM loading
const WASM_LOAD_MS_PER_KB = 0.01;

// Network latency for runtime delegation (Durable Object call)
const RUNTIME_CALL_LATENCY_MS = 5;

// Simulated execution time (same for both approaches)
const EXECUTION_TIME_MS = 1;

/**
 * Simulate cold start for thin stub approach
 */
function simulateThinStubColdStart(isRuntimeWarm) {
  const stubLoadTime = THIN_STUB_SIZE * WASM_LOAD_MS_PER_KB;
  const runtimeLoadTime = isRuntimeWarm ? 0 : SHARED_RUNTIME_SIZE * WASM_LOAD_MS_PER_KB;
  const delegationTime = RUNTIME_CALL_LATENCY_MS;
  const executionTime = EXECUTION_TIME_MS;

  return {
    stubLoadMs: stubLoadTime,
    runtimeLoadMs: runtimeLoadTime,
    delegationMs: delegationTime,
    executionMs: executionTime,
    totalMs: stubLoadTime + runtimeLoadTime + delegationTime + executionTime,
  };
}

/**
 * Simulate cold start for monolithic approach
 */
function simulateMonolithicColdStart() {
  const bundleLoadTime = MONOLITHIC_SIZE * WASM_LOAD_MS_PER_KB;
  const executionTime = EXECUTION_TIME_MS;

  return {
    bundleLoadMs: bundleLoadTime,
    executionMs: executionTime,
    totalMs: bundleLoadTime + executionTime,
  };
}

/**
 * Run benchmark scenarios
 */
function runBenchmark() {
  console.log('='.repeat(70));
  console.log('Functions.do Thin Stub vs Monolithic Cold Start Benchmark');
  console.log('='.repeat(70));
  console.log();

  console.log('Configuration:');
  console.log(`  Thin Stub Size:      ${THIN_STUB_SIZE} KB`);
  console.log(`  Shared Runtime Size: ${(SHARED_RUNTIME_SIZE / 1024).toFixed(1)} MB`);
  console.log(`  Monolithic Size:     ${(MONOLITHIC_SIZE / 1024).toFixed(1)} MB`);
  console.log(`  WASM Load Rate:      ${WASM_LOAD_MS_PER_KB} ms/KB`);
  console.log(`  Runtime Call Latency: ${RUNTIME_CALL_LATENCY_MS} ms`);
  console.log();

  // Scenario 1: Single function cold start (runtime not warm)
  console.log('-'.repeat(70));
  console.log('Scenario 1: Single Function Cold Start (Runtime Cold)');
  console.log('-'.repeat(70));

  const thinCold = simulateThinStubColdStart(false);
  const monoCold = simulateMonolithicColdStart();

  console.log();
  console.log('Thin Stub Approach:');
  console.log(`  Stub Load:      ${thinCold.stubLoadMs.toFixed(2)} ms`);
  console.log(`  Runtime Load:   ${thinCold.runtimeLoadMs.toFixed(2)} ms`);
  console.log(`  Delegation:     ${thinCold.delegationMs.toFixed(2)} ms`);
  console.log(`  Execution:      ${thinCold.executionMs.toFixed(2)} ms`);
  console.log(`  TOTAL:          ${thinCold.totalMs.toFixed(2)} ms`);

  console.log();
  console.log('Monolithic Approach:');
  console.log(`  Bundle Load:    ${monoCold.bundleLoadMs.toFixed(2)} ms`);
  console.log(`  Execution:      ${monoCold.executionMs.toFixed(2)} ms`);
  console.log(`  TOTAL:          ${monoCold.totalMs.toFixed(2)} ms`);

  console.log();
  console.log(`Comparison: Monolithic is ${(thinCold.totalMs / monoCold.totalMs).toFixed(2)}x faster`);
  console.log('(When runtime is cold, monolithic wins)');

  // Scenario 2: Single function cold start (runtime warm)
  console.log();
  console.log('-'.repeat(70));
  console.log('Scenario 2: Single Function Cold Start (Runtime Warm)');
  console.log('-'.repeat(70));

  const thinWarm = simulateThinStubColdStart(true);

  console.log();
  console.log('Thin Stub Approach:');
  console.log(`  Stub Load:      ${thinWarm.stubLoadMs.toFixed(2)} ms`);
  console.log(`  Runtime Load:   ${thinWarm.runtimeLoadMs.toFixed(2)} ms (already warm)`);
  console.log(`  Delegation:     ${thinWarm.delegationMs.toFixed(2)} ms`);
  console.log(`  Execution:      ${thinWarm.executionMs.toFixed(2)} ms`);
  console.log(`  TOTAL:          ${thinWarm.totalMs.toFixed(2)} ms`);

  console.log();
  console.log('Monolithic Approach:');
  console.log(`  Bundle Load:    ${monoCold.bundleLoadMs.toFixed(2)} ms`);
  console.log(`  Execution:      ${monoCold.executionMs.toFixed(2)} ms`);
  console.log(`  TOTAL:          ${monoCold.totalMs.toFixed(2)} ms`);

  const improvement = ((monoCold.totalMs - thinWarm.totalMs) / monoCold.totalMs * 100).toFixed(1);
  console.log();
  console.log(`Comparison: Thin stub is ${(monoCold.totalMs / thinWarm.totalMs).toFixed(2)}x faster (${improvement}% improvement)`);
  console.log('(When runtime is warm, thin stub wins significantly!)');

  // Scenario 3: Multiple functions (amortized)
  console.log();
  console.log('-'.repeat(70));
  console.log('Scenario 3: 10 Different Functions (Cold Start Each)');
  console.log('-'.repeat(70));

  const numFunctions = 10;

  // Thin stub: First function loads runtime, rest benefit from warm runtime
  const thinTotalFirstFunc = simulateThinStubColdStart(false).totalMs;
  const thinTotalSubsequent = simulateThinStubColdStart(true).totalMs * (numFunctions - 1);
  const thinTotal = thinTotalFirstFunc + thinTotalSubsequent;

  // Monolithic: Each function loads full bundle
  const monoTotal = simulateMonolithicColdStart().totalMs * numFunctions;

  console.log();
  console.log('Thin Stub Approach:');
  console.log(`  First function:   ${thinTotalFirstFunc.toFixed(2)} ms (loads runtime)`);
  console.log(`  Next 9 functions: ${thinTotalSubsequent.toFixed(2)} ms (runtime warm)`);
  console.log(`  TOTAL:            ${thinTotal.toFixed(2)} ms`);
  console.log(`  Average:          ${(thinTotal / numFunctions).toFixed(2)} ms/function`);

  console.log();
  console.log('Monolithic Approach:');
  console.log(`  Each function:    ${monoCold.totalMs.toFixed(2)} ms`);
  console.log(`  TOTAL:            ${monoTotal.toFixed(2)} ms`);
  console.log(`  Average:          ${(monoTotal / numFunctions).toFixed(2)} ms/function`);

  const multiImprovement = ((monoTotal - thinTotal) / monoTotal * 100).toFixed(1);
  console.log();
  console.log(`Comparison: Thin stub is ${(monoTotal / thinTotal).toFixed(2)}x faster (${multiImprovement}% improvement)`);
  console.log('(Shared runtime really shines with multiple functions!)');

  // Scenario 4: Memory footprint comparison
  console.log();
  console.log('-'.repeat(70));
  console.log('Scenario 4: Memory Footprint (100 Functions Deployed)');
  console.log('-'.repeat(70));

  const numDeployed = 100;

  const thinMemory = (THIN_STUB_SIZE * numDeployed + SHARED_RUNTIME_SIZE) / 1024;
  const monoMemory = (MONOLITHIC_SIZE * numDeployed) / 1024;

  console.log();
  console.log('Thin Stub Approach:');
  console.log(`  100 stubs:        ${(THIN_STUB_SIZE * numDeployed / 1024).toFixed(1)} MB`);
  console.log(`  1 shared runtime: ${(SHARED_RUNTIME_SIZE / 1024).toFixed(1)} MB`);
  console.log(`  TOTAL:            ${thinMemory.toFixed(1)} MB`);

  console.log();
  console.log('Monolithic Approach:');
  console.log(`  100 bundles:      ${monoMemory.toFixed(1)} MB`);
  console.log(`  TOTAL:            ${monoMemory.toFixed(1)} MB`);

  const memoryImprovement = ((monoMemory - thinMemory) / monoMemory * 100).toFixed(1);
  console.log();
  console.log(`Comparison: Thin stub uses ${(monoMemory / thinMemory).toFixed(1)}x less memory (${memoryImprovement}% reduction)`);

  // Summary
  console.log();
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log();
  console.log('Thin Stub Advantages:');
  console.log('  - Much faster cold starts when runtime is warm');
  console.log('  - Dramatically lower memory footprint with many functions');
  console.log('  - Runtime improvements benefit all functions instantly');
  console.log('  - Better resource utilization on edge');
  console.log();
  console.log('Thin Stub Disadvantages:');
  console.log('  - Additional network hop to runtime (5ms overhead)');
  console.log('  - First function invocation loads runtime (~200ms)');
  console.log('  - More complex architecture');
  console.log();
  console.log('Recommendation:');
  console.log('  Use thin stubs when:');
  console.log('    - You have many functions deployed');
  console.log('    - Cold start latency is critical');
  console.log('    - Functions are invoked sporadically');
  console.log('  Use monolithic when:');
  console.log('    - You have few functions');
  console.log('    - Functions are invoked frequently (stays warm)');
  console.log('    - Minimizing architecture complexity is priority');
}

runBenchmark();
