import "./env";
import path from "node:path";
import { prepareIeeeSources } from "../src/sources/prepare-ieee";

const flags = new Map<string, string>();
const values = process.argv.slice(2);
for (let index = 0; index < values.length; index += 2) {
  const key = values[index];
  const value = values[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) {
    throw new Error("Usage: npm run source:prepare:ieee -- [--output path] [--private-key path] [--public-key path]");
  }
  flags.set(key, value);
}
if ([...flags.keys()].some((key) => !["--output", "--private-key", "--public-key"].includes(key))) {
  throw new Error("unsupported argument");
}

const result = await prepareIeeeSources({
  output: flags.get("--output") ? path.resolve(flags.get("--output")!) : undefined,
  privateKeyPath: flags.get("--private-key") ? path.resolve(flags.get("--private-key")!) : undefined,
  publicKeyPath: flags.get("--public-key") ? path.resolve(flags.get("--public-key")!) : undefined,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
