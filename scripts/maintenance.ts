import "./env";
import { getPool } from "../src/db/pool";
import { purgeExpiredCorrectionContacts } from "../src/operations/corrections";
import { pruneRetiredResolutions } from "../src/operations/resolution-retention";

const pool=getPool();
try {
  const actorId=process.env.OPERATOR_ACTOR_ID??"operator:scheduled-maintenance";
  const limiter=await pool.query("DELETE FROM rate_limit_windows WHERE expires_at < now()");
  const corrections=await purgeExpiredCorrectionContacts(pool,actorId);
  const resolutions=await pruneRetiredResolutions(pool,{actorId});
  console.log(JSON.stringify({status:"maintained",expiredRateLimitWindows:limiter.rowCount??0,corrections,resolutions}));
} finally {
  await pool.end();
}
