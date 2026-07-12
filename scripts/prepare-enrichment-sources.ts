import "./env";
import path from "node:path";
import { prepareEnrichmentSources } from "../src/sources/prepare-enrichments";

const flags = new Map<string, string>();
const values = process.argv.slice(2);
for (let index = 0; index < values.length; index += 2) {
  const key = values[index];
  const value = values[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) throw new Error("invalid arguments");
  flags.set(key, value);
}
if (!flags.get("--ieee-dir")) {
  throw new Error("Usage: npm run source:prepare:enrichments -- --ieee-dir path [--output path] [--private-key path] [--public-key path]");
}
const result = await prepareEnrichmentSources({
  ieeeDirectory: path.resolve(flags.get("--ieee-dir")!),
  output: flags.get("--output") ? path.resolve(flags.get("--output")!) : undefined,
  privateKeyPath: flags.get("--private-key") ? path.resolve(flags.get("--private-key")!) : undefined,
  publicKeyPath: flags.get("--public-key") ? path.resolve(flags.get("--public-key")!) : undefined,
  mappingPath: flags.get("--mapping") ? path.resolve(flags.get("--mapping")!) : undefined,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
