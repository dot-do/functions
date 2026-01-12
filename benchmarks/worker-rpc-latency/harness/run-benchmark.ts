#!/usr/bin/env npx tsx
/**
 * Benchmark Harness for Worker-to-Worker RPC Latency
 *
 * This script runs comprehensive latency benchmarks comparing:
 * - Direct execution (baseline)
 * - Service Binding delegation
 * - Raw HTTP fetch delegation
 *
 * Usage:
 *   npx tsx run-benchmark.ts [--iterations=100] [--output=results.json]
 *
 * Prerequisites:
 *   1. Start runtime worker: cd ../runtime-worker && npm run dev
 *   2. Start caller worker: cd ../caller-worker && npm run dev
 */

interface BenchmarkConfig {
  callerUrl: string;
  methods: ('direct' | 'service-binding' | 'raw-fetch')[];
  functions: string[];
  payloadSizes: number[];
  iterations: number;
  warmupIterations: number;
}

interface BenchmarkStats {
  method: string;
  functionId: string;
  payloadSize: number;
  iterations: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  rawResults: number[];
}

interface BenchmarkReport {
  timestamp: string;
  config: BenchmarkConfig;
  results: BenchmarkStats[];
  summary: {
    directBaseline: { p50: number; p95: number; p99: number };
    serviceBindingOverhead: { p50: number; p95: number; p99: number };
    rawFetchOverhead: { p50: number; p95: number; p99: number };
  };
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  callerUrl: 'http://localhost:8787',
  methods: ['direct', 'service-binding', 'raw-fetch'],
  functions: ['echo', 'transform', 'compute'],
  payloadSizes: [100, 1000, 10000, 100000], // 100B, 1KB, 10KB, 100KB
  iterations: 100,
  warmupIterations: 10,
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSingleBenchmark(
  callerUrl: string,
  method: string,
  functionId: string,
  payloadSize: number,
  iterations: number
): Promise<BenchmarkStats> {
  const url = new URL('/benchmark', callerUrl);
  url.searchParams.set('method', method);
  url.searchParams.set('function', functionId);
  url.searchParams.set('payloadSize', payloadSize.toString());
  url.searchParams.set('iterations', iterations.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Benchmark failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function warmup(config: BenchmarkConfig): Promise<void> {
  console.log('Warming up workers...');

  for (const method of config.methods) {
    try {
      await runSingleBenchmark(
        config.callerUrl,
        method,
        'echo',
        100,
        config.warmupIterations
      );
    } catch (error) {
      console.warn(`Warmup failed for ${method}:`, error);
    }
  }

  console.log('Warmup complete.\n');
}

function formatLatency(ms: number): string {
  return `${ms.toFixed(3)}ms`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1000000) return `${(bytes / 1000000).toFixed(1)}MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(1)}KB`;
  return `${bytes}B`;
}

function calculateOverhead(
  baseline: number,
  measured: number
): { absolute: number; percentage: number } {
  const absolute = measured - baseline;
  const percentage = baseline > 0 ? (absolute / baseline) * 100 : 0;
  return { absolute, percentage };
}

async function runBenchmarks(config: BenchmarkConfig): Promise<BenchmarkReport> {
  const results: BenchmarkStats[] = [];

  console.log('='.repeat(70));
  console.log('Worker-to-Worker RPC Latency Benchmark');
  console.log('='.repeat(70));
  console.log(`\nConfig:`);
  console.log(`  Caller URL: ${config.callerUrl}`);
  console.log(`  Methods: ${config.methods.join(', ')}`);
  console.log(`  Functions: ${config.functions.join(', ')}`);
  console.log(`  Payload sizes: ${config.payloadSizes.map(formatSize).join(', ')}`);
  console.log(`  Iterations: ${config.iterations}`);
  console.log('');

  // Warmup
  await warmup(config);

  // Run benchmarks
  for (const payloadSize of config.payloadSizes) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Payload Size: ${formatSize(payloadSize)}`);
    console.log('='.repeat(70));

    for (const functionId of config.functions) {
      console.log(`\n  Function: ${functionId}`);
      console.log('  ' + '-'.repeat(50));

      const methodResults: Record<string, BenchmarkStats> = {};

      for (const method of config.methods) {
        try {
          process.stdout.write(`    ${method.padEnd(20)}`);

          const stats = await runSingleBenchmark(
            config.callerUrl,
            method,
            functionId,
            payloadSize,
            config.iterations
          );

          results.push(stats);
          methodResults[method] = stats;

          console.log(
            `p50: ${formatLatency(stats.p50).padEnd(10)} ` +
            `p95: ${formatLatency(stats.p95).padEnd(10)} ` +
            `p99: ${formatLatency(stats.p99).padEnd(10)}`
          );

          // Small delay between benchmarks to avoid overwhelming
          await sleep(100);
        } catch (error) {
          console.log(`FAILED: ${error}`);
        }
      }

      // Print overhead analysis
      if (methodResults['direct'] && methodResults['service-binding']) {
        const overhead = calculateOverhead(
          methodResults['direct'].p50,
          methodResults['service-binding'].p50
        );
        console.log(
          `    ${'Service Binding overhead:'.padEnd(20)} ` +
          `+${formatLatency(overhead.absolute)} (${overhead.percentage.toFixed(1)}%)`
        );
      }

      if (methodResults['direct'] && methodResults['raw-fetch']) {
        const overhead = calculateOverhead(
          methodResults['direct'].p50,
          methodResults['raw-fetch'].p50
        );
        console.log(
          `    ${'Raw Fetch overhead:'.padEnd(20)} ` +
          `+${formatLatency(overhead.absolute)} (${overhead.percentage.toFixed(1)}%)`
        );
      }
    }
  }

  // Calculate summary
  const directResults = results.filter(r => r.method === 'direct');
  const sbResults = results.filter(r => r.method === 'service-binding');
  const fetchResults = results.filter(r => r.method === 'raw-fetch');

  const avgDirect = {
    p50: directResults.reduce((sum, r) => sum + r.p50, 0) / directResults.length,
    p95: directResults.reduce((sum, r) => sum + r.p95, 0) / directResults.length,
    p99: directResults.reduce((sum, r) => sum + r.p99, 0) / directResults.length,
  };

  const avgSB = {
    p50: sbResults.reduce((sum, r) => sum + r.p50, 0) / sbResults.length,
    p95: sbResults.reduce((sum, r) => sum + r.p95, 0) / sbResults.length,
    p99: sbResults.reduce((sum, r) => sum + r.p99, 0) / sbResults.length,
  };

  const avgFetch = {
    p50: fetchResults.reduce((sum, r) => sum + r.p50, 0) / fetchResults.length,
    p95: fetchResults.reduce((sum, r) => sum + r.p95, 0) / fetchResults.length,
    p99: fetchResults.reduce((sum, r) => sum + r.p99, 0) / fetchResults.length,
  };

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    config,
    results,
    summary: {
      directBaseline: avgDirect,
      serviceBindingOverhead: {
        p50: avgSB.p50 - avgDirect.p50,
        p95: avgSB.p95 - avgDirect.p95,
        p99: avgSB.p99 - avgDirect.p99,
      },
      rawFetchOverhead: {
        p50: avgFetch.p50 - avgDirect.p50,
        p95: avgFetch.p95 - avgDirect.p95,
        p99: avgFetch.p99 - avgDirect.p99,
      },
    },
  };

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('\nAverage Latencies (across all functions and payload sizes):');
  console.log(
    `  Direct:          p50: ${formatLatency(avgDirect.p50).padEnd(10)} ` +
    `p95: ${formatLatency(avgDirect.p95).padEnd(10)} ` +
    `p99: ${formatLatency(avgDirect.p99)}`
  );
  console.log(
    `  Service Binding: p50: ${formatLatency(avgSB.p50).padEnd(10)} ` +
    `p95: ${formatLatency(avgSB.p95).padEnd(10)} ` +
    `p99: ${formatLatency(avgSB.p99)}`
  );
  console.log(
    `  Raw Fetch:       p50: ${formatLatency(avgFetch.p50).padEnd(10)} ` +
    `p95: ${formatLatency(avgFetch.p95).padEnd(10)} ` +
    `p99: ${formatLatency(avgFetch.p99)}`
  );

  console.log('\nOverhead vs Direct Execution:');
  console.log(
    `  Service Binding: +${formatLatency(report.summary.serviceBindingOverhead.p50)} (p50), ` +
    `+${formatLatency(report.summary.serviceBindingOverhead.p95)} (p95), ` +
    `+${formatLatency(report.summary.serviceBindingOverhead.p99)} (p99)`
  );
  console.log(
    `  Raw Fetch:       +${formatLatency(report.summary.rawFetchOverhead.p50)} (p50), ` +
    `+${formatLatency(report.summary.rawFetchOverhead.p95)} (p95), ` +
    `+${formatLatency(report.summary.rawFetchOverhead.p99)} (p99)`
  );

  return report;
}

// CLI argument parsing
function parseArgs(): { iterations: number; output?: string } {
  const args = process.argv.slice(2);
  let iterations = DEFAULT_CONFIG.iterations;
  let output: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--iterations=')) {
      iterations = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    }
  }

  return { iterations, output };
}

// Main entry point
async function main() {
  const { iterations, output } = parseArgs();

  const config: BenchmarkConfig = {
    ...DEFAULT_CONFIG,
    iterations,
  };

  try {
    // Check if workers are running
    try {
      await fetch(`${config.callerUrl}/health`);
    } catch {
      console.error('Error: Caller worker is not running.');
      console.error('Please start it with: cd ../caller-worker && npm run dev');
      process.exit(1);
    }

    const report = await runBenchmarks(config);

    // Save results if output specified
    if (output) {
      const fs = await import('fs/promises');
      await fs.writeFile(output, JSON.stringify(report, null, 2));
      console.log(`\nResults saved to: ${output}`);
    }

    // Exit with appropriate code
    const avgOverhead = report.summary.serviceBindingOverhead.p50;
    if (avgOverhead > 5) {
      console.log('\n[WARNING] Service Binding overhead exceeds 5ms threshold');
      process.exit(1);
    } else {
      console.log('\n[OK] Service Binding overhead is within acceptable range');
    }
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

main();
