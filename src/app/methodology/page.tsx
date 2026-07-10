import type { Metadata } from "next";

export const metadata: Metadata = { title: "Metodoloji" };

export default function MethodologyPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">Nasıl çalışır?</p>
      <h1>Metodoloji</h1>
      <p className="lead">Girdi doğrulanır, değiştirilmeden 48 bit değere çevrilir ve aktif veri sürümünde sorgulanır.</p>
      <ol className="steps">
        <li><span>1</span><div><h2>Kesin normalizasyon</h2><p>Dört açık MAC biçimi kabul edilir. U/L ve I/G bitleri temizlenmez.</p></div></li>
        <li><span>2</span><div><h2>Longest-prefix match</h2><p>Authoritative adaylar sırasıyla 36, 28 ve 24 bittir. CID full-MAC lookup’a girmez.</p></div></li>
        <li><span>3</span><div><h2>Ayrı claim katmanı</h2><p>Owner-curated sonuçlar 1–48 bit aralığında aranır; resmî assignment’ı ezmez.</p></div></li>
        <li><span>4</span><div><h2>Sürüm ve suppression</h2><p>Her yanıt aktif release’i taşır. Acil bastırma cache sürümünü değiştirir.</p></div></li>
      </ol>
    </section>
  );
}
