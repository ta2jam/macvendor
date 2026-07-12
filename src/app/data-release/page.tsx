import type { Metadata } from "next";
import { ReleaseView } from "@/components/release-view";

export const metadata: Metadata = { title: "Active data release" };

export default function DataReleasePage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Provenance</p>
      <h1>Active data release</h1>
      <p className="lead">The immutable resolution and source snapshots currently used by the public API.</p>
      <ReleaseView />
    </section>
  );
}
