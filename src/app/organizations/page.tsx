import type { Metadata } from "next";
import Link from "next/link";
import { getPool } from "@/db/pool";
import { searchOrganizations } from "@/db/organizations";

export const metadata:Metadata={title:"Organizations"};
export const dynamic="force-dynamic";

export default async function OrganizationsPage({searchParams}:{searchParams:Promise<{q?:string}>}){
  const q=(await searchParams).q?.trim()??"";
  const data=q.length>=2&&q.length<=100?await searchOrganizations(getPool(),q,10):null;
  return <section className="shell content-page">
    <p className="eyebrow">Reviewed identity links</p><h1>Organizations</h1>
    <p className="lead">Search reviewed legal names and external identifiers. Identity links never replace IEEE address-block assignments and are not created by fuzzy matching.</p>
    <form className="organization-search" method="get">
      <label htmlFor="organization-query">Organization name</label>
      <div className="input-row"><input id="organization-query" name="q" defaultValue={q} minLength={2} maxLength={100} required />
      <button type="submit">Search</button></div>
    </form>
    {data&&<div className="organization-results" aria-live="polite">
      <p>{data.results.length} reviewed organization{data.results.length===1?"":"s"} found.</p>
      {data.results.map((organization)=><article className="result-card" key={organization.organizationKey}>
        <h2><Link href={`/v1/organizations/${encodeURIComponent(organization.organizationKey)}`}>{organization.name}</Link></h2>
        <p><code>{organization.organizationKey}</code> · {organization.externalIdentifiers.map((item)=>`${item.scheme}: ${item.identifier}`).join(" · ")}</p>
        <p>{organization.assignments.length} matching assignment{organization.assignments.length===1?"":"s"}{organization.assignmentsTruncated?" shown (truncated)":""}.</p>
        <ul>{organization.assignments.slice(0,12).map((item,index)=>{
          const assignment=item as {registry:string;prefix:string;prefixLength:number};
          return <li key={`${assignment.registry}:${assignment.prefix}:${index}`}><code>{assignment.prefix}/{assignment.prefixLength}</code> {assignment.registry}</li>;
        })}</ul>
      </article>)}
    </div>}
  </section>;
}
