import type { Metadata } from "next";
import { ReleaseView } from "@/components/release-view";

export const metadata: Metadata = { title: "Data sources" };

export default function DataSourcesPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Transparency</p>
      <h1>Data sources</h1>
      <p className="lead">The active resolution inputs for this deployment are shown live. The repository does not contain an IEEE snapshot.</p>
      <ReleaseView sourcesOnly />
      <div className="callout warning">
        IEEE use is not presented as risk-free or endorsed by IEEE. The tension between the 2013 and 2014 statements, the API-output scope, and mandatory controls are preserved in the rights review record. Verify active inputs on the Data release page.
      </div>
    </section>
  );
}
