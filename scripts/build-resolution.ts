import "./env";
import { createPool } from "../src/db/pool";
import { buildResolution, ResolutionBuildError } from "../src/resolver/build";
import { RESOLUTION_POLICY_REVISION,RESOLUTION_POLICY_VERSION } from "../src/resolver/policy";

const args = process.argv.slice(2);
const releaseIds: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== "--source-release" || !args[index + 1]) {
    console.error("Usage: npm run resolution:build -- --source-release UUID [--source-release UUID]");
    process.exit(2);
  }
  releaseIds.push(args[index + 1]!);
  index += 1;
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);
try {
  const result = await buildResolution(pool, {
    sourceReleaseIds: releaseIds,
    policyVersion: RESOLUTION_POLICY_VERSION,
    policyCommitSha: RESOLUTION_POLICY_REVISION,
    containerImageDigest: process.env.BUILD_IMAGE_DIGEST ?? "local",
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "rejected") process.exitCode = 1;
} catch (error) {
  if (error instanceof ResolutionBuildError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else throw error;
} finally {
  await pool.end();
}
