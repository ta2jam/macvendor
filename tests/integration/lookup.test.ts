import { config } from "dotenv";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getAssignment, getDataRelease, lookupMac } from "../../src/db/lookup";
import { createPool } from "../../src/db/pool";
import { normalizeMac, prefixBits } from "../../src/domain/mac";
import { GET as lookupRoute } from "../../src/app/v1/lookup/[mac]/route";
import { GET as assignmentRoute } from "../../src/app/v1/assignments/[registry]/[prefix]/route";
import { GET as dataReleaseRoute } from "../../src/app/v1/data-release/route";
import { GET as healthRoute } from "../../src/app/healthz/route";
import { GET as readinessRoute } from "../../src/app/readyz/route";
import { sha256 } from "../../src/domain/canonical-json";
import { importSourceRelease } from "../../src/importer/import-source";
import { buildResolution } from "../../src/resolver/build";
import { activateResolution } from "../../src/resolver/activation";
import { assertPublicContract } from "../helpers/contracts";
import {
  createSuppression, expireSuppressions, listSuppressions, revokeSuppression,
} from "../../src/operations/suppressions";
import { writeSignedArtifact } from "../helpers/source-fixture";
import { checkSourceGovernance } from "../../src/operations/source-health";
import { IeeeUpdatePostCommitError, updateIeeeSources } from "../../src/operations/ieee-update";
import { IEEE_ADAPTER_KEY, IEEE_DATASETS, IEEE_RA_ORIGIN, IEEE_RIGHTS_REVIEW } from "../../src/sources/ieee";
import type { PreparedIeeeSnapshot } from "../../src/sources/prepare-ieee";
import { migrate } from "../../src/db/migrate";
import { applySourceGovernance, previewSourceGovernance } from "../../src/operations/source-governance";
import { searchOrganizations } from "../../src/db/organizations";
import { POST as correctionRoute } from "../../src/app/v1/corrections/route";

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

describe("organization identity and correction intake", () => {
  it("links reviewed identities only through exact registered names", async () => {
    const release=await pool.query<{id:string}>(`SELECT sr.id FROM source_releases sr
      JOIN data_sources ds ON ds.id=sr.source_id WHERE ds.slug='demo-curated' LIMIT 1`);
    const id=crypto.randomUUID();
    await pool.query(`INSERT INTO source_records(id,source_release_id,record_kind,record_status,prefix_bits,prefix_length,
      organization_name_display,claim_value,origin_type,rights_basis,distribution_scope,verification_status,
      evidence_reference,raw_record_hash,raw_locator)
      VALUES($1,$2,'organization_identity','eligible',NULL,NULL,'Example Networks Legal',
      '{"organizationKey":"test:example","scheme":"test","identifier":"EX-1","aliases":["Example"],"registeredNames":["Example Networks Lab"]}'::jsonb,
      'imported','owner_created','api_output','reviewed','fixture',$3,'identity:1')`,[id,release.rows[0]!.id,sha256(`identity:${id}`)]);
    try {
      const result=await searchOrganizations(pool,"Example",10);
      expect(result.results).toEqual([expect.objectContaining({organizationKey:"test:example",
        assignments:[expect.objectContaining({organizationName:"Example Networks Lab"})]})]);
      await pool.query("UPDATE source_records SET claim_value=jsonb_set(claim_value,'{registeredNames}','[\"Example Networks\"]'::jsonb) WHERE id=$1",[id]);
      const exactOnly=await searchOrganizations(pool,"Example",10);
      expect(exactOnly.results[0]!.assignments).toEqual([]);
    } finally { await pool.query("DELETE FROM source_records WHERE id=$1",[id]); }
  });

  it("accepts correction JSON while storing no plaintext contact", async () => {
    process.env.CORRECTION_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");
    const email="reviewer@example.invalid";
    const response=await correctionRoute(new NextRequest("http://localhost:3000/v1/corrections",{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({category:"incorrect_assignment",
        target:"02AABB/24",requestedChange:"Replace the synthetic assignment after review.",
        evidenceUrl:"https://example.invalid/evidence",contactEmail:email})}));
    expect(response.status).toBe(202);
    const accepted=await response.json() as {reference:string};
    const stored=await pool.query<{contact_ciphertext:unknown}>("SELECT contact_ciphertext FROM correction_requests WHERE reference=$1",[accepted.reference]);
    expect(JSON.stringify(stored.rows[0]!.contact_ciphertext)).not.toContain(email);
  });
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
    expect(result.insights).toEqual([]);
  });

  it("supports official-only mode", async () => {
    const result = await lookupMac(pool, normalizeMac("02AABBCC0001"), "official");
    expect(result.assignment).not.toBeNull();
    expect(result.curatedMatches).toEqual([]);
    expect(result.insights).toEqual([]);
  });

  it("returns protocol and enrichment claims through the separate insights layer", async () => {
    const context = await pool.query<{ run_id: string; release_id: string }>(
      `SELECT ar.resolution_run_id AS run_id, sr.id AS release_id
       FROM active_resolution ar CROSS JOIN LATERAL (
         SELECT sr.id FROM source_releases sr JOIN data_sources ds ON ds.id = sr.source_id
         WHERE ds.slug = 'demo-curated' LIMIT 1
       ) sr WHERE ar.singleton_id = 1`,
    );
    const recordId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO source_records (
        id, source_release_id, record_kind, record_status, prefix_bits, prefix_length,
        claim_value, origin_type, rights_basis, distribution_scope, verification_status,
        evidence_reference, raw_record_hash, raw_locator
      ) VALUES ($1, $2, 'usage_note', 'eligible', $3, 40,
        '{"usage":"Integration protocol"}'::jsonb, 'imported', 'owner_created',
        'api_output', 'reviewed', 'integration', $4, 'insight:test')`,
      [recordId, context.rows[0]!.release_id, prefixBits(0x02aabbcc0000n, 40).toString(), sha256("insight:test")],
    );
    await pool.query(
      `INSERT INTO resolved_claims (
        id, resolution_run_id, claim_type, prefix_bits, prefix_length, claim_value,
        verification_status, origin_type, conflict_status, source_record_id, source_slug, source_release_id
      ) VALUES ($1, $2, 'usage_note', $3, 40, '{"usage":"Integration protocol"}'::jsonb,
        'reviewed', 'imported', 'not_evaluated', $4, 'demo-curated', $5)`,
      [claimId, context.rows[0]!.run_id, prefixBits(0x02aabbcc0000n, 40).toString(), recordId, context.rows[0]!.release_id],
    );
    try {
      const result = await lookupMac(pool, normalizeMac("02AABBCC0001"), "all");
      expect(result.insights).toEqual([expect.objectContaining({
        claimType: "usage_note", prefixLength: 40, details: { usage: "Integration protocol" },
      })]);
    } finally {
      await pool.query("DELETE FROM resolved_claims WHERE id = $1", [claimId]);
      await pool.query("DELETE FROM source_records WHERE id = $1", [recordId]);
    }
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
    expect(release.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "demo-authoritative", sourceClass: "authoritative", recordCount: 1 }),
      expect.objectContaining({ slug: "demo-curated", sourceClass: "owner_curated", recordCount: 1 }),
    ]));
  });

  it("reports configured production source governance from PostgreSQL", async () => {
    const report = await checkSourceGovernance(pool);
    expect(report).toMatchObject({ healthy: true, summary: { sources: 2, failures: 0, warnings: 2 } });
    expect(report.sources.map((source) => source.slug)).toEqual(["demo-authoritative", "demo-curated"]);
    expect(report.sources.every((source) => source.findings[0]?.code === "FRESHNESS_LIMIT_MISSING")).toBe(true);
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

describe("publication suppression operations", () => {
  it("creates and revokes an active-target suppression with cache-version changes", async () => {
    const target = await pool.query<{ id: string }>(
      `SELECT ra.id FROM resolved_assignments ra JOIN active_resolution ar
       ON ar.resolution_run_id = ra.resolution_run_id WHERE ar.singleton_id = 1 LIMIT 1`,
    );
    const beforeRequest = new NextRequest("http://localhost:3000/v1/lookup/02AABBCC0001");
    const beforeResponse = await lookupRoute(beforeRequest, { params: Promise.resolve({ mac: "02AABBCC0001" }) });
    const beforeEtag = beforeResponse.headers.get("etag");
    const beforeVersion = (await beforeResponse.json()).data.publicationVersion as number;

    const created = await createSuppression(pool, {
      target: { assignmentId: target.rows[0]!.id },
      reasonCode: "correction_review",
      ticketReference: "CORR-1001",
      actorId: "operator:integration",
    });
    expect(created).toMatchObject({ status: "created", publicationVersion: beforeVersion + 1 });
    const active = await listSuppressions(pool, "active");
    expect(active.some((row) => row.id === created.suppressionId)).toBe(true);

    const hiddenRequest = new NextRequest("http://localhost:3000/v1/lookup/02AABBCC0001");
    const hiddenResponse = await lookupRoute(hiddenRequest, { params: Promise.resolve({ mac: "02AABBCC0001" }) });
    expect(hiddenResponse.headers.get("etag")).not.toBe(beforeEtag);
    const hiddenBody = await hiddenResponse.json();
    expect(hiddenBody.assignment).toBeNull();
    expect(hiddenBody.data.publicationVersion).toBe(created.publicationVersion);

    const revoked = await revokeSuppression(pool, {
      suppressionId: created.suppressionId,
      ticketReference: "CORR-1001-REVOKE",
      actorId: "operator:integration",
    });
    expect(revoked.publicationVersion).toBe(created.publicationVersion + 1);
    const restored = await lookupMac(pool, normalizeMac("02AABBCC0001"), "all");
    expect(restored.assignment?.organizationName).toBe("Example Networks Lab");
    const audits = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM audit_events WHERE target_id = $1 ORDER BY created_at, event_type",
      [created.suppressionId],
    );
    expect(audits.rows.map((row) => row.event_type).sort()).toEqual(["suppression.created", "suppression.revoked"]);
    await expect(pool.query(
      "UPDATE audit_events SET actor_id = 'tampered' WHERE target_id = $1",
      [created.suppressionId],
    )).rejects.toThrow(/append-only/);
  });

  it("serializes concurrent creates so only one target suppression becomes active", async () => {
    const target = await pool.query<{ id: string }>(
      `SELECT rc.id FROM resolved_claims rc JOIN active_resolution ar
       ON ar.resolution_run_id = rc.resolution_run_id WHERE ar.singleton_id = 1 LIMIT 1`,
    );
    const attempts = await Promise.allSettled([
      createSuppression(pool, {
        target: { claimId: target.rows[0]!.id }, reasonCode: "correction_review",
        ticketReference: "RACE-ONE", actorId: "operator:race-one",
      }),
      createSuppression(pool, {
        target: { claimId: target.rows[0]!.id }, reasonCode: "correction_review",
        ticketReference: "RACE-TWO", actorId: "operator:race-two",
      }),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "ALREADY_SUPPRESSED" });
    const created = (attempts.find((attempt) => attempt.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createSuppression>>>).value;
    await revokeSuppression(pool, {
      suppressionId: created.suppressionId, ticketReference: "RACE-CLEANUP", actorId: "operator:integration",
    });
  });

  it("expires due suppressions once and increments publicationVersion in the same transaction", async () => {
    const now = new Date();
    const created = await createSuppression(pool, {
      target: { prefixBits: 0x02aabbn, prefixLength: 24, surface: "both" },
      reasonCode: "temporary_review",
      ticketReference: "EXPIRY-1001",
      actorId: "operator:integration",
      now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const expired = await expireSuppressions(pool, {
      actorId: "operator:expiry-job",
      now: new Date(now.getTime() + 120_000),
    });
    expect(expired).toMatchObject({ status: "expired", expiredCount: 1, publicationVersion: created.publicationVersion + 1 });
    await expect(expireSuppressions(pool, {
      actorId: "operator:expiry-job", now: new Date(now.getTime() + 180_000),
    })).resolves.toEqual({ status: "no_change", expiredCount: 0, publicationVersion: null });
  });

  it("rejects ambiguous targets and contact-like ticket values", async () => {
    await expect(createSuppression(pool, {
      target: { assignmentId: crypto.randomUUID(), claimId: crypto.randomUUID() } as never,
      reasonCode: "correction_review", ticketReference: "CORR-INVALID", actorId: "operator:integration",
    })).rejects.toMatchObject({ code: "INVALID_TARGET" });
    await expect(createSuppression(pool, {
      target: { assignmentId: crypto.randomUUID() }, reasonCode: "correction_review",
      ticketReference: "person@example.com", actorId: "operator:integration",
    })).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });
});

describe("lookup route", () => {
  it("redirects a valid noncanonical MAC", async () => {
    const request = new NextRequest("http://localhost:3000/v1/lookup/02:aa:bb:cc:00:01");
    const response = await lookupRoute(request, { params: Promise.resolve({ mac: "02:aa:bb:cc:00:01" }) });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3000/v1/lookup/02AABBCC0001");
  });

  it("uses the configured public origin for canonical redirects behind a proxy", async () => {
    const previous = process.env.PUBLIC_ORIGIN;
    process.env.PUBLIC_ORIGIN = "https://macvendor.io";
    try {
      const request = new NextRequest("http://0.0.0.0:3000/v1/lookup/02:aa:bb:cc:00:01");
      const response = await lookupRoute(request, { params: Promise.resolve({ mac: "02:aa:bb:cc:00:01" }) });
      expect(response.headers.get("location")).toBe("https://macvendor.io/v1/lookup/02AABBCC0001");
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_ORIGIN;
      else process.env.PUBLIC_ORIGIN = previous;
    }
  });

  it("returns problem JSON for malformed input", async () => {
    const request = new NextRequest("http://localhost:3000/v1/lookup/not-a-mac");
    const response = await lookupRoute(request, { params: Promise.resolve({ mac: "not-a-mac" }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body.code).toBe("INVALID_MAC");
    assertPublicContract("Problem", body);
  });

  it("supports conditional GET with ETag", async () => {
    const firstRequest = new NextRequest("http://localhost:3000/v1/lookup/02AABBCC0001");
    const first = await lookupRoute(firstRequest, { params: Promise.resolve({ mac: "02AABBCC0001" }) });
    const etag = first.headers.get("etag");
    assertPublicContract("LookupResponse", await first.clone().json());
    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();
    expect(first.headers.get("surrogate-key")).toMatch(/^data-release resolved-release-[0-9a-f-]+$/);

    const secondRequest = new NextRequest("http://localhost:3000/v1/lookup/02AABBCC0001", {
      headers: { "If-None-Match": etag! },
    });
    const second = await lookupRoute(secondRequest, { params: Promise.resolve({ mac: "02AABBCC0001" }) });
    expect(second.status).toBe(304);
  });

  it("matches the exact-assignment and evidence response contract", async () => {
    const request = new NextRequest("http://localhost:3000/v1/assignments/ma-l/02AABB-24?include=evidence");
    const response = await assignmentRoute(request, {
      params: Promise.resolve({ registry: "ma-l", prefix: "02AABB-24" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("surrogate-key")).toBeNull();
    assertPublicContract("AssignmentResponse", await response.json());
  });

  it("matches the active data-release response contract", async () => {
    const request = new NextRequest("http://localhost:3000/v1/data-release");
    const response = await dataReleaseRoute(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("surrogate-key")).toMatch(/^data-release resolved-release-[0-9a-f-]+$/);
    assertPublicContract("DataReleaseResponse", await response.json());
  });
});

describe("operational probes", () => {
  it("reports process health without caching", async () => {
    const response = healthRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("reports readiness only with PostgreSQL and an active resolution", async () => {
    const response = await readinessRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ status: "ready" });
  });
});

describe("source importer", () => {
  it("imports a fully validated release atomically and idempotently", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-import-integration-"));
    try {
      const csv = "prefix,prefixLength,organizationName\n02CCDD,24,Synthetic Import Vendor\n";
      const signature = await writeSignedArtifact(directory, csv);
      const manifest = {
        schemaVersion: "macvendor-source/v1",
        source: {
          slug: "synthetic-import-source", name: "Synthetic Import Source",
          class: "authoritative", publishMode: "production", adapterKey: "strict-delimited-v1",
          requiredForActivation: false,
          rights: { status: "approved", basis: "licensed", distributionScope: "api_output", reviewReference: "TEST-RIGHTS-IMPORT" },
        },
        release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1", adapterVersion: "1", normalizerVersion: "2", diffPolicy: { maxAddedPercent: 25, maxRemovedPercent: 5 } },
        artifact: { path: "records.csv", format: "csv", sha256: sha256(csv), signatureStatus: "verified", signature },
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
      const signature = await writeSignedArtifact(directory, csv);
      const manifest = {
        schemaVersion: "macvendor-source/v1",
        source: {
          slug: "invalid-import-source", name: "Invalid Import Source",
          class: "authoritative", publishMode: "production", adapterKey: "strict-delimited-v1",
          requiredForActivation: false,
          rights: { status: "approved", basis: "licensed", distributionScope: "api_output", reviewReference: "TEST-RIGHTS-INVALID" },
        },
        release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1", adapterVersion: "1", normalizerVersion: "2", diffPolicy: { maxAddedPercent: 25, maxRemovedPercent: 5 } },
        artifact: { path: "records.csv", format: "csv", sha256: sha256(csv), signatureStatus: "verified", signature },
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

  it("rejects a full-snapshot change beyond its configured diff policy", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-import-diff-"));
    try {
      const manifestPath = path.join(directory, "manifest.json");
      const source = {
        slug: "synthetic-diff-source", name: "Synthetic Diff Source",
        class: "authoritative", publishMode: "production", adapterKey: "strict-delimited-v1",
        requiredForActivation: false,
        rights: { status: "approved", basis: "licensed", distributionScope: "api_output", reviewReference: "TEST-RIGHTS-DIFF" },
      };
      const defaults = {
        recordKind: "assignment", originType: "imported", rightsBasis: "licensed",
        distributionScope: "api_output", verificationStatus: "single_observation", registry: "MA-L",
      };
      const firstCsv = "prefix,prefixLength,organizationName\n02DDEE,24,Synthetic First Vendor\n";
      const firstSignature = await writeSignedArtifact(directory, firstCsv);
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: "macvendor-source/v1", source,
        release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1", adapterVersion: "1", normalizerVersion: "2", diffPolicy: { maxAddedPercent: 100, maxRemovedPercent: 0 } },
        artifact: { path: "records.csv", format: "csv", sha256: sha256(firstCsv), signatureStatus: "verified", signature: firstSignature },
        defaults,
      }));
      await expect(importSourceRelease(pool, manifestPath)).resolves.toMatchObject({ status: "imported", recordCount: 1 });

      const secondCsv = "prefix,prefixLength,organizationName\n02DDEF,24,Synthetic Replacement Vendor\n";
      const secondSignature = await writeSignedArtifact(directory, secondCsv);
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: "macvendor-source/v1", source,
        release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1", adapterVersion: "1", normalizerVersion: "2", diffPolicy: { maxAddedPercent: 100, maxRemovedPercent: 0 } },
        artifact: { path: "records.csv", format: "csv", sha256: sha256(secondCsv), signatureStatus: "verified", signature: secondSignature },
        defaults,
      }));
      await expect(importSourceRelease(pool, manifestPath)).rejects.toMatchObject({ code: "RELEASE_DIFF_EXCEEDED" });
      const count = await pool.query<{ releases: string }>(
        `SELECT count(*) AS releases FROM source_releases sr JOIN data_sources ds ON ds.id = sr.source_id
         WHERE ds.slug = 'synthetic-diff-source'`,
      );
      expect(count.rows[0]!.releases).toBe("1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("resolution publication lifecycle", () => {
  it("builds idempotently, activates atomically, and rolls back to the previous run", async () => {
    const original = await pool.query<{ resolution_run_id: string; version: string; publication_version: string }>(
      "SELECT resolution_run_id, version, publication_version FROM active_resolution WHERE singleton_id = 1",
    );
    const releases = await pool.query<{ id: string }>(
      `SELECT sr.id FROM source_releases sr
       JOIN data_sources ds ON ds.id = sr.source_id
       WHERE ds.slug IN ('demo-authoritative', 'demo-curated')
       ORDER BY ds.slug`,
    );
    const options = {
      sourceReleaseIds: releases.rows.map((row) => row.id),
      policyVersion: "v0.0.4-test",
      policyCommitSha: "integration-test-commit",
      containerImageDigest: "sha256:integration-test-image",
      now: new Date("2026-07-11T00:00:00.000Z"),
    };

    const concurrentBuild = await Promise.all([
      buildResolution(pool, options),
      buildResolution(pool, options),
    ]);
    expect(concurrentBuild.map((result) => result.status).sort()).toEqual(["already_built", "validated"]);
    const built = concurrentBuild.find((result) => result.status === "validated")!;
    const duplicate = concurrentBuild.find((result) => result.status === "already_built")!;
    expect(built).toMatchObject({ status: "validated", assignmentCount: 1, claimCount: 1, conflicts: [] });
    expect(duplicate).toMatchObject({
      status: "already_built",
      resolutionRunId: built.resolutionRunId,
      inputManifestHash: built.inputManifestHash,
      outputHash: built.outputHash,
    });

    const concurrentActivation = await Promise.all([
      activateResolution(pool, built.resolutionRunId, { actorId: "integration-test-a" }),
      activateResolution(pool, built.resolutionRunId, { actorId: "integration-test-b" }),
    ]);
    expect(concurrentActivation.map((result) => result.status).sort()).toEqual(["activated", "already_active"]);
    const activated = concurrentActivation.find((result) => result.status === "activated")!;
    expect(activated).toMatchObject({
      status: "activated",
      activeVersion: Number(original.rows[0]!.version) + 1,
      publicationVersion: Number(original.rows[0]!.publication_version) + 1,
    });

    const lookup = await lookupMac(pool, normalizeMac("02AABBCC0001"), "all");
    expect(lookup.assignment?.organizationName).toBe("Example Networks Lab");
    expect(lookup.curatedMatches[0]).toMatchObject({
      organizationName: "Example Devices Community",
      verificationStatus: "single_observation",
      conflictStatus: "conflicts",
    });

    const rolledBack = await activateResolution(pool, original.rows[0]!.resolution_run_id, {
      actorId: "integration-test",
      rollback: true,
    });
    expect(rolledBack).toMatchObject({
      status: "rolled_back",
      resolutionRunId: original.rows[0]!.resolution_run_id,
      activeVersion: activated.activeVersion + 1,
      publicationVersion: activated.publicationVersion + 1,
    });
  });

  it("blocks activation if a source configuration changed after the build", async () => {
    const releases = await pool.query<{ id: string }>(
      `SELECT sr.id FROM source_releases sr
       JOIN data_sources ds ON ds.id = sr.source_id
       WHERE ds.slug IN ('demo-authoritative', 'demo-curated')
       ORDER BY ds.slug`,
    );
    const built = await buildResolution(pool, {
      sourceReleaseIds: releases.rows.map((row) => row.id),
      policyVersion: "v0.0.4-config-test",
      policyCommitSha: "integration-config-change",
      containerImageDigest: "sha256:integration-test-image",
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
    await pool.query("UPDATE data_sources SET config_version = config_version + 1 WHERE slug = 'demo-authoritative'");
    try {
      await expect(activateResolution(pool, built.resolutionRunId, { actorId: "integration-test" }))
        .rejects.toMatchObject({ code: "SOURCE_CONFIG_CHANGED" });
    } finally {
      await pool.query("UPDATE data_sources SET config_version = config_version - 1 WHERE slug = 'demo-authoritative'");
    }
  });
});

async function writePreparedIeeeSnapshot(directory: string, preparedAt: string): Promise<PreparedIeeeSnapshot> {
  const prefixes = { "MA-L": "001122", "MA-M": "AABBCCD", "MA-S": "DDEEFF001",
    IAB: "123456789", CID: "ABCDEF" } as const;
  const datasets = [];
  for (const dataset of IEEE_DATASETS) {
    const csv = [
      "Registry,Assignment,Organization Name,Organization Address",
      `${dataset.registry},${prefixes[dataset.registry]},Integration ${dataset.registry} Vendor,Integration Address`,
      "",
    ].join("\n");
    const signature = await writeSignedArtifact(directory, csv, dataset.file);
    const manifest = {
      schemaVersion: "macvendor-source/v1",
      source: {
        slug: dataset.slug, name: dataset.name, class: "authoritative", publishMode: "production",
        adapterKey: IEEE_ADAPTER_KEY, fetchPolicy: "scheduled", fetchIntervalSeconds: 86_400,
        maxAcceptableAgeSeconds: 172_800, requiredForActivation: dataset.requiredForActivation,
        rights: { status: "approved", basis: "public_domain_claim", distributionScope: "api_output",
          reviewReference: IEEE_RIGHTS_REVIEW, reviewExpiresAt: "2027-07-11T00:00:00.000Z" },
      },
      release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1",
        adapterVersion: "1", normalizerVersion: "2", diffPolicy: { maxAddedPercent: 10, maxRemovedPercent: 2 } },
      artifact: { path: dataset.file, format: "csv", sha256: sha256(csv), signatureStatus: "verified",
        signature: { ...signature, origin: "operator" },
        remote: { url: dataset.url, allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0 } },
      defaults: { recordKind: "assignment", originType: "imported", rightsBasis: "public_domain_claim",
        distributionScope: "api_output", verificationStatus: "single_observation", registry: dataset.registry },
    };
    const manifestPath = path.join(directory, `${dataset.slug}.manifest.json`);
    await writeFile(manifestPath, JSON.stringify(manifest));
    datasets.push({ registry: dataset.registry, manifestPath, contentHash: sha256(csv), records: 1,
      bytes: Buffer.byteLength(csv), adapterWarnings: [], finalOrigin: IEEE_RA_ORIGIN, sourceUrl: dataset.url });
  }
  return { status: "prepared", preparedAt, output: directory, datasets };
}

describe("guarded IEEE update", () => {
  it("publishes once, observes unchanged snapshots, and rejects overlapping runs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-ieee-update-"));
    const secondPreparedAt = new Date().toISOString();
    const firstPreparedAt = new Date(Date.parse(secondPreparedAt) - 60_000).toISOString();
    try {
      const prepared = await writePreparedIeeeSnapshot(directory, firstPreparedAt);
      const purgeCalls: string[][] = [];
      const purge = async (keys: string[]) => {
        purgeCalls.push(keys);
        return { status: "purged" as const, surrogateKeys: [...keys].sort() };
      };
      const common = {
        policyVersion: "v0.0.13-test", policyCommitSha: "integration-ieee-update",
        containerImageDigest: "sha256:integration-ieee-update", actorId: "operator:integration",
        purge,
      };
      const first = await updateIeeeSources(pool, { ...common, prepare: async () => prepared });
      expect(first).toMatchObject({ status: "updated", build: { status: "validated", assignmentCount: 6 },
        activation: { status: "activated" }, observations: { recorded: 5, activeRecorded: 0, observedAt: firstPreparedAt },
        cachePurge: { observation: { status: "skipped", reason: "no_active_change" },
          activation: { status: "purged" } } });
      const firstReleaseResponse = await dataReleaseRoute(new NextRequest("http://localhost:3000/v1/data-release"));
      const firstEtag = firstReleaseResponse.headers.get("etag");
      const firstReleaseBody = await firstReleaseResponse.json();
      expect(firstReleaseBody.sources.filter((source: { slug: string }) => source.slug.startsWith("ieee-"))
        .every((source: { observedAt: string }) => source.observedAt === firstPreparedAt)).toBe(true);

      const second = await updateIeeeSources(pool, { ...common,
        prepare: async () => ({ ...prepared, preparedAt: secondPreparedAt }) });
      expect(second).toMatchObject({ status: "updated", build: { status: "already_built" },
        activation: { status: "already_active" },
        observations: { recorded: 5, activeRecorded: 5, observedAt: secondPreparedAt },
        cachePurge: { observation: { status: "purged", surrogateKeys: ["data-release"] },
          activation: { status: "skipped", reason: "no_change" } } });
      if (first.status !== "updated" || second.status !== "updated") throw new Error("unexpected update status");
      expect(second.activation.activeVersion).toBe(first.activation.activeVersion);
      expect(purgeCalls[1]).toEqual(["data-release"]);
      const secondReleaseResponse = await dataReleaseRoute(new NextRequest("http://localhost:3000/v1/data-release"));
      expect(secondReleaseResponse.headers.get("etag")).not.toBe(firstEtag);
      const secondReleaseBody = await secondReleaseResponse.json();
      expect(secondReleaseBody.sources.filter((source: { slug: string }) => source.slug.startsWith("ieee-"))
        .every((source: { observedAt: string }) => source.observedAt === secondPreparedAt)).toBe(true);

      const exactRerun = await updateIeeeSources(pool, { ...common,
        prepare: async () => ({ ...prepared, preparedAt: secondPreparedAt }) });
      expect(exactRerun).toMatchObject({ observations: { recorded: 0, activeRecorded: 0 },
        activation: { status: "already_active" }, cachePurge: {
          observation: { status: "skipped", reason: "no_change" },
          activation: { status: "skipped", reason: "no_change" },
        } });
      expect(purgeCalls).toHaveLength(2);

      const counts = await pool.query<{ releases: string; observations: string }>(
        `SELECT count(DISTINCT sr.id) AS releases, count(sfo.id) AS observations
         FROM data_sources ds JOIN source_releases sr ON sr.source_id = ds.id
         LEFT JOIN source_fetch_observations sfo ON sfo.source_release_id = sr.id
         WHERE ds.slug = ANY($1::text[])`,
        [IEEE_DATASETS.map((dataset) => dataset.slug)],
      );
      expect(counts.rows[0]).toEqual({ releases: "5", observations: "10" });
      await expect(pool.query("UPDATE source_fetch_observations SET actor_id = 'tampered'"))
        .rejects.toThrow(/append-only/);
      const health = await checkSourceGovernance(pool, { now: new Date(secondPreparedAt) });
      expect(health.healthy).toBe(true);
      expect(health.sources.filter((source) => source.slug.startsWith("ieee-"))
        .every((source) => source.monitoredFetchedAt === secondPreparedAt)).toBe(true);

      const lock = await pool.connect();
      try {
        await lock.query("SELECT pg_advisory_lock($1)", [6_104_227_006]);
        await expect(updateIeeeSources(pool, { ...common, prepare: async () => prepared }))
          .resolves.toEqual({ status: "already_running" });
      } finally {
        await lock.query("SELECT pg_advisory_unlock($1)", [6_104_227_006]);
        lock.release();
      }

      const observationFailureAt = new Date(Date.parse(secondPreparedAt) + 60_000).toISOString();
      let observationPurgeError: unknown;
      try {
        await updateIeeeSources(pool, { ...common, prepare: async () => ({ ...prepared, preparedAt: observationFailureAt }),
          purge: async () => { throw new Error("injected observation purge failure"); } });
      } catch (error) {
        observationPurgeError = error;
      }
      expect(observationPurgeError).toBeInstanceOf(IeeeUpdatePostCommitError);
      expect(observationPurgeError).toMatchObject({ phase: "cache_purge", committed: true, activation: null });

      const versionBeforeFailure = second.activation.activeVersion;
      let postCommitError: unknown;
      try {
        await updateIeeeSources(pool, { ...common, policyCommitSha: "integration-ieee-postcommit",
          prepare: async () => ({ ...prepared, preparedAt: secondPreparedAt }),
          purge: async () => { throw new Error("injected purge failure"); } });
      } catch (error) {
        postCommitError = error;
      }
      expect(postCommitError).toBeInstanceOf(IeeeUpdatePostCommitError);
      expect(postCommitError).toMatchObject({ phase: "cache_purge", committed: true,
        activation: { status: "activated", activeVersion: versionBeforeFailure + 1 } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the active pointer unchanged when preparation fails validation", async () => {
    const before = await pool.query<{ resolution_run_id: string; version: string }>(
      "SELECT resolution_run_id, version FROM active_resolution WHERE singleton_id = 1",
    );
    await expect(updateIeeeSources(pool, {
      policyVersion: "v0.0.13-test", policyCommitSha: "integration-ieee-invalid",
      containerImageDigest: "sha256:integration-ieee-invalid", actorId: "operator:integration",
      prepare: async () => ({ status: "prepared", preparedAt: new Date().toISOString(), output: "fixture", datasets: [] }),
    })).rejects.toThrow(/exactly 5/);
    await expect(pool.query<{ resolution_run_id: string; version: string }>(
      "SELECT resolution_run_id, version FROM active_resolution WHERE singleton_id = 1",
    )).resolves.toMatchObject({ rows: before.rows });
  });
});

describe("migration history integrity", () => {
  it("backfills legacy checksums and rejects applied-file drift and missing history", async () => {
    await pool.query("ALTER TABLE schema_migrations ALTER COLUMN checksum DROP NOT NULL");
    await pool.query("UPDATE schema_migrations SET checksum = NULL WHERE name = '0007_source_fetch_observations.sql'");
    await migrate(pool);
    const repaired = await pool.query<{ checksum: string; nullable: string }>(
      `SELECT sm.checksum, c.is_nullable AS nullable
       FROM schema_migrations sm
       JOIN information_schema.columns c ON c.table_schema = 'public'
         AND c.table_name = 'schema_migrations' AND c.column_name = 'checksum'
       WHERE sm.name = '0007_source_fetch_observations.sql'`,
    );
    expect(repaired.rows[0]).toMatchObject({ checksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), nullable: "NO" });

    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-migration-drift-"));
    try {
      await cp(path.resolve("migrations"), directory, { recursive: true });
      const name = "0007_source_fetch_observations.sql";
      const tampered = `${await readFile(path.join(directory, name), "utf8")}-- tampered\n`;
      await writeFile(path.join(directory, name), tampered);
      const ledgerPath = path.join(directory, "checksums.json");
      const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as { files: Record<string, string> };
      ledger.files[name] = sha256(tampered);
      await writeFile(ledgerPath, JSON.stringify({ schemaVersion: "macvendor-migrations/v1", files: ledger.files }));
      await expect(migrate(pool, directory)).rejects.toMatchObject({ code: "APPLIED_MIGRATION_DRIFT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    await pool.query(
      "INSERT INTO schema_migrations (name, checksum) VALUES ('9999_missing.sql', $1)",
      [`sha256:${"0".repeat(64)}`],
    );
    try {
      await expect(migrate(pool)).rejects.toMatchObject({ code: "APPLIED_MIGRATION_MISSING" });
    } finally {
      await pool.query("DELETE FROM schema_migrations WHERE name = '9999_missing.sql'");
    }
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM schema_migrations");
    await migrate(pool);
    const after = await pool.query<{ count: string }>("SELECT count(*) FROM schema_migrations");
    expect(after.rows).toEqual(before.rows);
  });
});

describe("source governance mutation", () => {
  it("previews, audits, versions, and idempotently applies an inactive-source change", async () => {
    await importSourceRelease(pool, path.resolve("examples/sources/synthetic-import/manifest.json"));
    const decision = { schemaVersion: "macvendor-governance/v1" as const,
      sourceSlug: "synthetic-import-example", decisionReference: "GOV-INTEGRATION-1",
      acceptActivePublicationRisk: false, patch: { name: "Synthetic Import Governed" } };
    await expect(previewSourceGovernance(pool, decision)).resolves.toMatchObject({
      status: "preview", activeInput: false, activePublicationRisk: false, changedFields: ["name"],
    });
    const updated = await applySourceGovernance(pool, decision, "operator:integration");
    expect(updated).toMatchObject({ status: "updated", configVersion: 2, changedFields: ["name"] });
    await expect(applySourceGovernance(pool, decision, "operator:integration"))
      .resolves.toMatchObject({ status: "no_change", configVersion: 2 });
    const audit = await pool.query<{ metadata: { decisionReference: string; changedFields: string[] } }>(
      "SELECT metadata FROM audit_events WHERE event_type='source.governance_updated' AND target_id=(SELECT id::text FROM data_sources WHERE slug=$1)",
      [decision.sourceSlug],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.metadata).toMatchObject({ decisionReference: "GOV-INTEGRATION-1", changedFields: ["name"] });
  });

  it("requires explicit acceptance before weakening an active source and invalidates pending builds", async () => {
    const releases = await pool.query<{ id: string }>(
      `SELECT sr.id FROM active_resolution ar JOIN resolution_inputs ri ON ri.resolution_run_id=ar.resolution_run_id
       JOIN source_releases sr ON sr.id=ri.source_release_id JOIN data_sources ds ON ds.id=sr.source_id
       WHERE ar.singleton_id=1 ORDER BY ds.slug`,
    );
    const built = await buildResolution(pool, { sourceReleaseIds: releases.rows.map((row) => row.id),
      policyVersion: "v0.0.16-governance-test", policyCommitSha: "governance-pending-build",
      containerImageDigest: "sha256:governance-test", now: new Date() });
    const disable = { schemaVersion: "macvendor-governance/v1" as const, sourceSlug: "ieee-ma-l",
      decisionReference: "GOV-INTEGRATION-RISK", acceptActivePublicationRisk: false,
      patch: { publishMode: "disabled" as const, requiredForActivation: false } };
    await expect(applySourceGovernance(pool, disable, "operator:integration"))
      .rejects.toMatchObject({ code: "ACTIVE_PUBLICATION_RISK" });
    const accepted = { ...disable, acceptActivePublicationRisk: true };
    await expect(applySourceGovernance(pool, accepted, "operator:integration"))
      .resolves.toMatchObject({ status: "updated", activeInput: true, activePublicationRisk: true });
    const disabledHealth = await checkSourceGovernance(pool);
    expect(disabledHealth.sources.find((source) => source.slug === "ieee-ma-l")?.findings.map((item) => item.code))
      .toEqual(expect.arrayContaining(["ACTIVE_SOURCE_NOT_PRODUCTION", "ACTIVE_CONFIG_CHANGED"]));
    await expect(activateResolution(pool, built.resolutionRunId, { actorId: "operator:integration" }))
      .rejects.toMatchObject({ code: "SOURCE_CONFIG_CHANGED" });
    await expect(applySourceGovernance(pool, { ...disable, decisionReference: "GOV-INTEGRATION-RESTORE",
      patch: { publishMode: "production" as const, requiredForActivation: true } }, "operator:integration"))
      .resolves.toMatchObject({ status: "updated", activePublicationRisk: false });
    const driftedRelease = await getDataRelease(pool);
    expect(driftedRelease.sources.find((source) => source.slug === "ieee-ma-l")).toMatchObject({
      configChangedSinceBuild: true,
    });
    const restoredHealth = await checkSourceGovernance(pool);
    expect(restoredHealth.healthy).toBe(true);
    expect(restoredHealth.sources.find((source) => source.slug === "ieee-ma-l")).toMatchObject({
      activeConfigChanged: true,
      findings: [expect.objectContaining({ code: "ACTIVE_CONFIG_CHANGED", severity: "warning" })],
    });

    const rebuilt = await buildResolution(pool, {
      sourceReleaseIds: releases.rows.map((row) => row.id),
      policyVersion: "v0.0.17-config-drift-test",
      policyCommitSha: "governance-config-drift-rebuild",
      containerImageDigest: "sha256:governance-config-drift-test",
      now: new Date(),
    });
    await activateResolution(pool, rebuilt.resolutionRunId, { actorId: "operator:integration" });
    expect((await checkSourceGovernance(pool)).sources.find((source) => source.slug === "ieee-ma-l"))
      .toMatchObject({ activeConfigChanged: false, currentConfigVersion: 3, activeConfigVersion: 3 });
    expect((await getDataRelease(pool)).sources.find((source) => source.slug === "ieee-ma-l"))
      .toMatchObject({ configVersion: 3, configVersionAtBuild: 3, configChangedSinceBuild: false });
  });
});
