import "./env";
import path from "node:path";
import { DATA_RELEASE_SURROGATE_KEY, CachePurgeError, purgeSurrogateKeys } from "../src/cache/surrogate";
import { createPool } from "../src/db/pool";
import {
  applySourceGovernance, loadSourceGovernanceDecision, previewSourceGovernance, SourceGovernanceError,
} from "../src/operations/source-governance";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const decisionIndex = args.indexOf("--decision");
if (decisionIndex < 0 || !args[decisionIndex + 1]
  || args.some((arg, index) => ![decisionIndex, decisionIndex + 1].includes(index) && arg !== "--apply")
  || args.filter((arg) => arg === "--apply").length > 1) {
  console.error("Usage: npm run source:governance -- --decision path/to/decision.json [--apply]");
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
let committed: unknown;
try {
  try {
    const decision = await loadSourceGovernanceDecision(path.resolve(args[decisionIndex + 1]!));
    if (!apply) {
      console.log(JSON.stringify(await previewSourceGovernance(pool, decision), null, 2));
    } else {
      const actorId = process.env.OPERATOR_ACTOR_ID;
      if (!actorId) throw new SourceGovernanceError("ACTOR_REQUIRED", "OPERATOR_ACTOR_ID is required with --apply");
      committed = await applySourceGovernance(pool, decision, actorId);
      const result = committed as { status: string };
      const cachePurge = result.status === "updated"
        ? await purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY])
        : { status: "skipped", reason: "no_change" };
      console.log(JSON.stringify({ ...result, cachePurge }, null, 2));
    }
  } catch (error) {
    if (error instanceof SourceGovernanceError) {
      console.error(JSON.stringify({ error: error.code, detail: error.message }));
      process.exitCode = 1;
    } else if (error instanceof CachePurgeError && committed) {
      console.error(JSON.stringify({ error: error.code,
        detail: `source governance committed but cache purge failed: ${error.message}`, committed }));
      process.exitCode = 1;
    } else throw error;
  }
} finally { await pool.end(); }
