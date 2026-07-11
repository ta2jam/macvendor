import type { Pool } from "pg";

export type SourceHealthSeverity = "failure" | "warning";

export interface SourceHealthFinding {
  severity: SourceHealthSeverity;
  code:
    | "NO_VALID_RELEASE"
    | "REFERENCE_CANNOT_PUBLISH"
    | "REQUIRED_SOURCE_NOT_ACTIVE"
    | "ACTIVE_RELEASE_NOT_VALID"
    | "ACTIVE_SOURCE_NOT_PRODUCTION"
    | "ACTIVE_CONFIG_CHANGED"
    | "RIGHTS_STATUS_BLOCKED"
    | "RIGHTS_SCOPE_BLOCKED"
    | "RIGHTS_REVIEW_EXPIRED"
    | "RIGHTS_REVIEW_EXPIRING"
    | "SOURCE_STALE"
    | "FUTURE_FETCH_TIME"
    | "FRESHNESS_LIMIT_MISSING";
  detail: string;
}

export interface SourceHealthRow {
  slug: string;
  source_class: "authoritative" | "enrichment" | "owner_curated" | "reference";
  publish_mode: "disabled" | "qa_only" | "production";
  config_version: string;
  required_for_activation: boolean;
  max_acceptable_age_seconds: number | null;
  rights_status: "unreviewed" | "owner_asserted" | "approved" | "rejected" | "expired";
  rights_basis: "owner_created" | "licensed" | "permission_granted" | "public_domain_claim" | "unknown";
  distribution_scope: "internal_only" | "api_output" | "raw_redistribution";
  rights_review_reference: string | null;
  rights_review_expires_at: Date | null;
  active_source_release_id: string | null;
  active_release_status: string | null;
  active_fetched_at: Date | null;
  active_config_version: string | null;
  latest_valid_release_id: string | null;
  latest_valid_fetched_at: Date | null;
}

export interface SourceHealthResult {
  slug: string;
  sourceClass: SourceHealthRow["source_class"];
  publishMode: SourceHealthRow["publish_mode"];
  requiredForActivation: boolean;
  activeReleaseId: string | null;
  latestValidReleaseId: string | null;
  monitoredFetchedAt: string | null;
  ageSeconds: number | null;
  maxAcceptableAgeSeconds: number | null;
  rightsStatus: SourceHealthRow["rights_status"];
  rightsBasis: SourceHealthRow["rights_basis"];
  distributionScope: SourceHealthRow["distribution_scope"];
  rightsReviewExpiresAt: string | null;
  currentConfigVersion: number;
  activeConfigVersion: number | null;
  activeConfigChanged: boolean;
  findings: SourceHealthFinding[];
}

export interface SourceGovernanceReport {
  healthy: boolean;
  checkedAt: string;
  warningWindowDays: number;
  summary: {
    sources: number;
    failures: number;
    warnings: number;
  };
  sources: SourceHealthResult[];
}

function finding(severity: SourceHealthSeverity, code: SourceHealthFinding["code"], detail: string): SourceHealthFinding {
  return { severity, code, detail };
}

function evaluateSource(row: SourceHealthRow, now: Date, warningWindowMs: number): SourceHealthResult {
  const findings: SourceHealthFinding[] = [];
  if (row.source_class === "reference") {
    findings.push(finding("failure", "REFERENCE_CANNOT_PUBLISH", "reference sources cannot be production publishers"));
  }
  const ownerCreated = row.rights_basis === "owner_created";
  if (ownerCreated) {
    if (row.rights_status !== "owner_asserted" && row.rights_status !== "approved") {
      findings.push(finding("failure", "RIGHTS_STATUS_BLOCKED", "owner-created source rights are not asserted or approved"));
    }
  } else if (row.rights_status !== "approved" || !row.rights_review_reference) {
    findings.push(finding("failure", "RIGHTS_STATUS_BLOCKED", "third-party source lacks approved rights and a review reference"));
  }
  if (row.distribution_scope !== "api_output") {
    findings.push(finding("failure", "RIGHTS_SCOPE_BLOCKED", "source is not approved for public API output"));
  }

  const rightsExpiry = row.rights_review_expires_at?.getTime() ?? null;
  if (rightsExpiry !== null && rightsExpiry <= now.getTime()) {
    findings.push(finding("failure", "RIGHTS_REVIEW_EXPIRED", "rights review has expired"));
  } else if (rightsExpiry !== null && rightsExpiry - now.getTime() <= warningWindowMs) {
    findings.push(finding("warning", "RIGHTS_REVIEW_EXPIRING", "rights review expires inside the warning window"));
  }

  let ageSeconds: number | null = null;
  const monitoredReleaseId = row.active_source_release_id ?? row.latest_valid_release_id;
  const monitoredFetchedAt = row.active_fetched_at ?? row.latest_valid_fetched_at;
  if (row.required_for_activation && !row.active_source_release_id && row.latest_valid_release_id) {
    findings.push(finding("failure", "REQUIRED_SOURCE_NOT_ACTIVE", "required source is not an input to the active resolution"));
  }
  if (row.active_source_release_id && row.active_release_status !== "valid") {
    findings.push(finding("failure", "ACTIVE_RELEASE_NOT_VALID", "active resolution references a source release that is no longer valid"));
  }
  if (row.active_source_release_id && row.publish_mode !== "production") {
    findings.push(finding("failure", "ACTIVE_SOURCE_NOT_PRODUCTION", "active resolution references a source that is no longer a production publisher"));
  }
  const currentConfigVersion = Number(row.config_version);
  const activeConfigVersion = row.active_config_version === null ? null : Number(row.active_config_version);
  const activeConfigChanged = activeConfigVersion !== null && activeConfigVersion !== currentConfigVersion;
  if (activeConfigChanged) {
    findings.push(finding("warning", "ACTIVE_CONFIG_CHANGED", "active resolution was built with an older source configuration and requires a rebuild"));
  }
  if (!monitoredReleaseId || !monitoredFetchedAt) {
    findings.push(finding(
      row.required_for_activation ? "failure" : "warning",
      "NO_VALID_RELEASE",
      "source has no valid release",
    ));
  } else {
    ageSeconds = Math.floor((now.getTime() - monitoredFetchedAt.getTime()) / 1_000);
    if (ageSeconds < -300) {
      findings.push(finding("failure", "FUTURE_FETCH_TIME", "latest release fetched_at is more than five minutes in the future"));
    } else if (row.max_acceptable_age_seconds === null) {
      findings.push(finding("warning", "FRESHNESS_LIMIT_MISSING", "source has no maximum acceptable age"));
    } else if (ageSeconds > row.max_acceptable_age_seconds) {
      findings.push(finding("failure", "SOURCE_STALE", "monitored release exceeds its maximum acceptable age"));
    }
  }

  return {
    slug: row.slug,
    sourceClass: row.source_class,
    publishMode: row.publish_mode,
    requiredForActivation: row.required_for_activation,
    activeReleaseId: row.active_source_release_id,
    latestValidReleaseId: row.latest_valid_release_id,
    monitoredFetchedAt: monitoredFetchedAt?.toISOString() ?? null,
    ageSeconds,
    maxAcceptableAgeSeconds: row.max_acceptable_age_seconds,
    rightsStatus: row.rights_status,
    rightsBasis: row.rights_basis,
    distributionScope: row.distribution_scope,
    rightsReviewExpiresAt: row.rights_review_expires_at?.toISOString() ?? null,
    currentConfigVersion,
    activeConfigVersion,
    activeConfigChanged,
    findings,
  };
}

export function evaluateSourceGovernance(
  rows: SourceHealthRow[],
  options: { now?: Date; warningWindowDays?: number } = {},
): SourceGovernanceReport {
  const now = options.now ?? new Date();
  const warningWindowDays = options.warningWindowDays ?? 30;
  if (!Number.isInteger(warningWindowDays) || warningWindowDays < 1 || warningWindowDays > 365) {
    throw new Error("warningWindowDays must be an integer from 1 to 365");
  }
  const sources = [...rows]
    .sort((left, right) => left.slug.localeCompare(right.slug, "en"))
    .map((row) => evaluateSource(row, now, warningWindowDays * 86_400_000));
  const allFindings = sources.flatMap((source) => source.findings);
  const failures = allFindings.filter((item) => item.severity === "failure").length;
  const warnings = allFindings.length - failures;
  return {
    healthy: failures === 0,
    checkedAt: now.toISOString(),
    warningWindowDays,
    summary: { sources: sources.length, failures, warnings },
    sources,
  };
}

export async function checkSourceGovernance(
  pool: Pool,
  options: { now?: Date; warningWindowDays?: number } = {},
): Promise<SourceGovernanceReport> {
  const result = await pool.query<SourceHealthRow>(
    `SELECT ds.slug, ds.source_class, ds.publish_mode, ds.config_version,
       ds.required_for_activation,
       ds.max_acceptable_age_seconds, ds.rights_status, ds.rights_basis,
       ds.distribution_scope, ds.rights_review_reference,
       ds.rights_review_expires_at,
       active.id AS active_source_release_id,
       active.status AS active_release_status,
       COALESCE(active.observed_at, active.fetched_at) AS active_fetched_at,
       active.config_version AS active_config_version,
       latest.id AS latest_valid_release_id,
       COALESCE(latest.observed_at, latest.fetched_at) AS latest_valid_fetched_at
     FROM data_sources ds
     LEFT JOIN LATERAL (
       SELECT sr.id, sr.status, sr.fetched_at, observation.observed_at,
         ri.source_config_snapshot->>'configVersion' AS config_version
       FROM active_resolution ar
       JOIN resolution_inputs ri ON ri.resolution_run_id = ar.resolution_run_id
       JOIN source_releases sr ON sr.id = ri.source_release_id
       LEFT JOIN LATERAL (
         SELECT observed_at FROM source_fetch_observations sfo
         WHERE sfo.source_release_id = sr.id ORDER BY observed_at DESC LIMIT 1
       ) observation ON true
       WHERE ar.singleton_id = 1 AND sr.source_id = ds.id
       LIMIT 1
     ) active ON true
     LEFT JOIN LATERAL (
       SELECT sr.id, sr.fetched_at, observation.observed_at
       FROM source_releases sr
       LEFT JOIN LATERAL (
         SELECT observed_at FROM source_fetch_observations sfo
         WHERE sfo.source_release_id = sr.id ORDER BY observed_at DESC LIMIT 1
       ) observation ON true
       WHERE sr.source_id = ds.id AND sr.status = 'valid'
       ORDER BY sr.validated_at DESC, sr.id DESC
       LIMIT 1
     ) latest ON true
     WHERE ds.publish_mode = 'production' OR active.id IS NOT NULL
     ORDER BY ds.slug`,
  );
  return evaluateSourceGovernance(result.rows, options);
}
