import type { Metadata } from "next";
import Link from "next/link";
import {
  BULK_LOOKUP_LIMITS,
  PUBLIC_RATE_LIMIT_MAX_COST,
  PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
} from "@/http/public-api-policy";

export const metadata: Metadata = {
  title: "Plans and limits",
  description: "The macvendor.io public API plan, request limits, and support boundary.",
};

export default function PlansPage() {
  return (
    <section className="shell content-page plans-page">
      <p className="eyebrow">Plans and limits</p>
      <h1>One public plan. Explicit limits.</h1>
      <p className="lead">
        macvendor.io currently provides one free public API plan with no account or API key.
        The limits below protect a shared service; they are not a paid SLA.
      </p>

      <article className="plan-card" aria-labelledby="public-plan-title">
        <div>
          <p className="eyebrow">Current plan</p>
          <h2 id="public-plan-title">Public API</h2>
          <p>For interactive lookup, development, inventory enrichment, and bounded discovery jobs.</p>
        </div>
        <strong>Free</strong>
        <ul>
          <li>{PUBLIC_RATE_LIMIT_MAX_COST} cost units per client IP per fixed {PUBLIC_RATE_LIMIT_WINDOW_SECONDS}-second window</li>
          <li>Up to {BULK_LOOKUP_LIMITS.official} MACs per official bulk request</li>
          <li>Up to {BULK_LOOKUP_LIMITS.enriched} MACs per enriched bulk request</li>
          <li>Published OpenAPI, JSON Schema, ETag, and release metadata</li>
          <li>No uptime SLA, reserved capacity, or account-level quota</li>
        </ul>
        <div className="plan-actions">
          <Link className="action-link" href="/api-docs">Read the API guide</Link>
          <Link className="text-link" href="/data-corrections">Contact us about a correction</Link>
        </div>
      </article>

      <div className="policy-grid compact" aria-label="Plan boundaries">
        <article>
          <h2>Cost is predictable</h2>
          <p>Single lookup costs 1 unit. Official bulk costs 1 unit per two entries, rounded up. Enriched bulk costs 1 unit per entry.</p>
        </article>
        <article>
          <h2>429 is a control signal</h2>
          <p>When the quota is exhausted, wait for the number of seconds in <code>Retry-After</code>. Parallel retries consume shared capacity.</p>
        </article>
        <article>
          <h2>Corrections are reviewed</h2>
          <p>The correction form creates a private tracking reference. A submission never changes public data automatically.</p>
        </article>
        <article>
          <h2>Commercial terms are not implied</h2>
          <p>The public plan does not include support response guarantees, dedicated infrastructure, or bulk dataset redistribution.</p>
        </article>
      </div>
    </section>
  );
}
