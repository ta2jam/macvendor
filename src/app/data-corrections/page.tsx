import type { Metadata } from "next";
import Link from "next/link";
import { dataCorrectionsEmail } from "@/lib/public-config";

export const metadata: Metadata = {
  title: "Veri düzeltme ve geri çekme",
  description: "Yanlış MAC assignment veya curated claim bildirim süreci.",
};

export const dynamic = "force-dynamic";

export default function DataCorrectionsPage() {
  const email = dataCorrectionsEmail();
  const subject = encodeURIComponent("[macvendor.io] Veri düzeltme başvurusu");

  return (
    <section className="shell content-page policy-page">
      <p className="eyebrow">Düzeltme kanalı</p>
      <h1>Veri düzeltme ve geri çekme</h1>
      <p className="lead">
        Yanlış kayıt sahibi, curated iddia, gizlilik veya veri kullanım hakkı sorununu ilgili kaynak
        ve kanıtla bildirin. Başvuru, public sonucu otomatik değiştirmez.
      </p>

      {email ? (
        <div className="callout intake-ready" role="status">
          <strong>Düzeltme kanalı açık.</strong>
          <p>
            Başvuruyu <code>{email}</code> adresine gönderin. İletişim bilgileri ve kanıtlar public
            edilmez; macvendor PostgreSQL veritabanına yazılmaz.
          </p>
          <a className="action-link" href={`mailto:${email}?subject=${subject}`}>
            Başvuru e-postası oluştur
          </a>
        </div>
      ) : (
        <div className="callout warning" role="status">
          <strong>Düzeltme intake kanalı bu deployment&apos;ta yapılandırılmamış.</strong>
          <p>
            Uygulama çalışıyor görünse de bu durum production açılış kapısını başarısız sayar.
            Başvuru alınmış gibi davranan sahte bir form gösterilmez.
          </p>
        </div>
      )}

      <ol className="steps correction-steps">
        <li>
          <span>1</span>
          <div>
            <h2>Kaydı tanımlayın</h2>
            <p>İlgili MAC veya prefix, kaynak adı ve ekranda görünen iddiayı aynen belirtin.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h2>Talebi ve dayanağı açıklayın</h2>
            <p>
              İstenen düzeltmeyi, doğrulanabilir reference veya kanıt bağlantısını ve size dönüş için
              gerekli iletişim bilgisini ekleyin. Parola, özel anahtar veya gereksiz kişisel veri
              göndermeyin.
            </p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h2>İnceleme ve geçici önlem</h2>
            <p>
              İlk insan incelemesi hedefi 2 iş günü, normal karar hedefi 10 iş günüdür. Açık kişisel
              veri, güvenlik veya ağır yanlış atıf iddiası 24 saatlik geçici suppression review
              kuyruğuna alınır.
            </p>
          </div>
        </li>
        <li>
          <span>4</span>
          <div>
            <h2>Denetlenebilir karar</h2>
            <p>
              Talep gerekçeyle reddedilebilir, yeni source release ile düzeltilebilir, geçici veya
              kalıcı suppression uygulanabilir ya da hak/gizlilik incelemesine yönlendirilebilir.
            </p>
          </div>
        </li>
      </ol>

      <div className="policy-grid compact">
        <article>
          <h2>Değişmez kayıt ilkesi</h2>
          <p>
            Kaynak ve resolution release satırları geriye dönük mutate edilmez. Acil görünürlük
            değişikliği ticket referanslı suppression ile; kalıcı veri değişikliği yeni release ile
            yapılır. Her karar audit izi üretir.
          </p>
        </article>
        <article>
          <h2>Güvenlik bildirimi ayrı kanaldır</h2>
          <p>
            Uygulama açığı veya credential sızıntısını düzeltme e-postasına göndermeyin. Bunun için
            <a href="https://github.com/ta2jam/macvendor/security/advisories/new"> private security
            advisory</a> kanalını kullanın.
          </p>
        </article>
      </div>

      <p className="policy-date">
        Süreç ayrıntıları <Link href="/legal/data-terms">veri kullanım şartları</Link> ve aktif
        <Link href="/data-release"> veri sürümü</Link> ile birlikte değerlendirilir.
      </p>
    </section>
  );
}
