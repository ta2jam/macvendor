import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Veri kullanım şartları",
  description: "macvendor.io veri çıktısının kaynak, attribution ve kullanım sınırları.",
};

export default function DataTermsPage() {
  return (
    <section className="shell content-page policy-page">
      <p className="eyebrow">Veri yönetişimi</p>
      <h1>Veri kullanım şartları</h1>
      <p className="lead">
        Bu sayfa kaynak verisinin neyi ifade ettiğini ve public çıktının kullanım sınırlarını açıklar.
        Uygulama kaynak kodunun MIT lisansı, üçüncü taraf veri üzerinde hak vermez.
      </p>

      <div className="callout warning">
        Repository ve GitHub release IEEE snapshot&apos;ı paketlemez. Bir deployment doğrudan IEEE&apos;den
        aldığı MA-L, MA-M ve MA-S verisinden türetilmiş lookup sonuçları yayınlayabilir; bu IEEE
        endorsement&apos;ı veya cihaz üreticisi doğrulaması değildir.
      </div>

      <div className="policy-grid">
        <article>
          <h2>Sonucun anlamı</h2>
          <p>
            Resmî katman bir adres bloğunun kayıt sahibini, curated katman ise ayrı bir kaynak
            iddiasını gösterir. Sonuç cihazın gerçek üreticisini, modelini, sahibini, konumunu veya
            ağdaki kimliğini kanıtlamaz. MAC adresleri değiştirilebilir, taklit edilebilir veya
            rastgeleleştirilebilir.
          </p>
        </article>
        <article>
          <h2>Kaynak ve attribution</h2>
          <p>
            Her public sonuç aktif veri sürümü ve kaynak release bilgisiyle ilişkilidir. Bir kaynağın
            indirilebilir olması, yeniden dağıtım veya türetilmiş API çıktısı izni değildir. Kaynak
            bazındaki hak ve kullanım kapsamı <Link href="/data-sources">Veri kaynakları</Link> ile
            <Link href="/data-release"> aktif veri sürümünde</Link> gösterilir.
          </p>
        </article>
        <article>
          <h2>Yeniden kullanım sınırı</h2>
          <p>
            API çıktısını kullanmak ham kaynak artifact&apos;lerini yeniden dağıtma hakkı vermez.
            Kullanıcı; geçerli kaynak koşullarına, attribution yükümlülüklerine ve kendi kullanım
            alanındaki hukuka uymaktan sorumludur. macvendor.io hiçbir kaynak adına ek lisans vermez.
          </p>
        </article>
        <article>
          <h2>Doğruluk ve süreklilik</h2>
          <p>
            Veri eksik, eski veya hatalı olabilir. Eşleşme bulunmaması bir kayıt bulunmadığını kesin
            olarak kanıtlamaz. Yanıt şeması SemVer ve API sözleşmesiyle yönetilir; belirli bir uptime,
            veri kapsamı veya hatasızlık garantisi verilmez.
          </p>
        </article>
        <article>
          <h2>Otomatik erişim</h2>
          <p>
            İstemciler cache, ETag, canonical redirect, rate-limit ve <code>Retry-After</code>
            başlıklarına uymalıdır. Rate limit&apos;i aşmaya, erişim kontrolünü atlatmaya veya servisi
            cihaz/kişi takibi aracı gibi sunmaya yönelik kullanım desteklenmez.
          </p>
        </article>
        <article>
          <h2>Düzeltme ve geri çekme</h2>
          <p>
            Hatalı atıf, gizlilik veya hak sorunu için <Link href="/data-corrections">veri düzeltme
            sürecini</Link> kullanın. Mevcut release satırları sessizce değiştirilmez; kabul edilen
            düzeltme yeni bir release veya denetlenebilir suppression kararı üretir.
          </p>
        </article>
      </div>

      <p className="policy-date">Son güncelleme: 11 Temmuz 2026 · Bu metin hukuk danışmanlığı değildir.</p>
    </section>
  );
}
