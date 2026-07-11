import type { Metadata } from "next";
import { ReleaseView } from "@/components/release-view";

export const metadata: Metadata = { title: "Veri kaynakları" };

export default function DataSourcesPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Şeffaflık</p>
      <h1>Veri kaynakları</h1>
      <p className="lead">Bu deployment&apos;ın aktif resolution girdileri canlı olarak gösterilir. Repository IEEE snapshot&apos;ı içermez.</p>
      <ReleaseView sourcesOnly />
      <div className="callout warning">
        IEEE kullanımı risksiz veya IEEE tarafından onaylanmış olarak sunulmaz. 2013 ve 2014 ifadeleri arasındaki gerilim, API-output kapsamı ve zorunlu kontroller hak inceleme kaydında korunur. Aktif girdileri Veri sürümü sayfasından doğrulayın.
      </div>
    </section>
  );
}
