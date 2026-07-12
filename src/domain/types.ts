export type VerificationStatus = "reviewed" | "corroborated" | "single_observation" | "unverified";
export type OriginType = "owner_observation" | "derived" | "imported";
export type ConflictStatus = "agrees" | "conflicts" | "no_official_match" | "not_evaluated";

export interface ReleaseData {
  resolvedReleaseId: string;
  activeVersion: number;
  publicationVersion: number;
  policyVersion: string;
  generatedAt: string;
}

export interface Assignment {
  prefix: string;
  prefixLength: number;
  registry: string;
  organizationName: string | null;
  address: string | null;
  source: {
    slug: string;
    sourceReleaseId: string;
  };
}

export interface CuratedMatch {
  claimId: string;
  prefix: string;
  prefixLength: number;
  claimType: "vendor_label";
  organizationName: string;
  verificationStatus: VerificationStatus;
  originType: OriginType;
  conflictStatus: ConflictStatus;
  source: {
    slug: string;
    sourceReleaseId: string;
  };
}

export interface LookupInsight {
  claimId: string;
  prefix: string;
  prefixLength: number;
  claimType: "vendor_alias" | "device_hint" | "usage_note";
  organizationName: string | null;
  details: Record<string, unknown>;
  verificationStatus: VerificationStatus;
  source: {
    slug: string;
    sourceReleaseId: string;
  };
}

export interface LookupResult {
  assignment: Assignment | null;
  curatedMatches: CuratedMatch[];
  curatedMatchesTruncated: boolean;
  insights: LookupInsight[];
  insightsTruncated: boolean;
  data: ReleaseData;
}
