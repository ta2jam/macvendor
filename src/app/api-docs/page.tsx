import type { Metadata } from "next";

export const metadata: Metadata = { title: "API" };

const examples = [
  ["MAC lookup", "GET /v1/lookup/02AABBCC0001"],
  ["Official layer only", "GET /v1/lookup/02AABBCC0001?mode=official"],
  ["Bulk official lookup (max 25)", "POST /v1/lookups"],
  ["Exact assignment", "GET /v1/assignments/ma-l/02AABB-24"],
  ["Active release", "GET /v1/data-release"],
  ["Release changes", "GET /v1/data-release/changes"],
  ["Organization search", "GET /v1/organizations?q=Apple"],
  ["Organization identity", "GET /v1/organizations/Q312"],
  ["Correction intake", "POST /v1/corrections"],
];

export default function ApiDocsPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">JSON API</p>
      <h1>v1 API</h1>
      <p className="lead">Successful responses include release metadata. Errors use RFC 9457 problem JSON.</p>
      <div className="endpoint-list">
        {examples.map(([name, endpoint]) => <article key={endpoint}><span>{name}</span><code>{endpoint}</code></article>)}
      </div>
      <div className="callout">The canonical MAC form is 12 uppercase hexadecimal characters. Other valid forms redirect to the canonical URL with HTTP 308.</div>
    </section>
  );
}
