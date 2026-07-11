import "./env";
import { spawn, execFile as execFileCallback, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { loadBenchmarkDataset, resetBenchmarkDatabase } from "../src/benchmark/dataset";
import {
  assertBenchmarkDatabaseUrl,
  deltaDatabaseIo,
  summarizeExplainPlan,
  summarizeLatencies,
  type DatabaseIoStats,
} from "../src/benchmark/metrics";
import { createPool } from "../src/db/pool";
import { LOOKUP_SQL, lookupMac } from "../src/db/lookup";
import { normalizeMac } from "../src/domain/mac";
import { APP_VERSION } from "../src/lib/version";

const execFile = promisify(execFileCallback);

interface Arguments {
  sizes: number[];
  samples: number;
  warmup: number;
  port: number;
  output?: string;
  markdown?: string;
  label: string;
}

interface Scenario {
  name: "official_hit" | "no_match" | "curated_48_match";
  mac: string;
  mode: "all" | "official";
}

interface ProcessSnapshot {
  cpuMs: number;
  rssBytes: number;
}

interface Measurement {
  layer: "database" | "http";
  scenario: Scenario["name"];
  latency: ReturnType<typeof summarizeLatencies>;
  clientCpuUserMs: number;
  clientCpuSystemMs: number;
  clientPeakRssBytes: number;
  clientFsReadOperations: number;
  clientFsWriteOperations: number;
  serverCpuMs: number | null;
  serverPeakRssBytes: number | null;
  databaseIo: DatabaseIoStats;
  explain?: {
    summary: ReturnType<typeof summarizeExplainPlan>;
    raw: unknown;
  };
}

function usage(): never {
  console.error(`Usage:
  BENCHMARK_DATABASE_URL=postgresql://localhost/macvendor_bench npm run benchmark:lookup -- \\
    [--sizes 1000,10000,100000,250000] [--samples 500] [--warmup 50] \\
    [--port 3300] [--label local] [--output path.json] [--markdown path.md]`);
  process.exit(2);
}

function integer(value: string | undefined, field: string, minimum: number, maximum: number): number {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return candidate;
}

function parseArguments(values: string[]): Arguments {
  const flags = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) usage();
    flags.set(key, value);
  }
  const allowed = new Set(["--sizes", "--samples", "--warmup", "--port", "--output", "--markdown", "--label"]);
  if ([...flags.keys()].some((key) => !allowed.has(key))) usage();
  const sizes = (flags.get("--sizes") ?? "1000,10000,100000,250000")
    .split(",")
    .map((value) => integer(value, "--sizes", 1, 1_000_000));
  if (new Set(sizes).size !== sizes.length || sizes.some((value, index) => index && value <= sizes[index - 1]!)) {
    throw new Error("--sizes must be unique and strictly increasing");
  }
  const label = flags.get("--label") ?? "local";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) throw new Error("--label is invalid");
  return {
    sizes,
    samples: integer(flags.get("--samples") ?? "500", "--samples", 20, 100_000),
    warmup: integer(flags.get("--warmup") ?? "50", "--warmup", 0, 10_000),
    port: integer(flags.get("--port") ?? "3300", "--port", 1024, 65_535),
    output: flags.get("--output"),
    markdown: flags.get("--markdown"),
    label,
  };
}

async function readDatabaseIo(pool: Pool): Promise<DatabaseIoStats> {
  await pool.query("SELECT pg_stat_clear_snapshot()");
  const result = await pool.query<{
    blks_read: string; blks_hit: string; temp_bytes: string;
    tup_returned: string; tup_fetched: string;
  }>(`SELECT blks_read, blks_hit, temp_bytes, tup_returned, tup_fetched
      FROM pg_stat_database WHERE datname = current_database()`);
  const row = result.rows[0];
  if (!row) throw new Error("pg_stat_database row is unavailable");
  return {
    blocksRead: Number(row.blks_read),
    blocksHit: Number(row.blks_hit),
    tempBytes: Number(row.temp_bytes),
    tuplesReturned: Number(row.tup_returned),
    tuplesFetched: Number(row.tup_fetched),
  };
}

function parseCpuTime(value: string): number {
  const dayParts = value.trim().split("-");
  const daySeconds = dayParts.length === 2 ? Number(dayParts[0]) * 86_400 : 0;
  const clock = dayParts.at(-1)!.split(":").map(Number);
  if (clock.some((part) => !Number.isFinite(part))) return 0;
  const seconds = clock.length === 3
    ? clock[0]! * 3_600 + clock[1]! * 60 + clock[2]!
    : clock[0]! * 60 + clock[1]!;
  return (daySeconds + seconds) * 1_000;
}

async function readProcessSnapshot(pid: number): Promise<ProcessSnapshot | null> {
  try {
    const { stdout } = await execFile("ps", ["-o", "rss=,time=", "-p", String(pid)]);
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) return null;
    return { rssBytes: Number(match[1]) * 1_024, cpuMs: parseCpuTime(match[2]!) };
  } catch {
    return null;
  }
}

async function measure(
  pool: Pool,
  layer: Measurement["layer"],
  scenario: Scenario,
  task: () => Promise<void>,
  samples: number,
  warmup: number,
  serverPid?: number,
): Promise<Measurement> {
  for (let index = 0; index < warmup; index += 1) await task();
  const ioBefore = await readDatabaseIo(pool);
  const cpuBefore = process.cpuUsage();
  const resourcesBefore = process.resourceUsage();
  const serverBefore = serverPid ? await readProcessSnapshot(serverPid) : null;
  let clientPeakRssBytes = process.memoryUsage().rss;
  let serverPeakRssBytes = serverBefore?.rssBytes ?? null;
  const sampleMemory = async () => {
    clientPeakRssBytes = Math.max(clientPeakRssBytes, process.memoryUsage().rss);
    if (serverPid) {
      const snapshot = await readProcessSnapshot(serverPid);
      if (snapshot) serverPeakRssBytes = Math.max(serverPeakRssBytes ?? 0, snapshot.rssBytes);
    }
  };
  const memoryTimer = setInterval(() => { void sampleMemory(); }, 20);
  const values: number[] = [];
  const wallStart = performance.now();
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    await task();
    values.push(performance.now() - start);
  }
  const wallMs = performance.now() - wallStart;
  clearInterval(memoryTimer);
  await sampleMemory();
  const cpu = process.cpuUsage(cpuBefore);
  const resourcesAfter = process.resourceUsage();
  const serverAfter = serverPid ? await readProcessSnapshot(serverPid) : null;
  const ioAfter = await readDatabaseIo(pool);
  return {
    layer,
    scenario: scenario.name,
    latency: summarizeLatencies(values, wallMs),
    clientCpuUserMs: Number((cpu.user / 1_000).toFixed(3)),
    clientCpuSystemMs: Number((cpu.system / 1_000).toFixed(3)),
    clientPeakRssBytes,
    clientFsReadOperations: Math.max(0, resourcesAfter.fsRead - resourcesBefore.fsRead),
    clientFsWriteOperations: Math.max(0, resourcesAfter.fsWrite - resourcesBefore.fsWrite),
    serverCpuMs: serverBefore && serverAfter ? Math.max(0, serverAfter.cpuMs - serverBefore.cpuMs) : null,
    serverPeakRssBytes,
    databaseIo: deltaDatabaseIo(ioBefore, ioAfter),
  };
}

async function explain(pool: Pool, scenario: Scenario) {
  const result = await pool.query<{ "QUERY PLAN": unknown }>(
    `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${LOOKUP_SQL}`,
    [BigInt(`0x${scenario.mac}`).toString(), scenario.mode === "official"],
  );
  const raw = result.rows[0]?.["QUERY PLAN"];
  return { summary: summarizeExplainPlan(raw), raw };
}

async function startServer(databaseUrl: string, port: number): Promise<{ process: ChildProcess; logs: () => string }> {
  const child = spawn(process.execPath, ["scripts/start-standalone.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, HOSTNAME: "127.0.0.1", PORT: String(port), RATE_LIMIT_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const capture = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-16_384); };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`benchmark server exited early\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return { process: child, logs: () => output };
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`benchmark server did not become ready\n${output}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function relationSizes(pool: Pool) {
  const database = await pool.query<{ bytes: string }>("SELECT pg_database_size(current_database()) AS bytes");
  const relations = await pool.query<{ relation: string; table_bytes: string; index_bytes: string }>(
    `SELECT relname AS relation, pg_relation_size(oid) AS table_bytes,
       pg_indexes_size(oid) AS index_bytes
     FROM pg_class
     WHERE relname IN ('resolved_assignments', 'resolved_claims', 'source_records')
     ORDER BY relname`,
  );
  return {
    databaseBytes: Number(database.rows[0]!.bytes),
    relations: relations.rows.map((row) => ({ relation: row.relation,
      tableBytes: Number(row.table_bytes), indexBytes: Number(row.index_bytes) })),
  };
}

function markdownReport(report: Record<string, unknown> & { datasets: Array<Record<string, unknown>> }): string {
  const environment = report.environment as Record<string, unknown>;
  const configuration = report.configuration as Record<string, unknown>;
  const mib = (bytes: number | null) => bytes === null ? "—" : (bytes / 1_048_576).toFixed(1);
  const lines = [
    "# Lookup performance baseline",
    "",
    `Generated: ${report.createdAt}`,
    "",
    "> This is a machine-specific baseline, not a production SLO or a hosted-CI latency gate.",
    "",
    "| Context | Value |",
    "|---|---|",
    `| Application | ${report.applicationVersion} |`,
    `| Git commit | \`${String(report.gitCommit).slice(0, 12)}\` (dirty: ${report.gitDirty}) |`,
    `| Host | ${environment.platform} ${environment.arch} ${environment.release} |`,
    `| CPU | ${environment.cpuModel} (${environment.logicalCpuCount} logical) |`,
    `| Memory | ${mib(environment.totalMemoryBytes as number)} MiB |`,
    `| Runtime | Node ${environment.node}; PostgreSQL ${environment.postgres} |`,
    `| Samples | ${configuration.samples} measured + ${configuration.warmup} warmup; concurrency ${configuration.concurrency} |`,
    "",
    "## Latency and query plan",
    "",
    "| Assignments | Claims | Layer | Scenario | p50 ms | p95 ms | p99 ms | req/s | Plan ms | Shared hit/read | Lookup indexes |",
    "|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const dataset of report.datasets) {
    const assignmentCount = dataset.assignmentCount as number;
    const curatedClaimCount = dataset.curatedClaimCount as number;
    for (const measurement of dataset.measurements as Measurement[]) {
      const plan = measurement.explain?.summary;
      const lookupIndexes = plan?.indexes.filter((name) => name.startsWith("resolved_")).join(", ") || "—";
      lines.push(`| ${assignmentCount.toLocaleString("en-US")} | ${curatedClaimCount.toLocaleString("en-US")} | ${measurement.layer} | ${measurement.scenario} | ${measurement.latency.p50Ms} | ${measurement.latency.p95Ms} | ${measurement.latency.p99Ms} | ${measurement.latency.throughputPerSecond} | ${plan?.executionMs ?? "—"} | ${plan ? `${plan.sharedHitBlocks}/${plan.sharedReadBlocks}` : "—"} | ${lookupIndexes} |`);
    }
  }
  lines.push(
    "",
    "## Process and database counters",
    "",
    "| Assignments | Layer | Scenario | Client CPU ms | Client peak MiB | Server CPU ms | Server peak MiB | DB hit/read blocks | Temp bytes |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const dataset of report.datasets) {
    const assignmentCount = dataset.assignmentCount as number;
    for (const measurement of dataset.measurements as Measurement[]) {
      const clientCpu = measurement.clientCpuUserMs + measurement.clientCpuSystemMs;
      lines.push(`| ${assignmentCount.toLocaleString("en-US")} | ${measurement.layer} | ${measurement.scenario} | ${clientCpu.toFixed(3)} | ${mib(measurement.clientPeakRssBytes)} | ${measurement.serverCpuMs ?? "—"} | ${mib(measurement.serverPeakRssBytes)} | ${measurement.databaseIo.blocksHit}/${measurement.databaseIo.blocksRead} | ${measurement.databaseIo.tempBytes} |`);
    }
  }
  lines.push(
    "",
    "## Dataset build and storage",
    "",
    "| Assignments | Claims | Setup ms | Database MiB |",
    "|---:|---:|---:|---:|",
  );
  for (const dataset of report.datasets) {
    const storage = dataset.storage as { databaseBytes: number };
    lines.push(`| ${(dataset.assignmentCount as number).toLocaleString("en-US")} | ${(dataset.curatedClaimCount as number).toLocaleString("en-US")} | ${dataset.setupMs} | ${mib(storage.databaseBytes)} |`);
  }
  lines.push(
    "",
    "## Boundaries",
    "",
    "- Data is deterministic and synthetic; no IEEE or amateur records are used.",
    "- Requests are sequential at concurrency 1 against the origin; CDN latency is excluded.",
    "- Node CPU/RSS and PostgreSQL buffer/temp counters are reported separately; portable PostgreSQL process CPU and energy are not available.",
    "- `EXPLAIN ANALYZE` adds instrumentation overhead and is stored for plan evidence, not latency percentiles.",
    "- Re-run on the target deployment before setting an SLO, capacity, or shared rate limit.",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const databaseUrl = process.env.BENCHMARK_DATABASE_URL;
  if (!databaseUrl) throw new Error("BENCHMARK_DATABASE_URL is required");
  const parsedDatabase = assertBenchmarkDatabaseUrl(databaseUrl, process.env.BENCHMARK_ALLOW_REMOTE === "true");
  const pool = createPool(databaseUrl);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const postgresVersion = (await pool.query<{ server_version: string }>("SHOW server_version")).rows[0]!.server_version;
    const gitCommit = (await execFile("git", ["rev-parse", "HEAD"])).stdout.trim();
    const gitDirty = (await execFile("git", ["status", "--porcelain"])).stdout.trim().length > 0;
    const report = {
      schemaVersion: "macvendor-lookup-benchmark/v1",
      createdAt: new Date().toISOString(),
      label: args.label,
      applicationVersion: APP_VERSION,
      gitCommit,
      gitDirty,
      configuration: { sizes: args.sizes, samples: args.samples, warmup: args.warmup, concurrency: 1, port: args.port },
      environment: {
        platform: os.platform(), arch: os.arch(), release: os.release(),
        cpuModel: os.cpus()[0]?.model ?? "unknown", logicalCpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(), node: process.version, postgres: postgresVersion,
        databaseName: parsedDatabase.pathname.slice(1),
      },
      limitations: [
        "machine-specific synthetic baseline; not a production SLO",
        "sequential concurrency-1 origin traffic; CDN and internet excluded",
        "Node process CPU/RSS measured; PostgreSQL process CPU and energy unavailable portably",
        "pg_stat_database counters are database-wide deltas and may include measurement queries",
      ],
      datasets: [] as Array<Record<string, unknown>>,
    };
    for (const assignmentCount of args.sizes) {
      const setupStarted = performance.now();
      await resetBenchmarkDatabase(pool);
      const scenarioValues = await loadBenchmarkDataset(pool, assignmentCount);
      const setupMs = Number((performance.now() - setupStarted).toFixed(3));
      if (!server) server = await startServer(databaseUrl, args.port);
      const scenarios: Scenario[] = [
        { name: "official_hit", mac: scenarioValues.officialHit, mode: "official" },
        { name: "no_match", mac: scenarioValues.noMatch, mode: "official" },
        { name: "curated_48_match", mac: scenarioValues.curatedWorstCase, mode: "all" },
      ];
      const measurements: Measurement[] = [];
      for (const scenario of scenarios) {
        const normalized = normalizeMac(scenario.mac);
        const direct = await measure(pool, "database", scenario,
          async () => { await lookupMac(pool, normalized, scenario.mode); }, args.samples, args.warmup);
        direct.explain = await explain(pool, scenario);
        measurements.push(direct);
        const pathSuffix = scenario.mode === "official" ? "?mode=official" : "";
        measurements.push(await measure(pool, "http", scenario, async () => {
          const response = await fetch(`http://127.0.0.1:${args.port}/v1/lookup/${scenario.mac}${pathSuffix}`);
          if (!response.ok) throw new Error(`HTTP benchmark received ${response.status}`);
          await response.arrayBuffer();
        }, args.samples, args.warmup, server.process.pid));
      }
      report.datasets.push({ assignmentCount, curatedClaimCount: assignmentCount + 48, setupMs,
        storage: await relationSizes(pool), measurements });
      console.error(`Measured ${assignmentCount.toLocaleString("en-US")} assignments.`);
    }
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) {
      await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
      await writeFile(path.resolve(args.output), json);
    } else {
      process.stdout.write(json);
    }
    if (args.markdown) {
      await mkdir(path.dirname(path.resolve(args.markdown)), { recursive: true });
      await writeFile(path.resolve(args.markdown), markdownReport(report));
    }
  } finally {
    if (server) await stopServer(server.process);
    await pool.end();
  }
}

await main();
