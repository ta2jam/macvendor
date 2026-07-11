import { LookupForm } from "@/components/lookup-form";
import { APP_VERSION } from "@/lib/version";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="shell hero-grid">
          <div>
            <p className="eyebrow">Kaynağı belli. Sonucu açıklanabilir.</p>
            <h1>MAC adres bloğunun kayıt sahibini bul.</h1>
            <p className="hero-copy">
              Resmî atamalar ile owner-curated iddiaları birbirine karıştırmadan, longest-prefix
              eşleşmesiyle sorgula.
            </p>
          </div>
          <div className="stat-card" aria-label={`v${APP_VERSION} özellik özeti`}>
            <span>v{APP_VERSION}</span>
            <strong>36 → 28 → 24 bit</strong>
            <p>Sabit aday kümesi, sürümlü sonuç, açık kaynak bilgisi.</p>
          </div>
        </div>
      </section>
      <section className="shell lookup-section">
        <LookupForm />
      </section>
      <section className="shell principles" aria-labelledby="principles-title">
        <div>
          <p className="eyebrow">Sınırlar</p>
          <h2 id="principles-title">Ne söylediğimizi net tutuyoruz.</h2>
        </div>
        <div className="principle-grid">
          <article>
            <span aria-hidden="true">01</span>
            <h3>Atama, cihaz kimliği değildir</h3>
            <p>Sonuç registry sahibini gösterir. MAC değiştirilebilir veya rastgeleleştirilebilir.</p>
          </article>
          <article>
            <span aria-hidden="true">02</span>
            <h3>Kaynaklar ayrı kalır</h3>
            <p>Authoritative kayıt, owner-curated iddia tarafından sessizce ezilemez.</p>
          </article>
          <article>
            <span aria-hidden="true">03</span>
            <h3>Her sonuç sürümlüdür</h3>
            <p>Aktif release ve politika sürümü API yanıtında görünür.</p>
          </article>
        </div>
      </section>
    </>
  );
}
