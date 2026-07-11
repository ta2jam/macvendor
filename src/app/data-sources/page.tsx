import type { Metadata } from "next";

export const metadata: Metadata = { title: "Veri kaynakları" };

export default function DataSourcesPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Şeffaflık</p>
      <h1>Veri kaynakları</h1>
      <p className="lead">Repository IEEE snapshot&apos;ı içermez. Bir deployment, doğrudan IEEE&apos;den aldığı imzalı ve hash-pinned release&apos;i ayrıca aktive edebilir.</p>
      <div className="source-list">
        <article>
          <div><span className="source-dot authoritative" aria-hidden="true" /><h2>demo-authoritative</h2></div>
          <p>Sentetik `/24` assignment. Yalnız geliştirme ve test amacıyla oluşturuldu.</p>
          <dl><div><dt>Sınıf</dt><dd>authoritative</dd></div><div><dt>Hak</dt><dd>owner_created</dd></div></dl>
        </article>
        <article>
          <div><span className="source-dot authoritative" aria-hidden="true" /><h2>ieee-ma-l / ma-m / ma-s</h2></div>
          <p>IEEE Registration Authority public CSV snapshot&apos;ları. Yalnız sabit resmî HTTPS origin&apos;inden hazırlanır; assignment katmanını üretir.</p>
          <dl><div><dt>Sınıf</dt><dd>authoritative</dd></div><div><dt>Hak</dt><dd>public_domain_claim · owner risk accepted</dd></div></dl>
        </article>
        <article>
          <div><span className="source-dot curated" aria-hidden="true" /><h2>demo-curated</h2></div>
          <p>Sentetik `/32` owner-curated iddia. Resmî sonucu değiştirmez.</p>
          <dl><div><dt>Sınıf</dt><dd>owner_curated</dd></div><div><dt>Hak</dt><dd>owner_created</dd></div></dl>
        </article>
      </div>
      <div className="callout warning">
        IEEE kullanımı risksiz veya IEEE tarafından onaylanmış olarak sunulmaz. 2013 ve 2014 ifadeleri arasındaki gerilim, API-output kapsamı ve zorunlu kontroller hak inceleme kaydında korunur. Aktif girdileri Veri sürümü sayfasından doğrulayın.
      </div>
    </section>
  );
}
