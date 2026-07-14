import { APP_VERSION } from "@/lib/version";
import { getRateLimitHealth } from "@/http/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const rateLimit = getRateLimitHealth();
  return Response.json(
    { status: "ok", version: APP_VERSION, controls: { rateLimit: rateLimit.status } },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
