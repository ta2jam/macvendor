import "./env";
import { createPool } from "../src/db/pool";
import { sourceValueReport } from "../src/operations/source-value";

if (process.argv.length !== 2) throw new Error("Usage: npm run source:value-report");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
try {
  process.stdout.write(`${JSON.stringify(await sourceValueReport(pool), null, 2)}\n`);
} finally {
  await pool.end();
}
