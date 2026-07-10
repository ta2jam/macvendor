import "./env";
import { createPool } from "../src/db/pool";
import { seedDemo } from "../src/db/seed";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const pool = createPool(url);
try {
  await seedDemo(pool);
  console.log("Local demo data is ready. Try 02:AA:BB:CC:00:01.");
} finally {
  await pool.end();
}
