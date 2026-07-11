import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSourceGovernanceDecision } from "../../src/operations/source-governance";

const directories: string[] = [];

async function decision(value: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "macvendor-governance-"));
  directories.push(directory);
  const file = path.join(directory, "decision.json");
  await writeFile(file, JSON.stringify(value));
  return file;
}

const valid = () => ({ schemaVersion: "macvendor-governance/v1", sourceSlug: "demo-authoritative",
  decisionReference: "GOV-1001", acceptActivePublicationRisk: false, patch: { name: "Updated source" } });

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("source governance decision", () => {
  it("parses a strict bounded patch", async () => {
    await expect(loadSourceGovernanceDecision(await decision(valid()))).resolves.toMatchObject(valid());
  });

  it("rejects empty, unknown, and unsafe configuration", async () => {
    await expect(loadSourceGovernanceDecision(await decision({ ...valid(), patch: {} })))
      .rejects.toMatchObject({ code: "INVALID_DECISION" });
    await expect(loadSourceGovernanceDecision(await decision({ ...valid(), surprise: true })))
      .rejects.toMatchObject({ code: "INVALID_DECISION" });
    await expect(loadSourceGovernanceDecision(await decision({ ...valid(), patch: { homepageUrl: "http://unsafe.test" } })))
      .rejects.toMatchObject({ code: "INVALID_DECISION" });
  });

  it("requires complete, typed rights decisions", async () => {
    await expect(loadSourceGovernanceDecision(await decision({ ...valid(), patch: { rights: { status: "approved" } } })))
      .rejects.toMatchObject({ code: "INVALID_DECISION" });
  });

  it("normalizes an RFC 3339 rights-review timestamp", async () => {
    const candidate = { ...valid(), patch: { rights: { status: "approved", basis: "licensed",
      distributionScope: "api_output", reviewReference: "RIGHTS-2001", reviewExpiresAt: "2027-01-01T00:00:00Z" } } };
    await expect(loadSourceGovernanceDecision(await decision(candidate))).resolves.toMatchObject({
      patch: { rights: { reviewExpiresAt: "2027-01-01T00:00:00.000Z" } },
    });
  });
});
