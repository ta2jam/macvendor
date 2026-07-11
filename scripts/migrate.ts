import "./env";
import { migrate, MigrationIntegrityError } from "../src/db/migrate";
import { createPool } from "../src/db/pool";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = createPool(url);
try {
  try {
    await migrate(pool);
    console.log("Database migrations are up to date.");
  } catch (error) {
    if (!(error instanceof MigrationIntegrityError)) throw error;
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
