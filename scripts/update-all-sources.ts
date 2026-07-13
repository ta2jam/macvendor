import "./env";
import path from "node:path";
import { createPool } from "../src/db/pool";
import { SourceUpdatePostCommitError, updateAllSources } from "../src/operations/source-update";
import { RESOLUTION_POLICY_REVISION, RESOLUTION_POLICY_VERSION } from "../src/resolver/policy";

const values = new Map<string, string>();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--") || values.has(key)) throw new Error("invalid arguments");
  values.set(key, value);
}
const allowed = ["--ieee-output", "--enrichment-output", "--private-key", "--public-key", "--mapping", "--identity-mapping"];
if ([...values.keys()].some((key) => !allowed.includes(key))) throw new Error("unsupported argument");
for (const required of ["--ieee-output", "--enrichment-output", "--private-key"]) {
  if (!values.has(required)) throw new Error(`${required} is required`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
try {
  try {
    const result = await updateAllSources(pool, {
      ieeeOutput: path.resolve(values.get("--ieee-output")!),
      enrichmentOutput: path.resolve(values.get("--enrichment-output")!),
      privateKeyPath: path.resolve(values.get("--private-key")!),
      publicKeyPath: values.get("--public-key") ? path.resolve(values.get("--public-key")!) : undefined,
      mappingPath: values.get("--mapping") ? path.resolve(values.get("--mapping")!) : undefined,
      identityMappingPath: values.get("--identity-mapping") ? path.resolve(values.get("--identity-mapping")!) : undefined,
      policyVersion: RESOLUTION_POLICY_VERSION,
      policyCommitSha: RESOLUTION_POLICY_REVISION,
      containerImageDigest: process.env.BUILD_IMAGE_DIGEST ?? "local",
      actorId: process.env.OPERATOR_ACTOR_ID ?? "cli:atomic-source-update",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (!(error instanceof SourceUpdatePostCommitError)) throw error;
    const cause = error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null;
    process.stderr.write(`${JSON.stringify({ error: "SOURCE_UPDATE_POST_COMMIT_FAILED", phase: error.phase,
      detail: error.message, committed: error.activation, cause })}\n`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
