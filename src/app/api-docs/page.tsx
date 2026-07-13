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
      <p className="lead">
        Use the maintained HTTPS API at <code>https://macvendor.io/v1</code>. No API key is currently
        required; successful responses include release metadata and errors use RFC 9457 problem JSON.
      </p>
      <div className="endpoint-list">
        {examples.map(([name, endpoint]) => <article key={endpoint}><span>{name}</span><code>{endpoint}</code></article>)}
      </div>
      <div className="callout">The canonical MAC form is 12 uppercase hexadecimal characters. Other valid forms redirect to the canonical URL with HTTP 308.</div>
      <div className="policy-grid compact" aria-label="Safe API integration guidance">
        <article>
          <h2>Send only what is needed</h2>
          <p>Use HTTPS, never include credentials, and keep bulk requests to 25 MAC addresses or fewer.</p>
        </article>
        <article>
          <h2>Handle service signals</h2>
          <p>Honor Retry-After on 429, back off after transient 503 responses, and reuse GET responses with ETag.</p>
        </article>
        <article>
          <h2>Keep the meaning precise</h2>
          <p>An assignment identifies a registry holder. It is not proof of a device manufacturer, owner, or identity.</p>
        </article>
        <article>
          <h2>Use the published contract</h2>
          <p><a href="/openapi.json">OpenAPI 3.1</a> and the <a href="/schemas/public-api-v1.schema.json">public JSON Schema</a> are served with the API.</p>
        </article>
      </div>
    </section>
  );
}
