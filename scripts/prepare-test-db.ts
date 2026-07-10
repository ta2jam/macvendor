import "./env";
import { createPool } from "../src/db/pool";
import { migrate } from "../src/db/migrate";
import { seedDemo } from "../src/db/seed";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends with _test");
}

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
