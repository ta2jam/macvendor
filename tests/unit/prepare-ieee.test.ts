import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadManifest } from "../../src/importer/manifest";
import { IEEE_DATASETS, IEEE_RA_ORIGIN } from "../../src/sources/ieee";
import { prepareIeeeSources } from "../../src/sources/prepare-ieee";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("IEEE source preparation", () => {
  it("creates signed fixed-origin manifests for all approved registries", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-prepare-ieee-"));
    directories.push(directory);
    const keys = generateKeyPairSync("ed25519");
    const privateKeyPath = path.join(directory, "private.pem");
    const publicKeyPath = path.join(directory, "public.pem");
    await writeFile(privateKeyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    await writeFile(publicKeyPath, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const prefixes = { "MA-L": "001122", "MA-M": "AABBCCD", "MA-S": "DDEEFF001",
      IAB: "123456789", CID: "ABCDEF" } as const;

    const prepared = await prepareIeeeSources({
      output: path.join(directory, "prepared"), privateKeyPath, publicKeyPath,
      now: new Date("2026-07-11T10:00:00.000Z"),
      download: async (url, policy) => {
        const dataset = IEEE_DATASETS.find((candidate) => candidate.url === url);
        if (!dataset) throw new Error("unexpected URL");
        expect(policy).toMatchObject({ allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0 });
        return { bytes: Buffer.from([
          "Registry,Assignment,Organization Name,Organization Address",
          `${dataset.registry},${prefixes[dataset.registry]},Prepared ${dataset.registry} Vendor,Prepared Address`,
          "",
        ].join("\n")), redirectCount: 0, finalOrigin: IEEE_RA_ORIGIN };
      },
    });

    expect(prepared).toMatchObject({ status: "prepared", preparedAt: "2026-07-11T10:00:00.000Z" });
    expect(prepared.datasets.map((dataset) => dataset.registry)).toEqual(["MA-L", "MA-M", "MA-S", "IAB", "CID"]);
    for (const dataset of prepared.datasets) {
      const manifest = await loadManifest(dataset.manifestPath);
      expect(manifest).toMatchObject({
        source: { slug: `ieee-${dataset.registry.toLowerCase()}`,
          requiredForActivation: dataset.registry !== "CID",
          rights: { status: "approved", distributionScope: "api_output" } },
        artifact: { remote: { url: dataset.sourceUrl, allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0 },
          signature: { origin: "operator" } },
      });
      expect(await readFile(dataset.manifestPath, "utf8")).toContain(dataset.contentHash.slice(7));
    }
  });
});
