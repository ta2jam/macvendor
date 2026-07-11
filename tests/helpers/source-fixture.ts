import { generateKeyPairSync, sign } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../../src/domain/canonical-json";
import type { SourceManifest } from "../../src/importer/types";

const signingKeys = new Map<string, ReturnType<typeof generateKeyPairSync>>();

export async function writeSignedArtifact(
  directory: string,
  content: string,
  artifactName = "records.csv",
): Promise<NonNullable<SourceManifest["artifact"]["signature"]>> {
  const { privateKey, publicKey } = signingKeys.get(directory)
    ?? (() => {
      const created = generateKeyPairSync("ed25519");
      signingKeys.set(directory, created);
      return created;
    })();
  const publicKeyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  const signature = sign(null, Buffer.from(content), privateKey).toString("base64");
  await writeFile(path.join(directory, artifactName), content);
  await writeFile(path.join(directory, `${artifactName}.sig`), signature);
  await writeFile(path.join(directory, "trusted-ed25519-public.pem"), publicKeyBytes, { mode: 0o600 });
  return {
    algorithm: "ed25519",
    path: `${artifactName}.sig`,
    publicKeyPath: "trusted-ed25519-public.pem",
    publicKeySha256: sha256(publicKeyBytes),
  };
}
