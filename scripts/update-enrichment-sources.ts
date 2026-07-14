import "./env";
import path from "node:path";
import { getPool } from "../src/db/pool";
import { importSourceRelease } from "../src/importer/import-source";
import { loadManifest } from "../src/importer/manifest";
import { activateResolution } from "../src/resolver/activation";
import { buildResolution } from "../src/resolver/build";
import { checkSourceGovernance } from "../src/operations/source-health";
import { prepareEnrichmentSources } from "../src/sources/prepare-enrichments";
import { DATA_RELEASE_SURROGATE_KEY,purgeSurrogateKeys,resolutionSurrogateKey } from "../src/cache/surrogate";
import { RESOLUTION_POLICY_REVISION,RESOLUTION_POLICY_VERSION } from "../src/resolver/policy";
import { readActiveSourceInputSnapshot,SOURCE_PUBLICATION_LOCK } from "../src/operations/source-publication";

const values=new Map<string,string>();
for(let index=0;index<process.argv.slice(2).length;index+=2){
  const key=process.argv.slice(2)[index],value=process.argv.slice(2)[index+1];
  if(!key?.startsWith("--")||!value||value.startsWith("--")||values.has(key))throw new Error("invalid arguments");
  values.set(key,value);
}
const ieeeDirectory=values.get("--ieee-dir");
if(!ieeeDirectory)throw new Error("Usage: npm run source:update:enrichments -- --ieee-dir path [--output path]");
const pool=getPool();
const actor=process.env.OPERATOR_ACTOR_ID??"cli:enrichment-update";
const lock=await pool.connect();
try{
  const acquired=await lock.query<{acquired:boolean}>("SELECT pg_try_advisory_lock($1) AS acquired",[SOURCE_PUBLICATION_LOCK]);
  if(!acquired.rows[0]?.acquired){console.log(JSON.stringify({status:"already_running"}));process.exit(0);}
  const prepared=await prepareEnrichmentSources({ieeeDirectory:path.resolve(ieeeDirectory),
    output:values.get("--output")?path.resolve(values.get("--output")!):undefined,
    privateKeyPath:values.get("--private-key")?path.resolve(values.get("--private-key")!):undefined,
    publicKeyPath:values.get("--public-key")?path.resolve(values.get("--public-key")!):undefined,
    mappingPath:values.get("--mapping")?path.resolve(values.get("--mapping")!):undefined,
    identityMappingPath:values.get("--identity-mapping")?path.resolve(values.get("--identity-mapping")!):undefined});
  const imports=[];
  for(const source of prepared.sources){
    const imported=await importSourceRelease(pool,source.manifestPath);
    imports.push({...imported,slug:source.slug,manifestPath:source.manifestPath});
  }
  const slugs=imports.map((item)=>item.slug);
  const inputSnapshot=await readActiveSourceInputSnapshot(lock,slugs);
  const observedAt=new Date(prepared.preparedAt);
  await lock.query("BEGIN");
  try{
    for(const item of imports){
      const manifest=await loadManifest(item.manifestPath);
      await lock.query(`INSERT INTO source_fetch_observations(source_release_id,observed_at,source_url,actor_id,metadata)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_release_id,observed_at) DO NOTHING`,
      [item.sourceReleaseId,observedAt,manifest.source.homepageUrl??manifest.source.termsUrl??"https://macvendor.io/data-sources",
        actor,JSON.stringify({sourceSlug:item.slug,recordCount:item.recordCount})]);
    }
    await lock.query("COMMIT");
  }catch(error){await lock.query("ROLLBACK");throw error;}
  const build=await buildResolution(pool,{sourceReleaseIds:[...imports.map((item)=>item.sourceReleaseId),...inputSnapshot.retainedSourceReleaseIds],
    policyVersion:RESOLUTION_POLICY_VERSION,policyCommitSha:RESOLUTION_POLICY_REVISION,
    containerImageDigest:process.env.BUILD_IMAGE_DIGEST??"local",now:observedAt});
  if(build.status==="rejected")throw new Error("enrichment resolution was rejected");
  const activation=await activateResolution(pool,build.resolutionRunId,{actorId:actor,
    expectedPreviousResolutionRunId:inputSnapshot.baseResolutionRunId});
  const cachePurge=activation.status==="already_active"?{status:"skipped",reason:"no_change"}:await purgeSurrogateKeys([
    ...(activation.previousResolutionRunId?[resolutionSurrogateKey(activation.previousResolutionRunId)]:[]),DATA_RELEASE_SURROGATE_KEY]);
  const health=await checkSourceGovernance(pool);
  if(!health.healthy)throw new Error("source governance is unhealthy after enrichment activation");
  console.log(JSON.stringify({status:"updated",prepared,imports,build,activation,cachePurge,health:health.summary},null,2));
}finally{
  await lock.query("SELECT pg_advisory_unlock($1)",[SOURCE_PUBLICATION_LOCK]).catch(()=>undefined);lock.release();await pool.end();
}
