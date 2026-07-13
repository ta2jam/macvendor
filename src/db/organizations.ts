import type { Pool } from "pg";

interface IdentityRow {
  organization_key: string; organization_name: string; scheme: string; identifier: string;
  aliases: unknown; registered_names: unknown; source_slug: string; source_release_id: string;
  claim_value: Record<string, unknown>;
}
interface AssignmentRow { organization_key: string; registry: string; prefix_bits: string; prefix_length: number; organization_name: string }

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function prefix(bits: string, length: number): string {
  const width=Math.ceil(length/4), unused=width*4-length;
  return (BigInt(bits) << BigInt(unused)).toString(16).toUpperCase().padStart(width,"0");
}

async function assignments(pool: Pool, keys: string[], registry?: string): Promise<Map<string,{ items: unknown[]; truncated: boolean }>> {
  const result=await pool.query<AssignmentRow>(
    `WITH mappings AS (
       SELECT DISTINCT sr.claim_value->>'organizationKey' AS organization_key,
         jsonb_array_elements_text(sr.claim_value->'registeredNames') AS registered_name
       FROM active_resolution ar
       JOIN resolution_inputs ri ON ri.resolution_run_id=ar.resolution_run_id
       JOIN source_records sr ON sr.source_release_id=ri.source_release_id
       WHERE ar.singleton_id=1 AND sr.record_kind='organization_identity' AND sr.record_status='eligible'
         AND sr.claim_value->>'organizationKey'=ANY($1::text[])
         AND jsonb_typeof(sr.claim_value->'registeredNames')='array'
     )
     SELECT m.organization_key,ra.registry,ra.prefix_bits,ra.prefix_length,ra.organization_name
     FROM mappings m JOIN active_resolution ar ON ar.singleton_id=1
     JOIN resolved_assignments ra ON ra.resolution_run_id=ar.resolution_run_id
       AND lower(ra.organization_name)=lower(m.registered_name)
     WHERE ($2::text IS NULL OR ra.registry=$2)
     ORDER BY m.organization_key,ra.prefix_length DESC,ra.prefix_bits LIMIT 2001`, [keys, registry ?? null],
  );
  const grouped=new Map<string,{items:unknown[];truncated:boolean}>();
  for (const row of result.rows) {
    const group=grouped.get(row.organization_key) ?? {items:[],truncated:false};
    if (group.items.length < 100) group.items.push({ registry:row.registry,prefix:prefix(row.prefix_bits,row.prefix_length),
      prefixLength:row.prefix_length,organizationName:row.organization_name });
    else group.truncated=true;
    grouped.set(row.organization_key,group);
  }
  return grouped;
}

function groupIdentities(rows: IdentityRow[], assignmentMap: Map<string,{items:unknown[];truncated:boolean}>) {
  const groups=new Map<string,IdentityRow[]>();
  for (const row of rows) groups.set(row.organization_key,[...(groups.get(row.organization_key)??[]),row]);
  return [...groups.entries()].map(([organizationKey,items])=>{
    const aliases=[...new Set(items.flatMap((item)=>strings(item.aliases)))].sort();
    const registeredNames=[...new Set(items.flatMap((item)=>strings(item.registered_names)))].sort();
    const matched=assignmentMap.get(organizationKey) ?? {items:[],truncated:false};
    return { organizationKey,name:items[0]!.organization_name,aliases,registeredNames,
      externalIdentifiers:items.map((item)=>({scheme:item.scheme,identifier:item.identifier,
        source:{slug:item.source_slug,sourceReleaseId:`sr_${item.source_release_id}`},details:item.claim_value})),
      assignments:matched.items,assignmentsTruncated:matched.truncated };
  });
}

const IDENTITY_SQL=`SELECT sr.claim_value->>'organizationKey' AS organization_key,
  sr.organization_name_display AS organization_name,sr.claim_value->>'scheme' AS scheme,
  sr.claim_value->>'identifier' AS identifier,sr.claim_value->'aliases' AS aliases,
  sr.claim_value->'registeredNames' AS registered_names,ds.slug AS source_slug,
  sr.source_release_id,sr.claim_value
 FROM active_resolution ar JOIN resolution_inputs ri ON ri.resolution_run_id=ar.resolution_run_id
 JOIN source_records sr ON sr.source_release_id=ri.source_release_id
 JOIN source_releases rel ON rel.id=sr.source_release_id JOIN data_sources ds ON ds.id=rel.source_id
 WHERE ar.singleton_id=1 AND sr.record_kind='organization_identity' AND sr.record_status='eligible'`;

export async function searchOrganizations(pool: Pool, query: string, limit: number,
  filters: { scheme?: string; registry?: string } = {}) {
  const pattern=`%${query.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")}%`;
  const rows=await pool.query<IdentityRow>(`${IDENTITY_SQL}
    AND (sr.organization_name_display ILIKE $1 ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(sr.claim_value->'aliases','[]'::jsonb)) alias WHERE alias ILIKE $1 ESCAPE '\\'
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(sr.claim_value->'registeredNames','[]'::jsonb)) name WHERE name ILIKE $1 ESCAPE '\\'
    )) AND ($3::text IS NULL OR sr.claim_value->>'scheme'=$3)
    ORDER BY CASE ds.slug WHEN 'gleif-lei-identities' THEN 1 WHEN 'sec-edgar-identities' THEN 2
      WHEN 'companies-house-identities' THEN 3 ELSE 4 END, sr.organization_name_display
    LIMIT $2`,[pattern,limit*10,filters.scheme ?? null]);
  const selectedKeys=[...new Set(rows.rows.map((row)=>row.organization_key))].slice(0,limit);
  const selected=rows.rows.filter((row)=>selectedKeys.includes(row.organization_key));
  const results=groupIdentities(selected,await assignments(pool,selectedKeys,filters.registry))
    .filter((organization)=>!filters.registry||organization.assignments.length>0);
  return { query,filters:{scheme:filters.scheme??null,registry:filters.registry??null},results,
    truncated:new Set(rows.rows.map((row)=>row.organization_key)).size>limit };
}

export async function getOrganization(pool: Pool, organizationKey: string) {
  const rows=await pool.query<IdentityRow>(`${IDENTITY_SQL} AND sr.claim_value->>'organizationKey'=$1
    ORDER BY CASE ds.slug WHEN 'gleif-lei-identities' THEN 1 WHEN 'sec-edgar-identities' THEN 2
      WHEN 'companies-house-identities' THEN 3 ELSE 4 END`,[organizationKey]);
  if (!rows.rows.length) return null;
  return groupIdentities(rows.rows,await assignments(pool,[organizationKey]))[0]!;
}
