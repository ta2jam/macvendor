import { createPublicKey, verify } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "@/domain/canonical-json";
import { ImportValidationError } from "./errors";
import type { SourceManifest } from "./types";

const MAX_PUBLIC_KEY_BYTES = 8 * 1024;
const MAX_SIGNATURE_TEXT_BYTES = 1024;

async function readSafeFile(manifestPath: string, relativePath: string, maximumBytes: number, field: string): Promise<Buffer> {
  const directory = await realpath(path.dirname(manifestPath));
  const candidate = path.resolve(directory, relativePath);
  const relative = path.relative(directory, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ImportValidationError("UNSAFE_SIGNATURE_PATH", `${field} escapes the manifest directory`);
  }
  const stat = await lstat(candidate).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
    throw new ImportValidationError("UNSAFE_SIGNATURE_FILE", `${field} must be a bounded regular non-symlink file`);
  }
  return readFile(candidate);
}

function decodeSignature(bytes: Buffer): Buffer {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    throw new ImportValidationError("INVALID_SIGNATURE_ENCODING", "detached signature must be base64 UTF-8 text");
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(text)) {
    throw new ImportValidationError("INVALID_SIGNATURE_ENCODING", "Ed25519 signature must be canonical base64");
  }
  const signature = Buffer.from(text, "base64");
  if (signature.byteLength !== 64 || signature.toString("base64") !== text) {
    throw new ImportValidationError("INVALID_SIGNATURE_ENCODING", "Ed25519 signature must decode to 64 bytes");
  }
  return signature;
}

export async function verifyArtifactSignature(
  manifest: SourceManifest,
  manifestPath: string,
  artifactBytes: Buffer,
  providedSignatureBytes?: Buffer,
): Promise<string | null> {
  if (manifest.artifact.signatureStatus !== "verified") return null;
  const config = manifest.artifact.signature;
  if (!config) throw new ImportValidationError("SIGNATURE_CONFIG_REQUIRED", "verified artifact has no signature configuration");
  const publicKeyBytes = await readSafeFile(manifestPath, config.publicKeyPath, MAX_PUBLIC_KEY_BYTES, "public key");
  const publicKeyHash = sha256(publicKeyBytes);
  if (publicKeyHash !== config.publicKeySha256) {
    throw new ImportValidationError("PUBLIC_KEY_HASH_MISMATCH", "trusted public key hash does not match the manifest");
  }
  const signatureBytes = providedSignatureBytes
    ?? await readSafeFile(manifestPath, config.path, MAX_SIGNATURE_TEXT_BYTES, "signature");
  if (signatureBytes.byteLength > MAX_SIGNATURE_TEXT_BYTES) {
    throw new ImportValidationError("SIGNATURE_TOO_LARGE", "detached signature exceeds 1 KiB");
  }
  let key;
  try {
    key = createPublicKey(publicKeyBytes);
  } catch {
    throw new ImportValidationError("INVALID_PUBLIC_KEY", "public key is not a valid PEM key");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new ImportValidationError("INVALID_PUBLIC_KEY", "public key must be Ed25519");
  }
  if (!verify(null, artifactBytes, key, decodeSignature(signatureBytes))) {
    throw new ImportValidationError("ARTIFACT_SIGNATURE_INVALID", "detached artifact signature verification failed");
  }
  return publicKeyHash;
}
