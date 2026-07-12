import "./env";
import { createPool } from "../src/db/pool";
import { listCorrectionRequests, purgeExpiredCorrectionContacts, showCorrectionRequest, updateCorrectionStatus,
  type CorrectionStatus } from "../src/operations/corrections";

function usage(): never {
  console.error(`Usage:
  npm run correction:list -- [--status received|triaged|accepted|rejected|closed]
  OPERATOR_ACTOR_ID=operator:id npm run correction:show -- --reference CORR-...
  OPERATOR_ACTOR_ID=operator:id npm run correction:update -- --reference CORR-... --status triaged|accepted|rejected|closed --note TEXT
  OPERATOR_ACTOR_ID=operator:id npm run correction:purge`);
  process.exit(2);
}
function flags(args: string[]): Map<string,string> {
  const result = new Map<string,string>();
  for (let index=0; index<args.length; index+=2) {
    const key=args[index], value=args[index+1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || result.has(key)) usage();
    result.set(key,value);
  }
  return result;
}
const command=process.argv[2];
const values=flags(process.argv.slice(3));
const actor=process.env.OPERATOR_ACTOR_ID;
const url=process.env.DATABASE_URL;
if (!url || !command) usage();
const pool=createPool(url);
try {
  let result: unknown;
  if (command === "list") result=await listCorrectionRequests(pool, values.get("--status") as CorrectionStatus | undefined);
  else if (command === "show" && actor) result=await showCorrectionRequest(pool, values.get("--reference") ?? usage(), actor);
  else if (command === "update" && actor) result=await updateCorrectionStatus(pool, values.get("--reference") ?? usage(),
    (values.get("--status") ?? usage()) as CorrectionStatus, actor, values.get("--note") ?? usage());
  else if (command === "purge" && actor && values.size === 0) result=await purgeExpiredCorrectionContacts(pool, actor);
  else usage();
  console.log(JSON.stringify(result,null,2));
} finally { await pool.end(); }
