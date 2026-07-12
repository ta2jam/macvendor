import "./env";
import { getPool } from "../src/db/pool";
import { purgeExpiredCorrectionContacts } from "../src/operations/corrections";

const pool=getPool();
try {
  const limiter=await pool.query("DELETE FROM rate_limit_windows WHERE expires_at < now()");
  const corrections=await purgeExpiredCorrectionContacts(pool,process.env.OPERATOR_ACTOR_ID??"operator:scheduled-maintenance");
  console.log(JSON.stringify({status:"maintained",expiredRateLimitWindows:limiter.rowCount??0,corrections}));
} finally {
  await pool.end();
}
