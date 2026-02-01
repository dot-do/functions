# Spike: R2 Data Catalog (Apache Iceberg) Integration

**Date:** 2026-02-01
**Status:** Ready for Implementation
**Author:** Engineering Team

## Summary

This spike documents the integration plan for Cloudflare R2 Data Catalog with Apache Iceberg format for analytics and observability data in Functions.do. R2 Data Catalog provides a managed Apache Iceberg catalog that enables SQL-queryable analytics without the overhead of managing external catalog infrastructure.

## Background

### What is R2 Data Catalog?

R2 Data Catalog is a managed Apache Iceberg data catalog built directly into Cloudflare R2 buckets. It was launched in public beta on April 10, 2025, and provides:

- **Standard Iceberg REST Catalog Interface** - Compatible with Spark, Snowflake, PyIceberg, DuckDB, and other query engines
- **ACID Transactions** - Safe concurrent writes with transactional guarantees
- **Schema Evolution** - Modify table schemas without rewriting data
- **Optimized Metadata** - Efficient querying without full table scans
- **Zero Egress Fees** - Cloudflare's signature zero-egress model applies to analytics queries
- **Automatic Compaction** - Managed compaction of small files (up to 2GB/hour per table during beta)
- **Snapshot Expiration** - Automatic cleanup of old table snapshots

### Why Iceberg for Functions.do?

Functions.do generates significant observability data:

1. **Function Invocation Metrics** - Duration, success/failure, cold/warm starts, memory usage
2. **Rate Limiting Events** - Client IPs, function IDs, timestamps
3. **Deployment Events** - Version history, code size changes, rollback events
4. **Error Logs** - Stack traces, error categories, affected functions

Currently, metrics are collected in-memory (`MetricsCollector`) with Prometheus/OpenMetrics export. This works for real-time monitoring but lacks:

- **Historical Analysis** - Query patterns over weeks/months
- **Ad-hoc SQL Queries** - Analyze specific functions or time ranges
- **Data Lake Integration** - Connect with Databricks, Snowflake, or other analytics platforms
- **Cost-Effective Storage** - Iceberg's columnar format is efficient for analytical workloads

## Architecture

### Current State

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Functions.do Worker                         │
│                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────────┐  │
│  │ Function        │    │ MetricsCollector│    │ R2CodeStorage  │  │
│  │ Invocation      │───▶│ (in-memory)     │    │ (code storage) │  │
│  └─────────────────┘    └────────┬────────┘    └────────────────┘  │
│                                  │                                  │
│                                  ▼                                  │
│                         ┌─────────────────┐                        │
│                         │ Prometheus      │                        │
│                         │ /metrics export │                        │
│                         └─────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Proposed State with R2 Data Catalog

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Functions.do Worker                         │
│                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────────────┐  │
│  │ Function        │    │ MetricsCollector│    │ R2CodeStorage  │  │
│  │ Invocation      │───▶│ (in-memory)     │    │ (code storage) │  │
│  └─────────────────┘    └────────┬────────┘    └────────────────┘  │
│                                  │                                  │
│                     ┌────────────┴────────────┐                    │
│                     ▼                         ▼                    │
│         ┌─────────────────┐       ┌─────────────────────┐          │
│         │ Prometheus      │       │ IcebergMetricsSink  │          │
│         │ /metrics export │       │ (batch writer)      │          │
│         └─────────────────┘       └──────────┬──────────┘          │
└──────────────────────────────────────────────│──────────────────────┘
                                               │
                                               ▼
                              ┌────────────────────────────────┐
                              │     R2 Bucket with Catalog     │
                              │                                │
                              │  ┌──────────────────────────┐  │
                              │  │ code/                    │  │  ← Existing
                              │  │   └── {functionId}/...   │  │
                              │  └──────────────────────────┘  │
                              │                                │
                              │  ┌──────────────────────────┐  │
                              │  │ analytics/               │  │  ← New (Iceberg)
                              │  │   ├── invocations/       │  │
                              │  │   ├── rate_limits/       │  │
                              │  │   ├── deployments/       │  │
                              │  │   └── errors/            │  │
                              │  └──────────────────────────┘  │
                              └────────────────────────────────┘
                                               │
                                               ▼
                              ┌────────────────────────────────┐
                              │     External Query Engines     │
                              │                                │
                              │  • Cloudflare R2 SQL           │
                              │  • PyIceberg + DuckDB          │
                              │  • Apache Spark                │
                              │  • Snowflake                   │
                              │  • Databricks                  │
                              └────────────────────────────────┘
```

## Configuration

### Enable R2 Data Catalog on Bucket

```bash
# Enable the catalog (one-time setup)
npx wrangler r2 bucket catalog enable functions-storage

# Enable automatic compaction (recommended)
npx wrangler r2 bucket catalog compaction enable functions-storage \
  --target-size 128 \
  --token <API_TOKEN>

# Enable snapshot expiration (optional, requires Wrangler 4.56.0+)
npx wrangler r2 bucket catalog snapshot-expiration enable functions-storage \
  --token <API_TOKEN> \
  --older-than-days 30 \
  --retain-last 10
```

### Wrangler Configuration

The existing `wrangler.toml` R2 bucket configuration remains unchanged. The Data Catalog is enabled at the bucket level via the Cloudflare dashboard or CLI, not in `wrangler.toml`.

```toml
# Existing R2 bucket binding (no changes needed)
[[r2_buckets]]
binding = "CODE_STORAGE"
bucket_name = "functions-storage"
```

### API Token Permissions

For Iceberg operations, create an API token with:

- **Workers R2 Data Catalog Write** - For creating/managing Iceberg tables
- **Workers R2 Storage Bucket Item Write** - For writing data files

## Iceberg Table Schemas

### Invocations Table

```sql
CREATE TABLE analytics.invocations (
  invocation_id STRING,
  function_id STRING,
  language STRING,
  version STRING,

  -- Timing
  started_at TIMESTAMP,
  duration_ms DOUBLE,

  -- Status
  success BOOLEAN,
  error_type STRING,
  error_message STRING,

  -- Performance
  cold_start BOOLEAN,
  memory_used_bytes BIGINT,

  -- Request context
  client_ip STRING,
  region STRING,
  colo STRING,

  -- Partitioning columns
  date DATE,
  hour INT
)
PARTITIONED BY (date, hour)
```

### Rate Limits Table

```sql
CREATE TABLE analytics.rate_limits (
  event_id STRING,
  function_id STRING,
  client_ip STRING,

  -- Event details
  occurred_at TIMESTAMP,
  limit_type STRING,  -- 'per_ip', 'per_function', 'global'
  limit_value INT,

  -- Context
  region STRING,
  colo STRING,

  -- Partitioning
  date DATE
)
PARTITIONED BY (date)
```

### Deployments Table

```sql
CREATE TABLE analytics.deployments (
  deployment_id STRING,
  function_id STRING,
  version STRING,
  previous_version STRING,

  -- Deployment details
  deployed_at TIMESTAMP,
  deployed_by STRING,

  -- Code metrics
  code_size_bytes BIGINT,
  source_map_size_bytes BIGINT,

  -- Status
  status STRING,  -- 'success', 'failed', 'rolled_back'
  rollback_reason STRING,

  -- Partitioning
  date DATE
)
PARTITIONED BY (date)
```

### Errors Table

```sql
CREATE TABLE analytics.errors (
  error_id STRING,
  invocation_id STRING,
  function_id STRING,

  -- Error details
  occurred_at TIMESTAMP,
  error_type STRING,
  error_message STRING,
  stack_trace STRING,

  -- Context
  language STRING,
  version STRING,

  -- Partitioning
  date DATE
)
PARTITIONED BY (date)
```

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

1. **Enable R2 Data Catalog** on the functions-storage bucket
2. **Create initial table schemas** using PyIceberg or Spark
3. **Implement `IcebergMetricsSink`** class for batching and writing metrics

```typescript
// src/core/iceberg-metrics-sink.ts
export interface IcebergConfig {
  catalogUri: string
  warehouseName: string
  apiToken: string
}

export class IcebergMetricsSink {
  private buffer: InvocationRecord[] = []
  private flushInterval: number = 60000 // 1 minute
  private maxBufferSize: number = 1000

  constructor(
    private bucket: R2Bucket,
    private config: IcebergConfig
  ) {}

  async record(invocation: InvocationRecord): Promise<void> {
    this.buffer.push(invocation)

    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    // Write Parquet file to R2
    const parquetData = this.toParquet(this.buffer)
    const key = this.generateKey()

    await this.bucket.put(key, parquetData)

    // Commit to Iceberg catalog via REST API
    await this.commitToIceberg(key)

    this.buffer = []
  }

  private generateKey(): string {
    const date = new Date()
    const datePart = date.toISOString().split('T')[0]
    const hour = date.getUTCHours().toString().padStart(2, '0')
    const uuid = crypto.randomUUID()

    return `analytics/invocations/date=${datePart}/hour=${hour}/${uuid}.parquet`
  }
}
```

### Phase 2: Query Integration (Week 3-4)

1. **Add R2 SQL integration** for in-platform queries
2. **Create analytics dashboard endpoints**
3. **Document external query engine setup**

### Phase 3: Production Hardening (Week 5-6)

1. **Implement retry logic** for catalog commits
2. **Add monitoring for write failures**
3. **Configure compaction and snapshot policies**
4. **Load testing with production-scale data**

## Query Examples

### Using R2 SQL (Cloudflare's serverless query engine)

```sql
-- Top 10 functions by invocation count (last 7 days)
SELECT
  function_id,
  COUNT(*) as invocations,
  AVG(duration_ms) as avg_duration,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as error_rate
FROM analytics.invocations
WHERE date >= CURRENT_DATE - INTERVAL 7 DAY
GROUP BY function_id
ORDER BY invocations DESC
LIMIT 10;

-- Cold start analysis by language
SELECT
  language,
  AVG(CASE WHEN cold_start THEN duration_ms END) as avg_cold_start_ms,
  AVG(CASE WHEN NOT cold_start THEN duration_ms END) as avg_warm_start_ms,
  SUM(CASE WHEN cold_start THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as cold_start_rate
FROM analytics.invocations
WHERE date >= CURRENT_DATE - INTERVAL 30 DAY
GROUP BY language;

-- Rate limit patterns by hour
SELECT
  date,
  hour,
  COUNT(*) as rate_limit_events,
  COUNT(DISTINCT client_ip) as unique_ips
FROM analytics.rate_limits
WHERE date >= CURRENT_DATE - INTERVAL 7 DAY
GROUP BY date, hour
ORDER BY date, hour;
```

### Using PyIceberg + DuckDB (Local Analysis)

```python
from pyiceberg.catalog import load_catalog
import duckdb

# Connect to R2 Data Catalog
catalog = load_catalog(
    "r2",
    **{
        "uri": "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
        "warehouse": "functions-storage",
        "token": "<API_TOKEN>",
    }
)

# Load invocations table
invocations = catalog.load_table("analytics.invocations")

# Query with DuckDB
con = duckdb.connect()
con.register("invocations", invocations.scan().to_arrow())

result = con.execute("""
    SELECT
        function_id,
        date,
        COUNT(*) as calls,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95
    FROM invocations
    WHERE date >= '2026-01-01'
    GROUP BY function_id, date
""").fetchdf()

print(result)
```

### Using Apache Spark

```python
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("FunctionsAnalytics") \
    .config("spark.sql.catalog.r2", "org.apache.iceberg.spark.SparkCatalog") \
    .config("spark.sql.catalog.r2.type", "rest") \
    .config("spark.sql.catalog.r2.uri", "https://<ACCOUNT_ID>.r2.cloudflarestorage.com") \
    .config("spark.sql.catalog.r2.warehouse", "functions-storage") \
    .config("spark.sql.catalog.r2.token", "<API_TOKEN>") \
    .getOrCreate()

# Query invocations
df = spark.sql("""
    SELECT
        function_id,
        language,
        COUNT(*) as total_invocations,
        AVG(duration_ms) as avg_duration
    FROM r2.analytics.invocations
    WHERE date >= '2026-01-01'
    GROUP BY function_id, language
""")

df.show()
```

## Cost Analysis

### R2 Data Catalog Costs (Public Beta)

During the public beta period, R2 Data Catalog has **no additional charges** beyond standard R2 storage and operations fees.

### R2 Storage Costs

| Operation | Cost |
|-----------|------|
| Storage | $0.015/GB/month |
| Class A (writes) | $4.50/million |
| Class B (reads) | $0.36/million |
| Egress | **$0** |

### Estimated Monthly Costs for Functions.do

Assuming 10M function invocations/month with analytics:

| Component | Estimate |
|-----------|----------|
| Invocation data (~500 bytes each) | 5 GB = $0.08 |
| Write operations | ~10K files = $0.05 |
| Read operations (queries) | ~100K = $0.04 |
| **Total** | **~$0.17/month** |

This is significantly cheaper than alternatives like:
- Snowflake: ~$40/month (storage + compute)
- BigQuery: ~$25/month (storage + queries)
- S3 + Athena: ~$15/month (with egress fees)

## Security Considerations

### Data Classification

Analytics data may contain:
- Client IP addresses (PII)
- Function IDs (potentially sensitive)
- Error messages (may contain sensitive data)

### Recommendations

1. **IP Address Handling**
   - Hash or truncate IPs before storage
   - Use Cloudflare's IP anonymization

2. **Error Message Sanitization**
   - Strip potential secrets from error messages
   - Truncate stack traces to reasonable length

3. **Access Control**
   - Use scoped API tokens for query access
   - Implement row-level security for multi-tenant scenarios

4. **Data Retention**
   - Configure snapshot expiration (30-90 days)
   - Implement table-level retention policies

## Limitations and Considerations

### Current Beta Limitations

1. **Compaction Rate** - Up to 2GB/hour per table during beta
2. **No Direct Worker Write** - Must use REST API for catalog operations
3. **Schema Evolution** - Some operations require table recreation

### Performance Considerations

1. **Write Latency** - Parquet generation adds ~10-50ms overhead
2. **Query Latency** - R2 SQL queries may take 1-10 seconds for large scans
3. **File Size** - Target 100-500 MB Parquet files for optimal query performance

## Alternatives Considered

### 1. Cloudflare Analytics Engine

**Pros:** Native Workers integration, real-time queries
**Cons:** Limited retention (31 days), no SQL interface, limited aggregations

### 2. External Data Warehouse (Snowflake/BigQuery)

**Pros:** Mature ecosystem, advanced features
**Cons:** Egress costs, additional vendor, operational overhead

### 3. ClickHouse on Fly.io

**Pros:** Fast analytical queries, SQL interface
**Cons:** Operational overhead, egress costs, another service to manage

### Decision

R2 Data Catalog with Iceberg was selected because:
- Zero egress fees align with Functions.do's cost model
- Managed service reduces operational burden
- Open Iceberg format prevents vendor lock-in
- Integration with existing R2 infrastructure

## References

- [R2 Data Catalog Documentation](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Data Catalog Beta Announcement](https://developers.cloudflare.com/changelog/2025-04-10-r2-data-catalog-beta/)
- [Cloudflare Data Platform Blog](https://blog.cloudflare.com/cloudflare-data-platform/)
- [R2 Data Catalog Public Beta Blog](https://blog.cloudflare.com/r2-data-catalog-public-beta/)
- [Apache Iceberg Documentation](https://iceberg.apache.org/docs/latest/)
- [PyIceberg Documentation](https://py.iceberg.apache.org/)

## Next Steps

- [x] Research R2 Data Catalog availability and capabilities
- [ ] Enable Data Catalog on functions-storage bucket
- [ ] Create Iceberg table schemas
- [ ] Implement `IcebergMetricsSink` class
- [ ] Add batch writing from `MetricsCollector`
- [ ] Create analytics API endpoints
- [ ] Document external query engine setup
- [ ] Add monitoring for analytics pipeline
- [ ] Load testing with production data volumes
