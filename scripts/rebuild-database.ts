import "./env";
import { RecoveryError } from "../src/recovery/database";
import { rebuildFromSyntheticArtifacts } from "../src/recovery/rebuild";

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target-database");
const dropAfterCheck = args.includes("--drop-after-check");
const expectedLength = dropAfterCheck ? 3 : 2;
if (targetIndex < 0 || !args[targetIndex + 1] || args.length !== expectedLength) {
  console.error("Usage: npm run recovery:rebuild -- --target-database name_rebuild_abcd [--drop-after-check]");
  process.exit(2);
}
const adminDatabaseUrl = process.env.RECOVERY_ADMIN_DATABASE_URL;
if (!adminDatabaseUrl) throw new Error("RECOVERY_ADMIN_DATABASE_URL is required and must point to the postgres database");
try {
  console.log(JSON.stringify(await rebuildFromSyntheticArtifacts({
    adminDatabaseUrl,
    targetDatabase: args[targetIndex + 1]!,
    dropAfterCheck,
  }), null, 2));
} catch (error) {
  if (error instanceof RecoveryError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else throw error;
}
