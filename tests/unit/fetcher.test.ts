import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../../src/domain/canonical-json";
import { fetchSourceArtifact } from "../../src/fetcher/fetch-source";
import { downloadHttps, isPublicAddress } from "../../src/fetcher/network";
import { parseArtifact } from "../../src/importer/artifact";
import { loadManifest } from "../../src/importer/manifest";

let directory: string;
let server: Server;
let stallingServer: Server;
let origin: string;
let certificate: Buffer;
let artifact: string;
let signatureText: string;
let publicKeyBytes: Buffer;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "macvendor-fetcher-"));
  const configPath = path.join(directory, "openssl.cnf");
  await writeFile(configPath, `[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=fixture.test
[v3]
subjectAltName=DNS:fixture.test
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyCertSign
`);
  const keyPath = path.join(directory, "tls-key.pem");
  const certificatePath = path.join(directory, "tls-certificate.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-config", configPath, "-keyout", keyPath, "-out", certificatePath], { stdio: "ignore" });
  const key = await readFile(keyPath);
  certificate = await readFile(certificatePath);
  artifact = "prefix,prefixLength,organizationName\n02EEFF,24,Synthetic HTTPS Vendor\n";
  const signingKeys = generateKeyPairSync("ed25519");
  publicKeyBytes = Buffer.from(signingKeys.publicKey.export({ type: "spki", format: "pem" }));
  signatureText = sign(null, Buffer.from(artifact), signingKeys.privateKey).toString("base64");
  server = createServer({ key, cert: certificate }, (request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/artifact" }).end();
    } else if (request.url === "/off-origin") {
      response.writeHead(302, { Location: `https://blocked.test:${(server.address() as { port: number }).port}/artifact` }).end();
    } else if (request.url === "/artifact" || request.url === "/transient" || request.url === "/rate-limited") {
      response.writeHead(200, { "Content-Type": "text/csv" }).end(artifact);
    } else if (request.url === "/signature") {
      response.writeHead(200, { "Content-Type": "text/plain" }).end(signatureText);
    } else if (request.url === "/oversize") {
      response.writeHead(200, { "Content-Length": "4096" }).end("x".repeat(4096));
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://fixture.test:${(server.address() as { port: number }).port}`;
  stallingServer = createServer({ key, cert: certificate }, (request, response) => {
    if (request.url === "/artifact") {
      response.writeHead(200, { "Content-Type": "text/csv", "Content-Length": Buffer.byteLength(artifact) });
      response.write(artifact.slice(0, -8));
    } else if (request.url === "/transient") response.writeHead(503).end();
    else if (request.url === "/missing") response.writeHead(404).end();
    else if (request.url === "/rate-limited") response.writeHead(429, { "Retry-After": "60" }).end();
  });
  await new Promise<void>((resolve) => stallingServer.listen(
    (server.address() as { port: number }).port, "::1", resolve,
  ));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => stallingServer.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

const testNetwork = () => ({
  ca: certificate,
  resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  testOnlyAllowPrivateAddresses: true,
});

describe("HTTPS fetch boundary", () => {
  it("classifies public and non-public addresses conservatively", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("10.0.0.1")).toBe(false);
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicAddress("2606:4700:90:0:f22e:fbec:5bed:a9b9")).toBe(true);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("2001:db8::1")).toBe(false);
  });

  it("blocks loopback DNS results without the test-only override", async () => {
    await expect(downloadHttps(`${origin}/artifact`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 5_000,
    }, { ca: certificate, resolver: async () => [{ address: "127.0.0.1", family: 4 }] }))
      .rejects.toMatchObject({ code: "SSRF_ADDRESS_BLOCKED" });
    await expect(downloadHttps(`${origin}/artifact`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 5_000,
    }, { ca: certificate, resolver: async () => [
      { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
    ] })).rejects.toMatchObject({ code: "SSRF_ADDRESS_BLOCKED" });
  });

  it("pins validated DNS, revalidates an allowed redirect, and enforces byte limits", async () => {
    const result = await downloadHttps(`${origin}/redirect`, {
      allowedOrigins: [origin], maxRedirects: 1, maxBytes: 1024, timeoutMs: 5_000,
    }, testNetwork());
    expect(result).toMatchObject({ redirectCount: 1, finalOrigin: origin });
    expect(result.bytes.toString()).toBe(artifact);
    await expect(downloadHttps(`${origin}/oversize`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 128, timeoutMs: 5_000,
    }, testNetwork())).rejects.toMatchObject({ code: "FETCH_TOO_LARGE" });
  });

  it("rejects a redirect to an origin outside the explicit allowlist", async () => {
    await expect(downloadHttps(`${origin}/off-origin`, {
      allowedOrigins: [origin], maxRedirects: 1, maxBytes: 1024, timeoutMs: 5_000,
    }, testNetwork())).rejects.toMatchObject({ code: "REMOTE_ORIGIN_BLOCKED" });
  });

  it("fails over to another validated address when the first edge becomes idle", async () => {
    const result = await downloadHttps(`${origin}/artifact`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 2_000,
      idleTimeoutMs: 100, sourceSlug: "pci-id-repository",
    }, {
      ...testNetwork(),
      resolver: async () => [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ],
    });
    expect(result).toMatchObject({ finalOrigin: origin });
    expect(result.bytes.toString()).toBe(artifact);
  });

  it("attributes an exhausted idle failure to the source and sanitized remote", async () => {
    await expect(downloadHttps(`${origin}/artifact`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 500,
      idleTimeoutMs: 100, sourceSlug: "pci-id-repository",
    }, {
      ...testNetwork(),
      resolver: async () => [{ address: "::1", family: 6 }],
    })).rejects.toMatchObject({
      name: "RemoteFetchError", code: "FETCH_IDLE_TIMEOUT", sourceSlug: "pci-id-repository",
      remoteUrl: `${origin}/artifact`, addressAttempts: 1,
    });
  });

  it("fails over on a transient upstream status", async () => {
    const result = await downloadHttps(`${origin}/transient`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 2_000,
      idleTimeoutMs: 100, sourceSlug: "pci-id-repository",
    }, {
      ...testNetwork(),
      resolver: async () => [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ],
    });
    expect(result.bytes.toString()).toBe(artifact);
  });

  it("does not retry a non-transient upstream status", async () => {
    await expect(downloadHttps(`${origin}/missing`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 2_000,
      idleTimeoutMs: 100, sourceSlug: "pci-id-repository",
    }, {
      ...testNetwork(),
      resolver: async () => [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ],
    })).rejects.toMatchObject({
      name: "RemoteFetchError", code: "FETCH_STATUS_REJECTED", statusCode: 404, addressAttempts: 1,
    });
  });

  it("does not bypass an origin rate limit through another address", async () => {
    await expect(downloadHttps(`${origin}/rate-limited`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 2_000,
      idleTimeoutMs: 100, sourceSlug: "pci-id-repository",
    }, {
      ...testNetwork(),
      resolver: async () => [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ],
    })).rejects.toMatchObject({
      name: "RemoteFetchError", code: "FETCH_STATUS_REJECTED", statusCode: 429, addressAttempts: 1,
    });
  });

  it("does not permit URL credentials, query tokens, or disabled TLS verification", async () => {
    await expect(downloadHttps(`${origin}/artifact?token=secret`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 5_000,
    }, testNetwork())).rejects.toMatchObject({ code: "INVALID_REMOTE_URL" });
    await expect(downloadHttps(`${origin}/artifact`, {
      allowedOrigins: [origin], maxRedirects: 0, maxBytes: 1024, timeoutMs: 5_000,
    }, { resolver: testNetwork().resolver, testOnlyAllowPrivateAddresses: true }))
      .rejects.toMatchObject({ code: "FETCH_FAILED" });
  });

  it("fetches, verifies, and atomically hands off a signed synthetic artifact", async () => {
    const sourceDirectory = path.join(directory, "source");
    await mkdir(sourceDirectory);
    await writeFile(path.join(sourceDirectory, "trusted-ed25519-public.pem"), publicKeyBytes);
    const manifest = {
      schemaVersion: "macvendor-source/v1",
      source: {
        slug: "synthetic-https-source", name: "Synthetic HTTPS Source", class: "authoritative",
        publishMode: "production", adapterKey: "strict-delimited-v1", requiredForActivation: false,
        rights: { status: "approved", basis: "licensed", distributionScope: "api_output", reviewReference: "TEST-HTTPS-RIGHTS" },
      },
      release: {
        snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1",
        adapterVersion: "1", normalizerVersion: "2", diffPolicy: { maxAddedPercent: 25, maxRemovedPercent: 5 },
      },
      artifact: {
        path: "records.csv", format: "csv", sha256: sha256(artifact), signatureStatus: "verified",
        signature: {
          algorithm: "ed25519", path: "records.csv.sig", publicKeyPath: "trusted-ed25519-public.pem",
          publicKeySha256: sha256(publicKeyBytes), url: `${origin}/signature`,
        },
        remote: { url: `${origin}/redirect`, allowedOrigins: [origin], maxRedirects: 1 },
      },
      defaults: {
        recordKind: "assignment", originType: "imported", rightsBasis: "licensed",
        distributionScope: "api_output", verificationStatus: "single_observation", registry: "MA-L",
      },
    };
    const manifestPath = path.join(sourceDirectory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    const fetched = await fetchSourceArtifact(manifestPath, testNetwork());
    expect(fetched).toMatchObject({ status: "fetched", contentHash: sha256(artifact), signatureKeyHash: sha256(publicKeyBytes) });
    await expect(readFile(path.join(sourceDirectory, "records.csv"), "utf8")).resolves.toBe(artifact);
    await expect(parseArtifact(await loadManifest(manifestPath), manifestPath)).resolves.toMatchObject({ contentHash: sha256(artifact) });
  });
});
