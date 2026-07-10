import type { Metadata } from "next";
import { ReleaseView } from "@/components/release-view";

export const metadata: Metadata = { title: "Aktif veri sürümü" };

export default function DataReleasePage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Provenance</p>
      <h1>Aktif veri sürümü</h1>
      <p className="lead">Public API’nin şu anda kullandığı immutable resolution ve kaynak snapshot’ı.</p>
      <ReleaseView />
    </section>
  );
}
