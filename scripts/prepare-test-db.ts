import "./env";
import { createPool } from "../src/db/pool";
import { migrate } from "../src/db/migrate";
import { seedDemo } from "../src/db/seed";
import { assertTestDatabaseUrl } from "./test-database";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
assertTestDatabaseUrl(url, process.env.TEST_DATABASE_ALLOW_REMOTE === "true");

const pool = createPool(url);
try {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
  await seedDemo(pool);
  console.log("Test database reset, migrated, and seeded.");
} finally {
  await pool.end();
}
