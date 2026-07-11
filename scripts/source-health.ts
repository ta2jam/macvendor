import "./env";
import { createPool } from "../src/db/pool";
import { checkSourceGovernance } from "../src/operations/source-health";

const args = process.argv.slice(2);
let warningWindowDays = 30;
if (args.length) {
  if (args.length !== 2 || args[0] !== "--warning-days") {
    console.error("Usage: npm run source:health -- [--warning-days 30]");
    process.exit(2);
  }
  warningWindowDays = Number(args[1]);
  if (!Number.isInteger(warningWindowDays) || warningWindowDays < 1 || warningWindowDays > 365) {
    console.error("--warning-days must be an integer from 1 to 365");
    process.exit(2);
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);
try {
  const report = await checkSourceGovernance(pool, { warningWindowDays });
  console.log(JSON.stringify(report, null, 2));
  if (!report.healthy) process.exitCode = 1;
} finally {
  await pool.end();
}
