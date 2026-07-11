import "./env";
import { createPool } from "../src/db/pool";
import { activateResolution, ActivationError } from "../src/resolver/activation";
import {
  CachePurgeError, DATA_RELEASE_SURROGATE_KEY, purgeSurrogateKeys, resolutionSurrogateKey,
} from "../src/cache/surrogate";

const args = process.argv.slice(2);
const runIndex = args.indexOf("--run");
if (runIndex < 0 || !args[runIndex + 1] || args.length !== 2) {
  console.error("Usage: npm run resolution:rollback -- --run UUID");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);
let committed: Awaited<ReturnType<typeof activateResolution>> | undefined;
try {
  committed = await activateResolution(pool, args[runIndex + 1]!, {
    actorId: process.env.OPERATOR_ACTOR_ID ?? "cli:resolution-rollback",
    rollback: true,
  });
  const cachePurge = committed.status === "already_active"
    ? { status: "skipped", reason: "no_change" }
    : await purgeSurrogateKeys([
      ...(committed.previousResolutionRunId ? [resolutionSurrogateKey(committed.previousResolutionRunId)] : []),
      DATA_RELEASE_SURROGATE_KEY,
    ]);
  console.log(JSON.stringify({ ...committed, cachePurge }, null, 2));
} catch (error) {
  if (error instanceof ActivationError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else if (error instanceof CachePurgeError && committed) {
    console.error(JSON.stringify({ error: error.code,
      detail: `rollback committed but cache purge failed: ${error.message}`, committed }));
    process.exitCode = 1;
  } else throw error;
} finally { await pool.end(); }
