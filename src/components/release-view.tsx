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
  enrichment: "Zenginleştirme",
  owner_curated: "Owner-curated",
};

const dateTime = new Intl.DateTimeFormat("tr-TR", {
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
        if (!response.ok) throw new Error(body.detail ?? "Veri sürümü alınamadı");
        setData(body as DataRelease);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <div className="problem-card" role="alert"><strong>Veri sürümü alınamadı</strong><p>{error}</p></div>;
  if (!data) return <p className="loading-line" role="status">Aktif veri sürümü okunuyor…</p>;

  const totalRecords = data.sources.reduce((total, source) => total + source.recordCount, 0);
  return (
    <section className="release-summary" aria-label="Aktif veri kaynakları">
      {!sourcesOnly && (
        <div className="release-metrics">
          <article><span>Aktif sürüm</span><strong>#{data.activeVersion}</strong></article>
          <article><span>Publication</span><strong>#{data.publicationVersion}</strong></article>
          <article><span>Kaynak</span><strong>{data.sources.length}</strong></article>
          <article aria-label="Toplam kayıt"><span>Kayıt</span><strong>{totalRecords.toLocaleString("tr-TR")}</strong></article>
        </div>
      )}

      {!sourcesOnly && (
        <dl className="release-identity">
          <div><dt>Resolution</dt><dd>{data.resolvedReleaseId}</dd></div>
          <div><dt>Politika</dt><dd>{data.policyVersion}</dd></div>
          <div><dt>Üretim zamanı</dt><dd>{displayDate(data.generatedAt)}</dd></div>
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
                {source.configChangedSinceBuild ? "Rebuild gerekli" : "Aktif"}
              </span>
            </div>
            <p>{sourceClassLabels[source.sourceClass]} · {source.recordCount.toLocaleString("tr-TR")} kayıt</p>
            <dl>
              <div><dt>Son gözlem</dt><dd>{displayDate(source.observedAt)}</dd></div>
              <div><dt>Hak durumu</dt><dd>{source.currentRightsStatus}</dd></div>
              <div><dt>API kapsamı</dt><dd>{source.rightsScope}</dd></div>
              <div><dt>Config</dt><dd>build {source.configVersionAtBuild} / güncel {source.configVersion}</dd></div>
              {source.rightsReviewExpiresAt && <div><dt>Hak inceleme</dt><dd>{displayDate(source.rightsReviewExpiresAt)}</dd></div>}
            </dl>
          </article>
        ))}
      </div>

      {!sourcesOnly && (
        <details className="raw-release">
          <summary>Ham API yanıtını göster</summary>
          <pre className="json-view" tabIndex={0} aria-label="Aktif veri sürümü JSON çıktısı">{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
