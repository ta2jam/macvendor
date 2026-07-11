import { config } from "dotenv";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getAssignment, getDataRelease, lookupMac } from "../../src/db/lookup";
import { createPool } from "../../src/db/pool";
import { normalizeMac, prefixBits } from "../../src/domain/mac";
import { GET as lookupRoute } from "../../src/app/v1/lookup/[mac]/route";
import { sha256 } from "../../src/domain/canonical-json";
import { importSourceRelease } from "../../src/importer/import-source";

config({ path: ".env.local", quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = testUrl;
process.env.RATE_LIMIT_ENABLED = "false";

const pool = createPool(testUrl);

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.end();
  if (globalThis.__macvendorPool) {
    await globalThis.__macvendorPool.end();
    globalThis.__macvendorPool = undefined;
  }
});

describe("database lookup", () => {
  it("returns authoritative and curated layers independently", async () => {
    const result = await lookupMac(pool, normalizeMac("02:AA:BB:CC:00:01"), "all");
    expect(result.assignment).toMatchObject({
      prefix: "02AABB",
      prefixLength: 24,
      organizationName: "Example Networks Lab",
    });
    expect(result.curatedMatches).toHaveLength(1);
    expect(result.curatedMatches[0]).toMatchObject({
      prefix: "02AABBCC",
      prefixLength: 32,
      organizationName: "Example Devices Community",
      conflictStatus: "agrees",
    });
  });

  it("supports official-only mode", async () => {
    const result = await lookupMac(pool, normalizeMac("02AABBCC0001"), "official");
    expect(result.assignment).not.toBeNull();
    expect(result.curatedMatches).toEqual([]);
  });

  it("returns a valid empty lookup without treating it as an error", async () => {
    const result = await lookupMac(pool, normalizeMac("001122334455"), "all");
    expect(result.assignment).toBeNull();
    expect(result.curatedMatches).toEqual([]);
  });

  it("returns exact registry assignment and evidence", async () => {
    const result = await getAssignment(pool, "MA-L", prefixBits(0x02aabb000000n, 24), 24, true);
    expect(result?.assignment.organizationName).toBe("Example Networks Lab");
    expect(result?.evidence).toHaveLength(1);
    expect(result?.evidence?.[0].evidenceId).toMatch(/^ev_/);
  });

  it("exposes the active source snapshot", async () => {
    const release = await getDataRelease(pool);
    expect(release.activeVersion).toBe(1);
    expect(release.sources.map((source) => source.slug)).toEqual(["demo-authoritative", "demo-curated"]);
  });

  it("applies and revokes publication suppression without rebuilding", async () => {
    const target = await pool.query<{ id: string }>("SELECT id FROM resolved_assignments LIMIT 1");
    const suppression = await pool.query<{ id: string }>(
      `INSERT INTO publication_suppressions (
        resolved_assignment_id, reason_code, ticket_reference, created_by,
        starts_at, status
      ) VALUES ($1, 'test', 'TEST-1', 'integration-test', now(), 'active') RETURNING id`,
      [target.rows[0]!.id],
    );
    await pool.query("UPDATE active_resolution SET publication_version = publication_version + 1");

    const hidden = await lookupMac(pool, normalizeMac("02AABBCC0001"), "all");
    expect(hidden.assignment).toBeNull();
    expect(hidden.curatedMatches).toHaveLength(1);

    await pool.query("UPDATE publication_suppressions SET status = 'revoked' WHERE id = $1", [suppression.rows[0]!.id]);
    await pool.query("UPDATE active_resolution SET publication_version = publication_version + 1");
    const restored = await lookupMac(pool, normalizeMac("02AABBCC0001"), "all");
    expect(restored.assignment?.organizationName).toBe("Example Networks Lab");
  });
});

describe("lookup route", () => {
  it("redirects a valid noncanonical MAC", async () => {
    const request = new NextRequest("http://localhost:3000/v1/lookup/02:aa:bb:cc:00:01");
    const response = await lookupRoute(request, { params: Promise.resolve({ mac: "02:aa:bb:cc:00:01" }) });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3000/v1/lookup/02AABBCC0001");
  });

  it("returns problem JSON for malformed input", async () => {
    const request = new NextRequest("http://localhost:3000/v1/lookup/not-a-mac");
    const response = await lookupRoute(request, { params: Promise.resolve({ mac: "not-a-mac" }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body.code).toBe("INVALID_MAC");
  });

  it("supports conditional GET with ETag", async () => {
    const firstRequest = new NextRequest("http://localhost:3000/v1/lookup/02AABBCC0001");
    const first = await lookupRoute(firstRequest, { params: Promise.resolve({ mac: "02AABBCC0001" }) });
    const etag = first.headers.get("etag");
    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();

    const secondRequest = new NextRequest("http://localhost:3000/v1/lookup/02AABBCC0001", {
      headers: { "If-None-Match": etag! },
    });
    const second = await lookupRoute(secondRequest, { params: Promise.resolve({ mac: "02AABBCC0001" }) });
    expect(second.status).toBe(304);
  });
});

describe("source importer", () => {
  it("imports a fully validated release atomically and idempotently", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-import-integration-"));
    try {
      const csv = "prefix,prefixLength,organizationName\n02CCDD,24,Synthetic Import Vendor\n";
      await writeFile(path.join(directory, "records.csv"), csv);
      const manifest = {
        schemaVersion: "macvendor-source/v1",
        source: {
          slug: "synthetic-import-source", name: "Synthetic Import Source",
          class: "authoritative", publishMode: "production", adapterKey: "strict-delimited-v1",
          requiredForActivation: false,
          rights: { status: "approved", basis: "licensed", distributionScope: "api_output", reviewReference: "TEST-RIGHTS-IMPORT" },
        },
        release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1", adapterVersion: "1", normalizerVersion: "1" },
        artifact: { path: "records.csv", format: "csv", sha256: sha256(csv), signatureStatus: "verified" },
        defaults: { recordKind: "assignment", originType: "imported", rightsBasis: "licensed", distributionScope: "api_output", verificationStatus: "single_observation", registry: "MA-L" },
      };
      const manifestPath = path.join(directory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest));

      const first = await importSourceRelease(pool, manifestPath);
      const second = await importSourceRelease(pool, manifestPath);
      expect(first.status).toBe("imported");
      expect(second).toMatchObject({ status: "already_imported", sourceReleaseId: first.sourceReleaseId });
      const counts = await pool.query<{ releases: string; records: string }>(
        `SELECT count(DISTINCT sr.id) AS releases, count(r.id) AS records
         FROM source_releases sr JOIN data_sources ds ON ds.id = sr.source_id
         JOIN source_records r ON r.source_release_id = sr.id
         WHERE ds.slug = 'synthetic-import-source'`,
      );
      expect(counts.rows[0]).toEqual({ releases: "1", records: "1" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not create partial database state for an invalid artifact", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-import-invalid-"));
    try {
      const csv = "prefix,prefixLength,organizationName\n02CCDDE,28,Wrong Registry Length\n";
      await writeFile(path.join(directory, "records.csv"), csv);
      const manifest = {
        schemaVersion: "macvendor-source/v1",
        source: {
          slug: "invalid-import-source", name: "Invalid Import Source",
          class: "authoritative", publishMode: "production", adapterKey: "strict-delimited-v1",
          requiredForActivation: false,
          rights: { status: "approved", basis: "licensed", distributionScope: "api_output", reviewReference: "TEST-RIGHTS-INVALID" },
        },
        release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1", adapterVersion: "1", normalizerVersion: "1" },
        artifact: { path: "records.csv", format: "csv", sha256: sha256(csv), signatureStatus: "verified" },
        defaults: { recordKind: "assignment", originType: "imported", rightsBasis: "licensed", distributionScope: "api_output", verificationStatus: "single_observation", registry: "MA-L" },
      };
      const manifestPath = path.join(directory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(importSourceRelease(pool, manifestPath)).rejects.toMatchObject({ code: "REGISTRY_PREFIX_MISMATCH" });
      const source = await pool.query("SELECT 1 FROM data_sources WHERE slug = 'invalid-import-source'");
      expect(source.rowCount).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
