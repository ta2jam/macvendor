"use client";

import { useEffect, useState } from "react";

interface Changes {
  current: { resolvedReleaseId: string; activeVersion: number; publicationVersion: number; generatedAt: string };
  previous: { resolvedReleaseId: string; generatedAt: string } | null;
  changes: { assignmentsAdded: number; assignmentsRemoved: number; assignmentsChanged: number;
    claimsAdded: number; claimsRemoved: number; sourceReleasesChanged: number };
}

export function StatusView() {
  const [data, setData] = useState<Changes | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { fetch("/v1/data-release/changes").then(async (response) => {
    if (!response.ok) throw new Error();
    setData(await response.json() as Changes);
  }).catch(() => setError(true)); }, []);
  if (error) return <div className="problem-card" role="alert"><strong>Status details are temporarily unavailable.</strong></div>;
  if (!data) return <p role="status">Loading release status…</p>;
  const entries = [
    ["Assignments added", data.changes.assignmentsAdded], ["Assignments removed", data.changes.assignmentsRemoved],
    ["Assignments changed", data.changes.assignmentsChanged], ["Context claims added", data.changes.claimsAdded],
    ["Context claims removed", data.changes.claimsRemoved], ["Source releases changed", data.changes.sourceReleasesChanged],
  ] as const;
  return <>
    <div className="callout intake-ready" role="status"><strong>Operational</strong><p>The public API and active governed release are available.</p></div>
    <div className="release-metrics">{entries.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value.toLocaleString("en-US")}</strong></article>)}</div>
    <dl className="release-identity">
      <div><dt>Current release</dt><dd>{data.current.resolvedReleaseId}</dd></div>
      <div><dt>Active version</dt><dd>#{data.current.activeVersion}</dd></div>
      <div><dt>Publication</dt><dd>#{data.current.publicationVersion}</dd></div>
      <div><dt>Previous release</dt><dd>{data.previous?.resolvedReleaseId ?? "None"}</dd></div>
    </dl>
    <p className="input-hint">Counts are aggregate publication differences. They do not redistribute raw source databases.</p>
  </>;
}
