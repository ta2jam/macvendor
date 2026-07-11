export interface DatabaseIoStats {
  blocksRead: number;
  blocksHit: number;
  tempBytes: number;
  tuplesReturned: number;
  tuplesFetched: number;
}

export interface ExplainPlanSummary {
  planningMs: number;
  executionMs: number;
  actualRows: number;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
  tempReadBlocks: number;
  tempWrittenBlocks: number;
  nodeTypes: string[];
  indexes: string[];
}

export function assertBenchmarkDatabaseUrl(value: string, allowRemote = false): URL {
  const url = new URL(value);
  if (!url.pathname.endsWith("_bench")) {
    throw new Error("BENCHMARK_DATABASE_URL must name a database ending with _bench");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (!allowRemote && !localHosts.has(url.hostname)) {
    throw new Error("remote benchmark databases require BENCHMARK_ALLOW_REMOTE=true");
  }
  return url;
}

export function percentile(sortedValues: number[], fraction: number): number {
  if (!sortedValues.length) throw new Error("percentile requires at least one value");
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error("percentile fraction must be 0..1");
  const rank = Math.ceil(fraction * sortedValues.length) - 1;
  return sortedValues[Math.max(0, rank)]!;
}

export function summarizeLatencies(values: number[], wallMs: number) {
  if (!values.length || wallMs <= 0) throw new Error("latency summary requires samples and positive wall time");
  const sorted = [...values].sort((left, right) => left - right);
  const round = (value: number) => Number(value.toFixed(3));
  return {
    samples: sorted.length,
    minMs: round(sorted[0]!),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1)!),
    meanMs: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    throughputPerSecond: Number(((sorted.length * 1_000) / wallMs).toFixed(2)),
  };
}

export function deltaDatabaseIo(before: DatabaseIoStats, after: DatabaseIoStats): DatabaseIoStats {
  return {
    blocksRead: Math.max(0, after.blocksRead - before.blocksRead),
    blocksHit: Math.max(0, after.blocksHit - before.blocksHit),
    tempBytes: Math.max(0, after.tempBytes - before.tempBytes),
    tuplesReturned: Math.max(0, after.tuplesReturned - before.tuplesReturned),
    tuplesFetched: Math.max(0, after.tuplesFetched - before.tuplesFetched),
  };
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function summarizeExplainPlan(value: unknown): ExplainPlanSummary {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") {
    throw new Error("EXPLAIN result must be a PostgreSQL JSON plan array");
  }
  const document = value[0] as Record<string, unknown>;
  const root = document.Plan as Record<string, unknown> | undefined;
  if (!root) throw new Error("EXPLAIN result has no Plan root");
  const nodeTypes = new Set<string>();
  const indexes = new Set<string>();
  const visit = (node: Record<string, unknown>) => {
    if (typeof node["Node Type"] === "string") nodeTypes.add(node["Node Type"]);
    if (typeof node["Index Name"] === "string") indexes.add(node["Index Name"]);
    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) {
        if (child && typeof child === "object") visit(child as Record<string, unknown>);
      }
    }
  };
  visit(root);
  return {
    planningMs: Number(numberField(document["Planning Time"]).toFixed(3)),
    executionMs: Number(numberField(document["Execution Time"]).toFixed(3)),
    actualRows: numberField(root["Actual Rows"]),
    sharedHitBlocks: numberField(root["Shared Hit Blocks"]),
    sharedReadBlocks: numberField(root["Shared Read Blocks"]),
    tempReadBlocks: numberField(root["Temp Read Blocks"]),
    tempWrittenBlocks: numberField(root["Temp Written Blocks"]),
    nodeTypes: [...nodeTypes].sort(),
    indexes: [...indexes].sort(),
  };
}
