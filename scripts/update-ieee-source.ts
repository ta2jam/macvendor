import "./env";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createPool } from "../src/db/pool";
import { APP_VERSION } from "../src/lib/version";
import { IeeeUpdatePostCommitError, updateIeeeSources } from "../src/operations/ieee-update";

const flags = new Map<string, string>();
const values = process.argv.slice(2);
for (let index = 0; index < values.length; index += 2) {
  const key = values[index];
  const value = values[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) {
    throw new Error("Usage: npm run source:update:ieee -- [--output path] [--private-key path] [--public-key path]");
  }
  flags.set(key, value);
}
if ([...flags.keys()].some((key) => !["--output", "--private-key", "--public-key"].includes(key))) {
  throw new Error("unsupported argument");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
try {
  try {
    const result = await updateIeeeSources(pool, {
      output: flags.get("--output") ? path.resolve(flags.get("--output")!) : undefined,
      privateKeyPath: flags.get("--private-key") ? path.resolve(flags.get("--private-key")!) : undefined,
      publicKeyPath: flags.get("--public-key") ? path.resolve(flags.get("--public-key")!) : undefined,
      policyVersion: `v${APP_VERSION}`,
      policyCommitSha: process.env.GIT_COMMIT_SHA
        ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      containerImageDigest: process.env.BUILD_IMAGE_DIGEST ?? "local",
      actorId: process.env.OPERATOR_ACTOR_ID ?? "cli:ieee-update",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (!(error instanceof IeeeUpdatePostCommitError)) throw error;
    const cause = error.cause instanceof Error ? error.cause : null;
    process.stderr.write(`${JSON.stringify({ error: "IEEE_UPDATE_POST_COMMIT_FAILED",
      detail: error.message, phase: error.phase, committed: error.activation,
      cause: cause ? { name: cause.name, message: cause.message } : null })}\n`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
