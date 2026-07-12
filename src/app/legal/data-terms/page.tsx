import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data terms",
  description: "Source, attribution, and usage boundaries for macvendor.io data output.",
};

export default function DataTermsPage() {
  return (
    <section className="shell content-page policy-page">
      <p className="eyebrow">Data governance</p>
      <h1>Data terms</h1>
      <p className="lead">
        This page explains what the source data represents and the boundaries for using public output.
        The MIT license for the application source code grants no rights over third-party data.
      </p>

      <div className="callout warning">
        The repository and GitHub release do not package an IEEE snapshot. A deployment may publish
        lookup results derived from MA-L, MA-M, and MA-S data obtained directly from IEEE; this is not
        IEEE endorsement or device-manufacturer verification.
      </div>

      <div className="policy-grid">
        <article>
          <h2>Meaning of a result</h2>
          <p>
            The official layer identifies the registrant of an address block; the curated layer shows
            a separate source claim. A result does not prove a device&apos;s actual manufacturer, model,
            owner, location, or network identity. MAC addresses can be changed, spoofed, or randomized.
          </p>
        </article>
        <article>
          <h2>Source and attribution</h2>
          <p>
            Every public result is linked to an active data release and source release. A downloadable
            source does not imply permission for redistribution or derived API output. Source-specific
            rights and usage scope appear under <Link href="/data-sources">Data sources</Link> and the
            <Link href="/data-release"> active data release</Link>.
          </p>
        </article>
        <article>
          <h2>Reuse boundary</h2>
          <p>
            Using API output does not grant the right to redistribute raw source artifacts. Users are
            responsible for applicable source terms, attribution obligations, and laws governing their
            own use. macvendor.io grants no additional license on behalf of any source.
          </p>
        </article>
        <article>
          <h2>Accuracy and continuity</h2>
          <p>
            Data may be incomplete, stale, or incorrect. No match does not conclusively prove that no
            registration exists. The response schema is governed by SemVer and the API contract; no
            specific uptime, coverage, or error-free guarantee is provided.
          </p>
        </article>
        <article>
          <h2>Automated access</h2>
          <p>
            Clients must follow caching, ETag, canonical redirect, rate-limit, and <code>Retry-After</code>
            headers. Use intended to bypass limits or access controls, or present the service as a
            device/person tracking tool, is not supported.
          </p>
        </article>
        <article>
          <h2>Correction and withdrawal</h2>
          <p>
            For misattribution, privacy, or rights issues, use the <Link href="/data-corrections">data
            correction process</Link>. Existing release rows are never silently changed; an accepted
            correction produces a new release or an auditable suppression decision.
          </p>
        </article>
      </div>

      <p className="policy-date">Last updated: 12 July 2026 · This text is not legal advice.</p>
    </section>
  );
}
