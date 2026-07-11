import "./env";
import path from "node:path";
import { RecoveryError } from "../src/recovery/database";
import { restoreLogicalBackup } from "../src/recovery/restore";

const args = process.argv.slice(2);
const manifestIndex = args.indexOf("--manifest");
const targetIndex = args.indexOf("--target-database");
const dropAfterCheck = args.includes("--drop-after-check");
const expectedLength = dropAfterCheck ? 5 : 4;
if (manifestIndex < 0 || targetIndex < 0 || !args[manifestIndex + 1] || !args[targetIndex + 1]
  || args.length !== expectedLength) {
  console.error("Usage: npm run recovery:restore -- --manifest /backup/file.json --target-database name_restore_abcd [--drop-after-check]");
  process.exit(2);
}
const adminDatabaseUrl = process.env.RECOVERY_ADMIN_DATABASE_URL;
if (!adminDatabaseUrl) throw new Error("RECOVERY_ADMIN_DATABASE_URL is required and must point to the postgres database");
try {
  console.log(JSON.stringify(await restoreLogicalBackup({
    adminDatabaseUrl,
    manifestPath: path.resolve(args[manifestIndex + 1]!),
    targetDatabase: args[targetIndex + 1]!,
    dropAfterCheck,
  }), null, 2));
} catch (error) {
  if (error instanceof RecoveryError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else throw error;
}
