import "./env";
import path from "node:path";
import { createLogicalBackup } from "../src/recovery/backup";
import { RecoveryError } from "../src/recovery/database";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-dir");
if (outputIndex < 0 || !args[outputIndex + 1] || args.length !== 2) {
  console.error("Usage: npm run recovery:backup -- --output-dir /secure/backup/directory");
  process.exit(2);
}
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");
try {
  console.log(JSON.stringify(await createLogicalBackup(sourceUrl, path.resolve(args[outputIndex + 1]!)), null, 2));
} catch (error) {
  if (error instanceof RecoveryError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else throw error;
}
