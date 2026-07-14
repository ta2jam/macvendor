import { getPool } from "@/db/pool";
import { APP_VERSION } from "@/lib/version";
import { getRateLimitHealth } from "@/http/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (getRateLimitHealth().status === "degraded") {
      return Response.json(
        { status: "not_ready", version: APP_VERSION, reason: "rate_limit_degraded" },
        { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
      );
    }
    const ready = await getPool().query<{ ready: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM active_resolution ar JOIN resolution_runs rr
        ON rr.id = ar.resolution_run_id
        WHERE ar.singleton_id = 1 AND rr.status = 'active'
      ) AS ready`,
    );
    if (!ready.rows[0]?.ready) {
      return Response.json(
        { status: "not_ready", version: APP_VERSION },
        { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
      );
    }
    return Response.json(
      { status: "ready", version: APP_VERSION },
      { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    console.error("readiness check failed", { error });
    return Response.json(
      { status: "not_ready", version: APP_VERSION },
      { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    );
  }
}
