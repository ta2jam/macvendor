import type { NextRequest } from "next/server";
import { getPool } from "@/db/pool";
import { searchOrganizations } from "@/db/organizations";
import { consumeRateLimit } from "@/http/rate-limit";
import { jsonResponse,problemResponse,requestId } from "@/http/responses";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  const id=requestId(request),rate=await consumeRateLimit(request,2);
  if(!rate.allowed)return problemResponse({status:429,code:"RATE_LIMITED",title:"Rate limit exceeded",detail:"Too many requests.",requestId:id,retryAfter:rate.retryAfter});
  const unknown=[...request.nextUrl.searchParams.keys()].filter((key)=>!["q","limit","scheme","registry"].includes(key));
  const q=request.nextUrl.searchParams.get("q")?.trim()??"",limit=Number(request.nextUrl.searchParams.get("limit")??"10");
  const scheme=request.nextUrl.searchParams.get("scheme")?.trim()||undefined;
  const registry=request.nextUrl.searchParams.get("registry")?.trim().toUpperCase()||undefined;
  if(unknown.length||q.length<2||q.length>100||!Number.isInteger(limit)||limit<1||limit>20
    ||(scheme&&!/^[a-z0-9][a-z0-9._-]{0,39}$/i.test(scheme))||(registry&&!['MA-L','MA-M','MA-S','IAB'].includes(registry)))
    return problemResponse({status:400,code:"INVALID_ORGANIZATION_QUERY",title:"Invalid organization query",detail:"Use q with 2-100 characters, limit 1-20, an optional identifier scheme, and registry MA-L, MA-M, MA-S, or IAB.",requestId:id});
  try {
    const body=await searchOrganizations(getPool(),q,limit,{scheme,registry});
    return jsonResponse(request,body,{requestId:id,cacheControl:"public, max-age=30, s-maxage=300",etagSeed:`${q}:${limit}:${scheme??''}:${registry??''}:${JSON.stringify(body)}`});
  } catch (error) {
    console.error("organization search failed", { requestId:id,error });
    return problemResponse({status:503,code:"SERVICE_UNAVAILABLE",title:"Service unavailable",detail:"Organization search is temporarily unavailable.",requestId:id});
  }
}
