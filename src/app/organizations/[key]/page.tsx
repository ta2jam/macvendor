import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPool } from "@/db/pool";
import { getOrganization } from "@/db/organizations";

export const metadata: Metadata = { title: "Organization details" };
export const dynamic = "force-dynamic";

export default async function OrganizationPage({params}:{params:Promise<{key:string}>}) {
  const key=(await params).key;
  if(!/^[A-Za-z0-9:._-]{1,80}$/.test(key))notFound();
  const organization=await getOrganization(getPool(),key);
  if(!organization)notFound();
  return <section className="shell content-page">
    <p className="eyebrow">Reviewed identity</p><h1>{organization.name}</h1>
    <p className="lead">Identifiers are reviewed links. They do not replace IEEE registrations or prove ownership of a physical device.</p>
    <dl className="release-identity">
      <div><dt>Organization key</dt><dd>{organization.organizationKey}</dd></div>
      <div><dt>Aliases</dt><dd>{organization.aliases.join(", ")||"None"}</dd></div>
      <div><dt>Registered names</dt><dd>{organization.registeredNames.join(", ")||"None"}</dd></div>
      <div><dt>Matching assignments</dt><dd>{organization.assignments.length}{organization.assignmentsTruncated?"+":""}</dd></div>
    </dl>
    <h2>External identifiers</h2><div className="live-source-list">{organization.externalIdentifiers.map((item)=><article className="live-source-card" key={`${item.scheme}:${item.identifier}`}><h3>{item.scheme}</h3><p><code>{item.identifier}</code></p><p>Source: {item.source.slug}</p></article>)}</div>
    <h2>Address-block assignments</h2><ul>{organization.assignments.map((raw,index)=>{const item=raw as {registry:string;prefix:string;prefixLength:number;organizationName:string};return <li key={`${item.registry}:${item.prefix}:${index}`}><code>{item.prefix}/{item.prefixLength}</code> {item.registry} — {item.organizationName}</li>;})}</ul>
  </section>;
}
