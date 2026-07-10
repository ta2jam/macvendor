import type { Metadata } from "next";

export const metadata: Metadata = { title: "Veri kaynakları" };

export default function DataSourcesPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Şeffaflık</p>
      <h1>Veri kaynakları</h1>
      <p className="lead">Mevcut demo build gerçek IEEE verisi dağıtmaz. Lokal doğrulama yalnız sentetik kayıtlarla yapılır.</p>
      <div className="source-list">
        <article>
          <div><span className="source-dot authoritative" /><h2>demo-authoritative</h2></div>
          <p>Sentetik `/24` assignment. Yalnız geliştirme ve test amacıyla oluşturuldu.</p>
          <dl><div><dt>Sınıf</dt><dd>authoritative</dd></div><div><dt>Hak</dt><dd>owner_created</dd></div></dl>
        </article>
        <article>
          <div><span className="source-dot curated" /><h2>demo-curated</h2></div>
          <p>Sentetik `/32` owner-curated iddia. Resmî sonucu değiştirmez.</p>
          <dl><div><dt>Sınıf</dt><dd>owner_curated</dd></div><div><dt>Hak</dt><dd>owner_created</dd></div></dl>
        </article>
      </div>
      <div className="callout warning">
        IEEE public listing erişilebilir olsa da public erişim yeniden dağıtım izni değildir. Production ingest, yazılı hak incelemesi geçmeden açılmaz.
      </div>
    </section>
  );
}
