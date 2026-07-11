import "./env";
import path from "node:path";
import { createPool } from "../src/db/pool";
import { ImportValidationError } from "../src/importer/errors";
import { importSourceRelease } from "../src/importer/import-source";

const args = process.argv.slice(2);
const manifestIndex = args.indexOf("--manifest");
if (manifestIndex < 0 || !args[manifestIndex + 1] || args.length !== 2) {
  console.error("Usage: npm run source:import -- --manifest path/to/manifest.json");
  process.exitCode = 2;
} else {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = createPool(url);
  try {
    const result = await importSourceRelease(pool, path.resolve(args[manifestIndex + 1]));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof ImportValidationError) {
      console.error(JSON.stringify({ error: error.code, detail: error.message }));
      process.exitCode = 1;
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}
