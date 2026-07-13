import type { Metadata } from "next";
import Link from "next/link";
import { getPool } from "@/db/pool";
import { searchOrganizations } from "@/db/organizations";

export const metadata:Metadata={title:"Organizations"};
export const dynamic="force-dynamic";

export default async function OrganizationsPage({searchParams}:{searchParams:Promise<{q?:string;scheme?:string;registry?:string}>}){
  const params=await searchParams,q=params.q?.trim()??"",scheme=params.scheme?.trim()||undefined,registry=params.registry?.trim().toUpperCase()||undefined;
  let data:Awaited<ReturnType<typeof searchOrganizations>>|null=null,unavailable=false;
  if(q.length>=2&&q.length<=100){
    try{data=await searchOrganizations(getPool(),q,10,{scheme,registry});}
    catch(error){unavailable=true;console.error("organization page search failed",{error});}
  }
  return <section className="shell content-page">
    <p className="eyebrow">Reviewed identity links</p><h1>Organizations</h1>
    <p className="lead">Search reviewed legal names and external identifiers. Identity links never replace IEEE address-block assignments and are not created by fuzzy matching.</p>
    <form className="organization-search" method="get">
      <label htmlFor="organization-query">Organization name</label>
      <div className="input-row"><input id="organization-query" name="q" defaultValue={q} minLength={2} maxLength={100} required />
      <button type="submit">Search</button></div>
      <div className="organization-filters">
        <label htmlFor="organization-scheme">Identifier scheme</label>
        <select id="organization-scheme" name="scheme" defaultValue={scheme??""}><option value="">All schemes</option><option value="lei">LEI</option><option value="sec-cik">SEC CIK</option><option value="companies-house">Companies House</option><option value="iana-pen">IANA PEN</option><option value="pci">PCI</option><option value="usb">USB</option></select>
        <label htmlFor="organization-registry">Assignment registry</label>
        <select id="organization-registry" name="registry" defaultValue={registry??""}><option value="">All registries</option><option value="MA-L">MA-L</option><option value="MA-M">MA-M</option><option value="MA-S">MA-S</option><option value="IAB">IAB</option></select>
      </div>
    </form>
    {unavailable&&<div className="problem-card" role="alert"><h2>Organization search is temporarily unavailable</h2><p>Please try again later.</p></div>}
    {data&&<div className="organization-results" aria-live="polite">
      <p>{data.results.length} reviewed organization{data.results.length===1?"":"s"} found.</p>
      {data.results.map((organization)=><article className="result-card" key={organization.organizationKey}>
        <h2><Link href={`/organizations/${encodeURIComponent(organization.organizationKey)}`}>{organization.name}</Link></h2>
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
