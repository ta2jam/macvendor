import "./env";
import { createPool } from "../src/db/pool";
import { activateResolution, ActivationError } from "../src/resolver/activation";

const args = process.argv.slice(2);
const runIndex = args.indexOf("--run");
if (runIndex < 0 || !args[runIndex + 1] || args.length !== 2) {
  console.error("Usage: npm run resolution:rollback -- --run UUID");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);
try {
  console.log(JSON.stringify(await activateResolution(pool, args[runIndex + 1]!, {
    actorId: process.env.OPERATOR_ACTOR_ID ?? "cli:resolution-rollback",
    rollback: true,
  }), null, 2));
} catch (error) {
  if (error instanceof ActivationError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else throw error;
} finally { await pool.end(); }
