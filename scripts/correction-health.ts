import "./env";
import {getPool} from "../src/db/pool";

const pool = getPool();
try {
  const result = await pool.query<{
    open: string;
    overdue: string;
    urgent_overdue: string;
    oldest: Date | null;
  }>(`SELECT
    count(*) FILTER(WHERE status IN ('received','triaged')) AS open,
    count(*) FILTER(WHERE status='received' AND created_at<now()-interval '48 hours') AS overdue,
    count(*) FILTER(WHERE status='received' AND category IN ('privacy','rights','withdrawal')
      AND created_at<now()-interval '24 hours') AS urgent_overdue,
    min(created_at) FILTER(WHERE status IN ('received','triaged')) AS oldest
    FROM correction_requests`);
  const row = result.rows[0]!;
  const report = {
    status: Number(row.overdue) || Number(row.urgent_overdue) ? "unhealthy" : "healthy",
    open: Number(row.open),
    overdue: Number(row.overdue),
    urgentOverdue: Number(row.urgent_overdue),
    oldest: row.oldest?.toISOString() ?? null,
  };
  console.log(JSON.stringify(report));
  if (report.status !== "healthy") process.exitCode = 1;
} finally {
  await pool.end();
}
