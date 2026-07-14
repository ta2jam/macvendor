import type { Metadata } from "next";
import { CodeSample } from "@/components/code-sample";
import {
  BULK_LOOKUP_LIMITS,
  PUBLIC_RATE_LIMIT_MAX_COST,
  PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
} from "@/http/public-api-policy";

export const metadata: Metadata = {
  title: "API",
  description: "A compact guide to the macvendor.io public JSON API.",
};

const curlExample = `curl --fail --silent --show-error --location \\
  'https://macvendor.io/v1/lookup/00000C123456?mode=enriched'`;

const javascriptExample = `const response = await fetch(
  "https://macvendor.io/v1/lookup/00000C123456?mode=enriched"
);

if (!response.ok) throw new Error(\`Lookup failed: \${response.status}\`);
const result = await response.json();
console.log(result.assignment?.organizationName ?? "No match");`;

const responseExample = `{
  "query": {
    "normalized": "00000C123456"
  },
  "matchStatus": "matched",
  "assignment": {
    "prefix": "00000C",
    "prefixLength": 24,
    "registry": "MA-L",
    "organizationName": "Cisco Systems, Inc",
    "source": { "slug": "ieee-ma-l" }
  },
  "curatedMatches": [],
  "insights": [],
  "data": {
    "activeVersion": 21,
    "publicationVersion": 25,
    "policyVersion": "v2"
  }
}`;

const bulkExample = `curl --fail --silent --show-error \\
  --request POST \\
  --header 'Content-Type: application/json' \\
  --data '{"mode":"enriched","macs":["00000C123456","001B63AABBCC"]}' \\
  'https://macvendor.io/v1/lookups'`;

const primaryEndpoints = [
  {
    name: "Single lookup",
    endpoint: "GET /v1/lookup/{mac}",
    detail: "Defaults to enriched mode: official assignment, reviewed claims, insights, and release metadata.",
  },
  {
    name: "Bulk lookup",
    endpoint: "POST /v1/lookups",
    detail: `Accepts up to ${BULK_LOOKUP_LIMITS.official} official or ${BULK_LOOKUP_LIMITS.enriched} enriched lookups in one bounded request.`,
  },
  {
    name: "Exact assignment",
    endpoint: "GET /v1/assignments/{registry}/{prefix}",
    detail: "Retrieves one active registry assignment and can include its evidence chain.",
  },
];

const secondaryEndpoints = [
  ["Enriched lookup", "GET /v1/lookup/{mac}?mode=enriched"],
  ["Official layer only", "GET /v1/lookup/{mac}?mode=official"],
  ["Active release", "GET /v1/data-release"],
  ["Release changes", "GET /v1/data-release/changes"],
  ["Organization search", "GET /v1/organizations?q=Apple"],
  ["Organization identity", "GET /v1/organizations/{key}"],
  ["Correction intake", "POST /v1/corrections"],
];

const errors = [
  ["308", "Canonical MAC URL", "Follow the Location header or send canonical paths directly."],
  ["400", "Invalid request", "Fix the input; retrying the same request will not help."],
  ["404", "Exact resource not found", "Used by endpoints that request one specific resource."],
  ["429", "Rate limited", "Wait for the number of seconds in Retry-After before retrying."],
  ["503", "Temporary degradation", "Use bounded exponential backoff and a client timeout."],
];

export default function ApiDocsPage() {
  return (
    <section className="shell content-page api-docs-page">
      <p className="eyebrow">JSON API</p>
      <h1>Build with macvendor</h1>
      <p className="lead">
        Query the maintained public service at <code>https://macvendor.io/v1</code>. No API key is
        currently required. Responses are JSON, include release metadata, and use RFC 9457 problem
        details for errors.
      </p>

      <section className="api-section api-quickstart" aria-labelledby="quickstart-heading">
        <div className="section-heading">
          <p className="eyebrow">Quickstart</p>
          <h2 id="quickstart-heading">Make your first lookup</h2>
          <p>Use a canonical 12-character hexadecimal MAC to avoid an HTTP 308 redirect.</p>
        </div>
        <div className="api-sample-grid">
          <div>
            <CodeSample label="cURL" code={curlExample} />
            <a className="text-link" href="/v1/lookup/00000C123456?mode=enriched" target="_blank" rel="noopener noreferrer">
              Open this JSON response
            </a>
          </div>
          <div>
            <p className="sample-caption">Trimmed response</p>
            <CodeSample label="JSON" code={responseExample} />
          </div>
        </div>
        <CodeSample label="JavaScript" code={javascriptExample} />
      </section>

      <section className="api-section" aria-labelledby="core-endpoints-heading">
        <div className="section-heading">
          <p className="eyebrow">Core endpoints</p>
          <h2 id="core-endpoints-heading">Start with these three</h2>
        </div>
        <div className="core-endpoint-grid">
          {primaryEndpoints.map((endpoint) => (
            <article key={endpoint.endpoint}>
              <h3>{endpoint.name}</h3>
              <code>{endpoint.endpoint}</code>
              <p>{endpoint.detail}</p>
            </article>
          ))}
        </div>
        <div className="bulk-example">
          <h3>Bulk request</h3>
          <p>
            Omit <code>mode</code> for the backward-compatible official response. Use <code>enriched</code> to include
            reviewed matches and insights without merging them into the assignment.
          </p>
          <CodeSample label="Bulk cURL" code={bulkExample} />
        </div>
        <details className="api-more-endpoints">
          <summary>More endpoints</summary>
          <div className="endpoint-list">
            {secondaryEndpoints.map(([name, endpoint]) => (
              <article key={endpoint}><span>{name}</span><code>{endpoint}</code></article>
            ))}
          </div>
        </details>
      </section>

      <section className="api-section" aria-labelledby="response-model-heading">
        <div className="section-heading">
          <p className="eyebrow">Response model</p>
          <h2 id="response-model-heading">Keep each layer distinct</h2>
        </div>
        <div className="response-model-grid">
          <article><code>matchStatus</code><p><code>matched</code> or explicit <code>no_match</code> for the official assignment layer. No match is still HTTP 200.</p></article>
          <article><code>assignment</code><p>The official registry holder for the longest matching prefix, or <code>null</code> when no assignment matches.</p></article>
          <article><code>curatedMatches</code><p>Reviewed third-party or owner claims. They do not override the official assignment.</p></article>
          <article><code>insights</code><p>Supporting aliases, device hints, and usage notes kept separate from assignment data.</p></article>
          <article><code>data</code><p>The resolution and publication versions needed to reproduce or audit a stored result.</p></article>
        </div>
        <div className="callout">
          Official lookup probes 36, then 28, then 24 bits. The longest matching active assignment wins. A registry assignment identifies an address-block holder; it is not proof of the physical device&apos;s manufacturer, model, owner, or identity.
        </div>
      </section>

      <section className="api-section" aria-labelledby="cache-heading">
        <div className="section-heading">
          <p className="eyebrow">Version and cache contract</p>
          <h2 id="cache-heading">Cache only what is reusable</h2>
          <p>Every v1 response includes <code>X-API-Version</code>, <code>X-App-Version</code>, and <code>X-Request-Id</code>. Data responses also carry release metadata in the JSON body.</p>
        </div>
        <div className="api-table-wrap" role="region" aria-label="API cache policy" tabIndex={0}>
          <table className="api-error-table">
            <thead><tr><th scope="col">Response</th><th scope="col">Cache-Control</th><th scope="col">ETag</th></tr></thead>
            <tbody>
              <tr><th scope="row">Matched lookup</th><td><code>public, max-age=60, s-maxage=300, stale-while-revalidate=60</code></td><td>Strong</td></tr>
              <tr><th scope="row">No match</th><td><code>public, max-age=30, s-maxage=60</code></td><td>Strong</td></tr>
              <tr><th scope="row">Bulk, evidence, correction, error</th><td><code>private, no-store</code></td><td>None</td></tr>
              <tr><th scope="row">Canonical redirect</th><td><code>public, max-age=300</code></td><td>None</td></tr>
            </tbody>
          </table>
        </div>
        <div className="callout">Send <code>If-None-Match</code> on repeated GETs. A matching validator returns HTTP 304 with the same ETag, cache policy, and version headers.</div>
      </section>

      <section className="api-section" aria-labelledby="errors-heading">
        <div className="section-heading">
          <p className="eyebrow">Service signals</p>
          <h2 id="errors-heading">Handle errors deliberately</h2>
        </div>
        <div className="api-table-wrap" role="region" aria-label="API error responses" tabIndex={0}>
          <table className="api-error-table">
            <thead><tr><th scope="col">Status</th><th scope="col">Meaning</th><th scope="col">Client action</th></tr></thead>
            <tbody>
              {errors.map(([status, meaning, action]) => (
                <tr key={status}><th scope="row"><code>{status}</code></th><td>{meaning}</td><td>{action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="callout">Every error uses the same RFC 9457 fields: <code>type</code>, <code>title</code>, <code>status</code>, <code>code</code>, <code>detail</code>, <code>requestId</code>, <code>apiVersion</code>, and <code>appVersion</code>.</div>
      </section>

      <section className="api-section" aria-labelledby="rate-limit-heading">
        <div className="section-heading">
          <p className="eyebrow">Rate limits</p>
          <h2 id="rate-limit-heading">Budget requests by cost</h2>
          <p>
            The standard public quota is <strong>{PUBLIC_RATE_LIMIT_MAX_COST} cost units per client IP in each fixed {PUBLIC_RATE_LIMIT_WINDOW_SECONDS}-second window</strong>.
            A rejected request returns HTTP 429 and <code>Retry-After</code> in seconds.
          </p>
        </div>
        <div className="api-table-wrap" role="region" aria-label="API rate limit costs" tabIndex={0}>
          <table className="api-error-table">
            <thead><tr><th scope="col">Operation</th><th scope="col">Maximum</th><th scope="col">Cost</th></tr></thead>
            <tbody>
              <tr><th scope="row">Single lookup</th><td>1 MAC</td><td>1 unit</td></tr>
              <tr><th scope="row">Official bulk</th><td>{BULK_LOOKUP_LIMITS.official} MACs</td><td>1 unit per 2 submitted MACs, rounded up</td></tr>
              <tr><th scope="row">Enriched bulk</th><td>{BULK_LOOKUP_LIMITS.enriched} MACs</td><td>1 unit per submitted MAC</td></tr>
              <tr><th scope="row">Organization lookup</th><td>1 request</td><td>2 units</td></tr>
              <tr><th scope="row">Evidence or correction</th><td>1 request</td><td>5 units</td></tr>
            </tbody>
          </table>
        </div>
        <div className="callout">
          Quota is calculated from submitted entries, including duplicates. Do not parallelize retries; wait for <code>Retry-After</code>.
        </div>
      </section>

      <section className="api-section api-integration" aria-labelledby="integration-heading">
        <div className="section-heading">
          <p className="eyebrow">Integration</p>
          <h2 id="integration-heading">Use the published contract</h2>
          <p>Honor <code>Retry-After</code>, reuse cacheable GET responses with <code>ETag</code>, and never send credentials or unrelated personal data.</p>
        </div>
        <div className="api-contract-links">
          <a href="/openapi.json"><span>OpenAPI 3.1</span><small>Endpoints, parameters, and response types</small></a>
          <a href="/schemas/public-api-v1.schema.json"><span>Public JSON Schema</span><small>Machine-readable response validation</small></a>
          <a href="/v1/data-release"><span>Active data release</span><small>Sources, rights state, versions, and hashes</small></a>
        </div>
        <p className="policy-date">See the <a href="/plans">public plan and exact usage limits</a> before scheduling discovery workloads.</p>
      </section>

      <div className="policy-grid compact" aria-label="Safe API integration guidance">
        <article><h2>Send only what is needed</h2><p>Use HTTPS and choose official mode when reviewed matches and insights are unnecessary.</p></article>
        <article><h2>Store release metadata</h2><p>Assignments and reviewed claims can change between governed publications.</p></article>
      </div>
    </section>
  );
}
