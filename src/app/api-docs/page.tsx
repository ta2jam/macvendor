import type { Metadata } from "next";

export const metadata: Metadata = { title: "API" };

const examples = [
  ["MAC lookup", "GET /v1/lookup/02AABBCC0001"],
  ["Yalnız resmî katman", "GET /v1/lookup/02AABBCC0001?mode=official"],
  ["Exact assignment", "GET /v1/assignments/ma-l/02AABB-24"],
  ["Aktif release", "GET /v1/data-release"],
];

export default function ApiDocsPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">JSON API</p>
      <h1>v1 API</h1>
      <p className="lead">Başarılı yanıtlar sürüm bilgisi taşır. Hatalar RFC 9457 problem JSON biçimindedir.</p>
      <div className="endpoint-list">
        {examples.map(([name, endpoint]) => <article key={endpoint}><span>{name}</span><code>{endpoint}</code></article>)}
      </div>
      <div className="callout">Canonical MAC biçimi 12 uppercase hexadecimal karakterdir. Diğer geçerli biçimler 308 ile canonical URL’ye yönlendirilir.</div>
    </section>
  );
}
