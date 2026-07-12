import type { NextRequest } from "next/server";
import { getPool } from "@/db/pool";
import { getOrganization } from "@/db/organizations";
import { consumeRateLimit } from "@/http/rate-limit";
import { jsonResponse,problemResponse,requestId } from "@/http/responses";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:NextRequest,{params}:{params:Promise<{key:string}>}){
  const id=requestId(request),rate=await consumeRateLimit(request,2);
  if(!rate.allowed)return problemResponse({status:429,code:"RATE_LIMITED",title:"Rate limit exceeded",detail:"Too many requests.",requestId:id,retryAfter:rate.retryAfter});
  if([...request.nextUrl.searchParams.keys()].length)return problemResponse({status:400,code:"UNSUPPORTED_PARAMETER",title:"Unsupported parameter",detail:"This endpoint does not accept query parameters.",requestId:id});
  const key=(await params).key;
  if(!/^[A-Za-z0-9:._-]{1,80}$/.test(key))return problemResponse({status:400,code:"INVALID_ORGANIZATION_KEY",title:"Invalid organization key",detail:"The organization key is invalid.",requestId:id});
  try {
    const body=await getOrganization(getPool(),key);
    if(!body)return problemResponse({status:404,code:"ORGANIZATION_NOT_FOUND",title:"Organization not found",detail:"No active reviewed organization has this key.",requestId:id});
    return jsonResponse(request,body,{requestId:id,cacheControl:"public, max-age=300, s-maxage=3600",etagSeed:`${key}:${JSON.stringify(body)}`});
  } catch (error) {
    console.error("organization lookup failed", { requestId:id,error });
    return problemResponse({status:503,code:"SERVICE_UNAVAILABLE",title:"Service unavailable",detail:"Organization lookup is temporarily unavailable.",requestId:id});
  }
}
