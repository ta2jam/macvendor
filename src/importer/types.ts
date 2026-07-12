export type SourceClass = "authoritative" | "enrichment" | "owner_curated" | "reference";
export type PublishMode = "production" | "qa_only" | "disabled";
export type RightsStatus = "unreviewed" | "owner_asserted" | "approved" | "rejected" | "expired";
export type RightsBasis = "owner_created" | "licensed" | "permission_granted" | "public_domain_claim" | "unknown";
export type DistributionScope = "internal_only" | "api_output" | "raw_redistribution";
export type RecordKind = "assignment" | "curated_vendor_claim" | "vendor_alias" | "device_hint" | "usage_note" | "tombstone" | "organization_identity";
export type OriginType = "owner_observation" | "derived" | "imported" | "unknown";
export type VerificationStatus = "unverified" | "single_observation" | "corroborated" | "reviewed";
export type Registry = "MA-L" | "MA-M" | "MA-S" | "IAB" | "CID";

export interface SourceManifest {
  schemaVersion: "macvendor-source/v1";
  source: {
    slug: string;
    name: string;
    class: SourceClass;
    publishMode: PublishMode;
    adapterKey: string;
    fetchPolicy?: "scheduled" | "manual";
    fetchIntervalSeconds?: number;
    maxAcceptableAgeSeconds?: number;
    requiredForActivation: boolean;
    homepageUrl?: string;
    termsUrl?: string;
    rights: {
      status: RightsStatus;
      basis: RightsBasis;
      distributionScope: DistributionScope;
      reviewReference?: string;
      reviewExpiresAt?: string;
    };
  };
  release: {
    snapshotKind: "full_snapshot" | "delta";
    snapshotComplete: boolean;
    schemaVersion: string;
    adapterVersion: string;
    normalizerVersion: string;
    diffPolicy?: {
      maxAddedPercent: number;
      maxRemovedPercent: number;
    };
  };
  artifact: {
    path: string;
    format: "csv" | "tsv" | "jsonl";
    sha256: string;
    signatureStatus: "verified" | "unverified" | "not_applicable";
    signature?: {
      algorithm: "ed25519";
      path: string;
      publicKeyPath: string;
      publicKeySha256: string;
      origin?: "upstream" | "operator";
      url?: string;
    };
    remote?: {
      url: string;
      allowedOrigins: string[];
      maxRedirects: number;
    };
  };
  defaults: {
    recordKind: RecordKind;
    originType: OriginType;
    rightsBasis: RightsBasis;
    distributionScope: DistributionScope;
    verificationStatus: VerificationStatus;
    registry?: Registry;
  };
}

export interface ParsedSourceRecord {
  recordKind: RecordKind;
  recordStatus: "eligible" | "qa_only";
  registry: Registry | null;
  prefixBits: bigint | null;
  prefixLength: number | null;
  organizationName: string | null;
  organizationAddress: string | null;
  isPrivate: boolean;
  claimValue: Record<string, unknown>;
  originType: OriginType;
  rightsBasis: RightsBasis;
  distributionScope: DistributionScope;
  verificationStatus: VerificationStatus;
  reviewedBy: string | null;
  evidenceReference: string | null;
  privacyReviewReference: string | null;
  observedAt: string | null;
  rawRecordHash: string;
  rawLocator: string;
}
