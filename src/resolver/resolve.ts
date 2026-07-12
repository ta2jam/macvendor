import { canonicalJson, sha256 } from "@/domain/canonical-json";

export interface ResolverRecord {
  id: string;
  sourceReleaseId: string;
  sourceSlug: string;
  sourceClass: "authoritative" | "enrichment" | "owner_curated";
  recordKind: "assignment" | "curated_vendor_claim" | "vendor_alias" | "device_hint" | "usage_note" | "tombstone";
  registry: "MA-L" | "MA-M" | "MA-S" | "IAB" | "CID" | null;
  prefixBits: bigint;
  prefixLength: number;
  organizationName: string | null;
  organizationAddress: string | null;
  isPrivate: boolean;
  claimValue: Record<string, unknown>;
  originType: "owner_observation" | "derived" | "imported";
  verificationStatus: "unverified" | "single_observation" | "corroborated" | "reviewed";
  rawRecordHash: string;
}

export interface ResolvedAssignmentDraft {
  registry: "MA-L" | "MA-M" | "MA-S" | "IAB" | "CID";
  prefixBits: bigint;
  prefixLength: number;
  organizationName: string | null;
  organizationAddress: string | null;
  isPrivate: boolean;
  core: ResolverRecord;
  evidence: Array<{ record: ResolverRecord; role: "selected" | "corroborating" }>;
}

export interface ResolvedClaimDraft {
  claimType: "curated_vendor_claim" | "vendor_alias" | "device_hint" | "usage_note";
  prefixBits: bigint;
  prefixLength: number;
  claimValue: Record<string, unknown>;
  organizationName: string | null;
  verificationStatus: "unverified" | "single_observation" | "corroborated" | "reviewed";
  originType: "owner_observation" | "derived" | "imported";
  conflictStatus: "agrees" | "conflicts" | "no_official_match" | "not_evaluated";
  source: ResolverRecord;
}

export interface ResolutionConflict {
  prefixBits: string;
  prefixLength: number;
  records: Array<{ sourceSlug: string; registry: string | null; organizationName: string | null; rawRecordHash: string }>;
}

export interface ResolutionDraft {
  assignments: ResolvedAssignmentDraft[];
  claims: ResolvedClaimDraft[];
  conflicts: ResolutionConflict[];
  outputHash: string;
}

function compareRecord(left: ResolverRecord, right: ResolverRecord): number {
  return left.sourceSlug.localeCompare(right.sourceSlug, "en")
    || left.rawRecordHash.localeCompare(right.rawRecordHash, "en")
    || left.id.localeCompare(right.id, "en");
}

function organizationKey(value: string | null): string {
  return value?.normalize("NFC").trim().toUpperCase() ?? "";
}

function assignmentSemantic(record: ResolverRecord): string {
  return canonicalJson({
    registry: record.registry,
    organizationName: record.organizationName,
    organizationAddress: record.organizationAddress,
    isPrivate: record.isPrivate,
  });
}

function assignmentGroupKey(record: ResolverRecord): string {
  return record.registry === "CID"
    ? `CID:${record.prefixLength}:${record.prefixBits}`
    : `EUI:${record.prefixLength}:${record.prefixBits}`;
}

function claimGroupKey(record: ResolverRecord): string {
  return canonicalJson({ recordKind:record.recordKind,prefixBits:record.prefixBits.toString(),
    prefixLength:record.prefixLength,organizationName:organizationKey(record.organizationName) });
}

function claimVerification(record: ResolverRecord, corroboration: Map<string,Set<string>>): ResolvedClaimDraft["verificationStatus"] {
  if (record.verificationStatus === "reviewed") return "reviewed";
  if ((corroboration.get(claimGroupKey(record))?.size??0) >= 2) return "corroborated";
  return record.verificationStatus === "unverified" ? "unverified" : "single_observation";
}

function assignmentLookupKey(length:number,bits:bigint):string { return `${length}:${bits}`; }

function matchingAssignment(claim: ResolverRecord, index:Map<string,ResolvedAssignmentDraft>, lengths:number[]): ResolvedAssignmentDraft | null {
  for(const length of lengths){
    if(length>claim.prefixLength)continue;
    const bits=claim.prefixBits>>BigInt(claim.prefixLength-length);
    const match=index.get(assignmentLookupKey(length,bits));
    if(match)return match;
  }
  return null;
}

export function resolveRecords(records: ResolverRecord[]): ResolutionDraft {
  const eligible = [...records].sort(compareRecord);
  const assignmentRecords = eligible.filter((record) =>
    record.recordKind === "assignment" && record.sourceClass === "authoritative");
  const groups = new Map<string, ResolverRecord[]>();
  for (const record of assignmentRecords) {
    const key = assignmentGroupKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const assignments: ResolvedAssignmentDraft[] = [];
  const conflicts: ResolutionConflict[] = [];
  for (const group of [...groups.values()].sort((left, right) =>
    left[0]!.prefixLength - right[0]!.prefixLength || (left[0]!.prefixBits < right[0]!.prefixBits ? -1 : 1))) {
    const semantics = new Set(group.map(assignmentSemantic));
    if (semantics.size !== 1) {
      conflicts.push({
        prefixBits: group[0]!.prefixBits.toString(),
        prefixLength: group[0]!.prefixLength,
        records: group.map((record) => ({
          sourceSlug: record.sourceSlug,
          registry: record.registry,
          organizationName: record.organizationName,
          rawRecordHash: record.rawRecordHash,
        })),
      });
      continue;
    }
    const [core, ...rest] = [...group].sort(compareRecord);
    assignments.push({
      registry: core.registry!,
      prefixBits: core.prefixBits,
      prefixLength: core.prefixLength,
      organizationName: core.organizationName,
      organizationAddress: core.organizationAddress,
      isPrivate: core.isPrivate,
      core,
      evidence: [
        { record: core, role: "selected" },
        ...rest.map((record) => ({ record, role: "corroborating" as const })),
      ],
    });
  }

  const claimRecords = eligible.filter((record) =>
    ["curated_vendor_claim", "vendor_alias", "device_hint", "usage_note"].includes(record.recordKind));
  const assignmentIndex=new Map(assignments.filter((assignment)=>assignment.registry!=="CID")
    .map((assignment)=>[assignmentLookupKey(assignment.prefixLength,assignment.prefixBits),assignment]));
  const assignmentLengths=[...new Set(assignments.filter((assignment)=>assignment.registry!=="CID")
    .map((assignment)=>assignment.prefixLength))].sort((left,right)=>right-left);
  const corroboration=new Map<string,Set<string>>();
  for(const record of claimRecords){
    const key=claimGroupKey(record),sources=corroboration.get(key)??new Set<string>();
    sources.add(record.sourceSlug);corroboration.set(key,sources);
  }
  const claims: ResolvedClaimDraft[] = claimRecords.map((record) => {
    const official = matchingAssignment(record, assignmentIndex, assignmentLengths);
    const evaluatesOrganization = record.recordKind === "curated_vendor_claim";
    const conflictStatus = !evaluatesOrganization
      ? "not_evaluated"
      : !official
        ? "no_official_match"
        : organizationKey(official.organizationName) === organizationKey(record.organizationName)
          ? "agrees"
          : "conflicts";
    return {
      claimType: record.recordKind as ResolvedClaimDraft["claimType"],
      prefixBits: record.prefixBits,
      prefixLength: record.prefixLength,
      claimValue: record.claimValue,
      organizationName: record.organizationName,
      verificationStatus: claimVerification(record, corroboration),
      originType: record.originType,
      conflictStatus,
      source: record,
    };
  });

  const semanticOutput = {
    assignments: assignments.map((assignment) => ({
      registry: assignment.registry,
      prefixBits: assignment.prefixBits.toString(),
      prefixLength: assignment.prefixLength,
      organizationName: assignment.organizationName,
      organizationAddress: assignment.organizationAddress,
      isPrivate: assignment.isPrivate,
      coreSourceSlug: assignment.core.sourceSlug,
      coreSourceRecordHash: assignment.core.rawRecordHash,
      evidence: assignment.evidence.map((item) => ({
        sourceSlug: item.record.sourceSlug,
        sourceRecordHash: item.record.rawRecordHash,
        role: item.role,
      })),
    })),
    claims: claims.map((claim) => ({
      claimType: claim.claimType,
      prefixBits: claim.prefixBits.toString(),
      prefixLength: claim.prefixLength,
      claimValue: claim.claimValue,
      organizationName: claim.organizationName,
      verificationStatus: claim.verificationStatus,
      originType: claim.originType,
      conflictStatus: claim.conflictStatus,
      sourceSlug: claim.source.sourceSlug,
      sourceRecordHash: claim.source.rawRecordHash,
    })),
  };
  return { assignments, claims, conflicts, outputHash: sha256(canonicalJson(semanticOutput)) };
}
