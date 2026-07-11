import { describe, expect, it } from "vitest";
import {
  assertBenchmarkDatabaseUrl,
  deltaDatabaseIo,
  percentile,
  summarizeExplainPlan,
  summarizeLatencies,
} from "../../src/benchmark/metrics";

describe("benchmark database guard", () => {
  it.each([
    "postgresql://localhost/macvendor_bench",
    "postgresql://127.0.0.1:5432/macvendor_bench",
    "postgresql://[::1]/macvendor_bench",
  ])("allows a local isolated benchmark database: %s", (value) => {
    expect(assertBenchmarkDatabaseUrl(value).pathname).toBe("/macvendor_bench");
  });

  it("rejects a database without the benchmark suffix", () => {
    expect(() => assertBenchmarkDatabaseUrl("postgresql://localhost/macvendor_test"))
      .toThrow("ending with _bench");
  });

  it("rejects a remote database unless explicitly allowed", () => {
    const value = "postgresql://database.example/macvendor_bench";
    expect(() => assertBenchmarkDatabaseUrl(value)).toThrow("BENCHMARK_ALLOW_REMOTE=true");
    expect(assertBenchmarkDatabaseUrl(value, true).hostname).toBe("database.example");
  });
});

describe("benchmark summaries", () => {
  it("uses nearest-rank percentiles and reports sequential throughput", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.99)).toBe(4);
    expect(summarizeLatencies([4, 1, 3, 2], 20)).toEqual({
      samples: 4,
      minMs: 1,
      p50Ms: 2,
      p95Ms: 4,
      p99Ms: 4,
      maxMs: 4,
      meanMs: 2.5,
      throughputPerSecond: 200,
    });
  });

  it("never reports negative database counter deltas", () => {
    expect(deltaDatabaseIo(
      { blocksRead: 10, blocksHit: 20, tempBytes: 30, tuplesReturned: 40, tuplesFetched: 50 },
      { blocksRead: 8, blocksHit: 25, tempBytes: 25, tuplesReturned: 50, tuplesFetched: 49 },
    )).toEqual({ blocksRead: 0, blocksHit: 5, tempBytes: 0, tuplesReturned: 10, tuplesFetched: 0 });
  });

  it("extracts nested plan nodes, indexes, timing, and buffer counters", () => {
    expect(summarizeExplainPlan([{
      "Planning Time": 0.1234,
      "Execution Time": 1.2345,
      Plan: {
        "Node Type": "Nested Loop",
        "Actual Rows": 1,
        "Shared Hit Blocks": 12,
        "Shared Read Blocks": 2,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        Plans: [{
          "Node Type": "Index Scan",
          "Index Name": "resolved_assignments_lookup_idx",
        }],
      },
    }])).toEqual({
      planningMs: 0.123,
      executionMs: 1.234,
      actualRows: 1,
      sharedHitBlocks: 12,
      sharedReadBlocks: 2,
      tempReadBlocks: 0,
      tempWrittenBlocks: 0,
      nodeTypes: ["Index Scan", "Nested Loop"],
      indexes: ["resolved_assignments_lookup_idx"],
    });
  });
});
