import type { Metadata } from "next";
import { ReleaseView } from "@/components/release-view";

export const metadata: Metadata = { title: "Data sources" };

export default function DataSourcesPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Transparency</p>
      <h1>Data sources</h1>
      <p className="lead">The active resolution inputs are shown live. Authoritative assignments, protocol usage, historical aliases, and reviewed enrichment remain separate.</p>
      <ReleaseView sourcesOnly />
      <div className="callout warning">
        No source is presented as risk-free or as an endorsement. IEEE residual risk, CC0 registries, licensed history, exact identity mappings, API-output scope, and mandatory controls are preserved in separate rights reviews. Verify active inputs on the Data release page.
      </div>
    </section>
  );
}
