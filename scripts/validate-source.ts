import path from "node:path";
import { parseArtifact } from "../src/importer/artifact";
import { ImportValidationError } from "../src/importer/errors";
import { loadManifest } from "../src/importer/manifest";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--manifest" || !args[1]) {
  console.error("Usage: npm run source:validate -- --manifest path/to/manifest.json");
  process.exit(2);
}

const manifestPath = path.resolve(args[1]);
try {
  const manifest = await loadManifest(manifestPath);
  const artifact = await parseArtifact(manifest, manifestPath);
  process.stdout.write(`${JSON.stringify({
    status: "validated",
    sourceSlug: manifest.source.slug,
    adapterKey: manifest.source.adapterKey,
    adapterVersion: manifest.release.adapterVersion,
    contentHash: artifact.contentHash,
    byteSize: artifact.byteSize,
    recordCount: artifact.records.length,
    adapterWarnings: artifact.adapterWarnings,
  }, null, 2)}\n`);
} catch (error) {
  if (!(error instanceof ImportValidationError)) throw error;
  process.stderr.write(`${JSON.stringify({ error: error.code, detail: error.message })}\n`);
  process.exitCode = 1;
}
