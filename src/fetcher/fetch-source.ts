import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "@/domain/canonical-json";
import { ImportValidationError } from "@/importer/errors";
import { loadManifest } from "@/importer/manifest";
import { verifyArtifactSignature } from "@/importer/signature";
import { downloadHttps, type FetchNetworkOptions } from "./network";

const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 1024;
const FETCH_TIMEOUT_MS = 30_000;

async function destination(manifestPath: string, relativePath: string): Promise<string> {
  const directory = await realpath(path.dirname(manifestPath));
  const candidate = path.resolve(directory, relativePath);
  const relative = path.relative(directory, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ImportValidationError("UNSAFE_ARTIFACT_PATH", "fetch destination escapes the manifest directory");
  }
  await mkdir(path.dirname(candidate), { recursive: true, mode: 0o700 });
  const parent = await realpath(path.dirname(candidate));
  if (parent !== path.dirname(candidate)) {
    throw new ImportValidationError("UNSAFE_ARTIFACT_PATH", "fetch destination parent contains a symlink");
  }
  const current = await lstat(candidate).catch(() => null);
  if (current?.isDirectory()) throw new ImportValidationError("UNSAFE_ARTIFACT_FILE", "fetch destination cannot be a directory");
  return candidate;
}

async function writeTemporary(destinationPath: string, bytes: Buffer): Promise<string> {
  const temporary = path.join(path.dirname(destinationPath), `.${path.basename(destinationPath)}.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  return temporary;
}

export interface FetchSourceResult {
  status: "fetched";
  sourceSlug: string;
  contentHash: string;
  byteSize: number;
  redirectCount: number;
  finalOrigin: string;
  signatureKeyHash: string | null;
}

export async function fetchSourceArtifact(
  manifestPath: string,
  networkOptions: FetchNetworkOptions = {},
): Promise<FetchSourceResult> {
  const manifest = await loadManifest(manifestPath);
  const remote = manifest.artifact.remote;
  if (!remote) throw new ImportValidationError("REMOTE_CONFIG_REQUIRED", "artifact.remote is required for source fetch");
  const artifactDownload = await downloadHttps(remote.url, {
    allowedOrigins: remote.allowedOrigins,
    maxRedirects: remote.maxRedirects,
    maxBytes: MAX_ARTIFACT_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
  }, networkOptions);
  const contentHash = sha256(artifactDownload.bytes);
  if (contentHash !== manifest.artifact.sha256) {
    throw new ImportValidationError("ARTIFACT_HASH_MISMATCH", "downloaded artifact SHA-256 does not match manifest");
  }

  let signatureBytes: Buffer | undefined;
  if (manifest.artifact.signatureStatus === "verified" && manifest.artifact.signature?.origin !== "operator") {
    const signatureUrl = manifest.artifact.signature?.url;
    if (!signatureUrl) throw new ImportValidationError("SIGNATURE_URL_REQUIRED", "verified remote artifact has no signature URL");
    signatureBytes = (await downloadHttps(signatureUrl, {
      allowedOrigins: remote.allowedOrigins,
      maxRedirects: remote.maxRedirects,
      maxBytes: MAX_SIGNATURE_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
    }, networkOptions)).bytes;
  }
  const signatureKeyHash = await verifyArtifactSignature(manifest, manifestPath, artifactDownload.bytes, signatureBytes);
  const artifactDestination = await destination(manifestPath, manifest.artifact.path);
  const signatureDestination = manifest.artifact.signature
    ? await destination(manifestPath, manifest.artifact.signature.path)
    : null;
  const artifactTemporary = await writeTemporary(artifactDestination, artifactDownload.bytes);
  let signatureTemporary: string | null = null;
  try {
    if (signatureDestination && signatureBytes) {
      signatureTemporary = await writeTemporary(signatureDestination, signatureBytes);
      await rename(signatureTemporary, signatureDestination);
      signatureTemporary = null;
      await chmod(signatureDestination, 0o600);
    }
    await rename(artifactTemporary, artifactDestination);
    await chmod(artifactDestination, 0o600);
  } catch (error) {
    await rm(artifactTemporary, { force: true });
    if (signatureTemporary) await rm(signatureTemporary, { force: true });
    throw error;
  }
  return {
    status: "fetched",
    sourceSlug: manifest.source.slug,
    contentHash,
    byteSize: artifactDownload.bytes.byteLength,
    redirectCount: artifactDownload.redirectCount,
    finalOrigin: artifactDownload.finalOrigin,
    signatureKeyHash,
  };
}
