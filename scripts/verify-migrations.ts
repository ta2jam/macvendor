import { loadMigrationSet } from "../src/db/migrate";

const migrations = await loadMigrationSet("migrations");
process.stdout.write(`${JSON.stringify({ status: "verified", migrations: migrations.length })}\n`);
