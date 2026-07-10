import "./env";
import { migrate } from "../src/db/migrate";
import { createPool } from "../src/db/pool";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = createPool(url);
try {
  await migrate(pool);
  console.log("Database migrations are up to date.");
} finally {
  await pool.end();
}
