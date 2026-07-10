import type { Metadata } from "next";

export const metadata: Metadata = { title: "API problem type" };

const descriptions: Record<string, string> = {
  "invalid-mac": "MAC değeri desteklenen dört 48-bit biçimden biri olmalıdır.",
  "invalid-prefix": "Prefix ve uzunluk registry sözleşmesiyle eşleşmelidir.",
  "invalid-registry": "Registry ma-l, ma-m, ma-s, iab veya cid olmalıdır.",
  "unsupported-parameter": "Endpoint yalnız sözleşmede tanımlanan query parametrelerini kabul eder.",
  "assignment-not-found": "Aktif release içinde exact registry/prefix kaydı yoktur.",
  "rate-limited": "İstek hızı koruma eşiğini aştı; Retry-After başlığını izleyin.",
  "data-release-unavailable": "Servis doğrulanmış aktif bir release bulamadı.",
  "service-unavailable": "Geçici altyapı hatası oluştu; request ID ile tekrar deneyin.",
};

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <section className="shell content-page">
      <p className="eyebrow">RFC 9457 problem type</p>
      <h1>{slug}</h1>
      <p className="lead">{descriptions[slug] ?? "Bu problem türü için public açıklama bulunamadı."}</p>
    </section>
  );
}
