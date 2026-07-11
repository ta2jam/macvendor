import "./env";
import path from "node:path";
import { fetchSourceArtifact } from "../src/fetcher/fetch-source";
import { ImportValidationError } from "../src/importer/errors";

const args = process.argv.slice(2);
const manifestIndex = args.indexOf("--manifest");
if (manifestIndex < 0 || !args[manifestIndex + 1] || args.length !== 2) {
  console.error("Usage: npm run source:fetch -- --manifest path/to/manifest.json");
  process.exit(2);
}

try {
  console.log(JSON.stringify(await fetchSourceArtifact(path.resolve(args[manifestIndex + 1]!)), null, 2));
} catch (error) {
  if (error instanceof ImportValidationError) {
    console.error(JSON.stringify({ error: error.code, detail: error.message }));
    process.exitCode = 1;
  } else throw error;
}
