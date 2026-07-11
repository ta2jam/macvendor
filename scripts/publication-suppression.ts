import "./env";
import { createPool } from "../src/db/pool";
import { InvalidPrefixError, parsePrefix } from "../src/domain/mac";
import {
  createSuppression, expireSuppressions, listSuppressions, revokeSuppression, SuppressionError,
} from "../src/operations/suppressions";

function usage(): never {
  console.error(`Usage:
  OPERATOR_ACTOR_ID=operator:id npm run suppression:create -- --assignment UUID --reason CODE --ticket REF [--expires-at RFC3339]
  OPERATOR_ACTOR_ID=operator:id npm run suppression:create -- --claim UUID --reason CODE --ticket REF [--expires-at RFC3339]
  OPERATOR_ACTOR_ID=operator:id npm run suppression:create -- --prefix HEX-LENGTH --surface official|curated|both [--source SLUG] --reason CODE --ticket REF [--expires-at RFC3339]
  OPERATOR_ACTOR_ID=operator:id npm run suppression:revoke -- --id UUID --ticket REF
  npm run suppression:list -- [--status active|revoked|expired|all]
  OPERATOR_ACTOR_ID=operator:id npm run suppression:expire`);
  process.exit(2);
}

function flags(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || parsed.has(key)) usage();
    parsed.set(key, value);
  }
  return parsed;
}

function exactKeys(values: Map<string, string>, allowed: string[]): void {
  if ([...values.keys()].some((key) => !allowed.includes(key))) usage();
}

function required(values: Map<string, string>, key: string): string {
  return values.get(key) ?? usage();
}

function actor(): string {
  return process.env.OPERATOR_ACTOR_ID ?? usage();
}

const [command, ...args] = process.argv.slice(2);
if (!command) usage();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);

try {
  let result: unknown;
  if (command === "create") {
    const values = flags(args);
    exactKeys(values, ["--assignment", "--claim", "--prefix", "--surface", "--source", "--reason", "--ticket", "--expires-at"]);
    const targetFlags = [values.has("--assignment"), values.has("--claim"), values.has("--prefix")].filter(Boolean).length;
    if (targetFlags !== 1) usage();
    let target;
    if (values.has("--assignment")) {
      if (values.has("--surface") || values.has("--source")) usage();
      target = { assignmentId: required(values, "--assignment") };
    } else if (values.has("--claim")) {
      if (values.has("--surface") || values.has("--source")) usage();
      target = { claimId: required(values, "--claim") };
    } else {
      const prefix = parsePrefix(required(values, "--prefix"));
      const surface = required(values, "--surface");
      if (!(["official", "curated", "both"] as string[]).includes(surface)) usage();
      target = {
        prefixBits: prefix.bits, prefixLength: prefix.prefixLength,
        surface: surface as "official" | "curated" | "both",
        sourceSlug: values.get("--source"),
      };
    }
    const expiresText = values.get("--expires-at");
    const expiresAt = expiresText ? new Date(expiresText) : undefined;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) usage();
    result = await createSuppression(pool, {
      target, reasonCode: required(values, "--reason"),
      ticketReference: required(values, "--ticket"), actorId: actor(), expiresAt,
    });
  } else if (command === "revoke") {
    const values = flags(args);
    exactKeys(values, ["--id", "--ticket"]);
    result = await revokeSuppression(pool, {
      suppressionId: required(values, "--id"), ticketReference: required(values, "--ticket"), actorId: actor(),
    });
  } else if (command === "list") {
    const values = flags(args);
    exactKeys(values, ["--status"]);
    const status = values.get("--status") ?? "active";
    if (!(["active", "revoked", "expired", "all"] as string[]).includes(status)) usage();
    result = await listSuppressions(pool, status as "active" | "revoked" | "expired" | "all");
  } else if (command === "expire") {
    if (args.length) usage();
    result = await expireSuppressions(pool, { actorId: actor() });
  } else usage();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof SuppressionError || error instanceof InvalidPrefixError) {
    console.error(JSON.stringify({ error: error instanceof SuppressionError ? error.code : "INVALID_PREFIX", detail: error.message }));
    process.exitCode = 1;
  } else throw error;
} finally {
  await pool.end();
}
