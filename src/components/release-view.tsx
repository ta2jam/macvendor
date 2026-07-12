"use client";

import { useEffect, useState } from "react";

interface ReleaseSource {
  slug: string;
  sourceReleaseId: string;
  observedAt: string;
  sourceClass: "authoritative" | "enrichment" | "owner_curated";
  recordCount: number;
  rightsScope: "internal_only" | "api_output" | "raw_redistribution";
  rightsStatusAtBuild: string;
  currentRightsStatus: string;
  rightsReviewExpiresAt: string | null;
  configVersion: number;
  configVersionAtBuild: number;
  configChangedSinceBuild: boolean;
}

interface DataRelease {
  resolvedReleaseId: string;
  activeVersion: number;
  publicationVersion: number;
  policyVersion: string;
  outputSha256: string;
  generatedAt: string;
  sources: ReleaseSource[];
}

const sourceClassLabels: Record<ReleaseSource["sourceClass"], string> = {
  authoritative: "Authoritative",
  enrichment: "Enrichment",
  owner_curated: "Owner-curated",
};

const dateTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

function displayDate(value: string): string {
  return dateTime.format(new Date(value));
}

export function ReleaseView({ sourcesOnly = false }: { sourcesOnly?: boolean }) {
  const [data, setData] = useState<DataRelease | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/v1/data-release")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail ?? "Data release could not be loaded");
        setData(body as DataRelease);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <div className="problem-card" role="alert"><strong>Data release could not be loaded</strong><p>{error}</p></div>;
  if (!data) return <p className="loading-line" role="status">Loading the active data release…</p>;

  const totalRecords = data.sources.reduce((total, source) => total + source.recordCount, 0);
  return (
    <section className="release-summary" aria-label="Active data sources">
      {!sourcesOnly && (
        <div className="release-metrics">
          <article><span>Active version</span><strong>#{data.activeVersion}</strong></article>
          <article><span>Publication</span><strong>#{data.publicationVersion}</strong></article>
          <article><span>Sources</span><strong>{data.sources.length}</strong></article>
          <article aria-label="Total records"><span>Records</span><strong>{totalRecords.toLocaleString("en-US")}</strong></article>
        </div>
      )}

      {!sourcesOnly && (
        <dl className="release-identity">
          <div><dt>Resolution</dt><dd>{data.resolvedReleaseId}</dd></div>
          <div><dt>Policy</dt><dd>{data.policyVersion}</dd></div>
          <div><dt>Generated at</dt><dd>{displayDate(data.generatedAt)}</dd></div>
          <div><dt>Output SHA-256</dt><dd>{data.outputSha256}</dd></div>
        </dl>
      )}

      <div className="live-source-list">
        {data.sources.map((source) => (
          <article className="live-source-card" key={source.sourceReleaseId}>
            <div className="live-source-heading">
              <div>
                <span className={`source-dot ${source.sourceClass === "owner_curated" ? "curated" : "authoritative"}`} aria-hidden="true" />
                <h2>{source.slug}</h2>
              </div>
              <span className={source.configChangedSinceBuild ? "status-chip warning" : "status-chip healthy"}>
                {source.configChangedSinceBuild ? "Rebuild required" : "Active"}
              </span>
            </div>
            <p>{sourceClassLabels[source.sourceClass]} · {source.recordCount.toLocaleString("en-US")} records</p>
            <dl>
              <div><dt>Last observed</dt><dd>{displayDate(source.observedAt)}</dd></div>
              <div><dt>Rights status</dt><dd>{source.currentRightsStatus}</dd></div>
              <div><dt>API scope</dt><dd>{source.rightsScope}</dd></div>
              <div><dt>Config</dt><dd>build {source.configVersionAtBuild} / current {source.configVersion}</dd></div>
              {source.rightsReviewExpiresAt && <div><dt>Rights review</dt><dd>{displayDate(source.rightsReviewExpiresAt)}</dd></div>}
            </dl>
          </article>
        ))}
      </div>

      {!sourcesOnly && (
        <details className="raw-release">
          <summary>Show raw API response</summary>
          <pre className="json-view" tabIndex={0} aria-label="Active data release JSON response">{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
