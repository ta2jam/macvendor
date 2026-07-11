import "./env";
import { execFileSync } from "node:child_process";
import { APP_VERSION } from "../src/lib/version";
import { createPool } from "../src/db/pool";
import { buildResolution, ResolutionBuildError } from "../src/resolver/build";

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
    policyVersion: `v${APP_VERSION}`,
    policyCommitSha: process.env.GIT_COMMIT_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
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
