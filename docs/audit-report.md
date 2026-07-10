# macvendor.io — tasarım hata/bug denetimi

Tarih: 11 Temmuz 2026

## Kapsam

Repo denetim başlangıcında yalnız Markdown tasarım belgeleri içeriyordu; uygulama kodu, migration, test veya deployment configuration yoktu. Bu nedenle bu rapordaki “onarım”, çalıştırılabilir yazılım düzeltmesi değil, ileride doğrudan bug üretecek sözleşme çelişkilerinin bağlayıcı belgelerde düzeltilmesidir.

## Tespit edilen ve onarılan kusurlar

| No | Önem | Kusur | Onarım |
|---:|---|---|---|
| 1 | P0 | Exact assignment endpoint'i registry almıyordu; aynı prefix farklı registry bağlamında belirsizdi. | Yol `/v1/assignments/{registry}/{prefix}` oldu ve registry/uzunluk matrisi sabitlendi. |
| 2 | P0 | Source fetcher için SSRF, redirect, DNS rebinding ve metadata-service sınırı yoktu. | Fetcher parser'dan ayrıldı; HTTPS allowlist, redirect revalidation, IP-range bloklama, TLS ve streaming limitleri eklendi. |
| 3 | P0 | API source slug/release döndürüyordu fakat resolved tablolar bu alanları taşımıyordu; hot path'in yasaklanan source join'ine ihtiyacı vardı. | `resolved_assignments` ve `resolved_claims` içine immutable provenance snapshot alanları eklendi. |
| 4 | P1 | `resolution_evidence` polymorphic target kullanıyor, DB foreign key ile orphan'ı önleyemiyordu. | İki nullable gerçek FK ve `num_nonnulls(...)=1` constraint'i tanımlandı. |
| 5 | P1 | Import idempotency yalnız content hash'e bağlanmıştı; aynı artifact yeni adapter/normalizer ile işlenemiyordu. | `import_key`, source + artifact/manifest + adapter/normalizer/schema/policy sürümlerinden üretiliyor. |
| 6 | P1 | Aynı output hash aktivasyonu no-op sayılıyordu; hak veya provenance değişikliği görünmez kalabilirdi. | No-op yalnız zaten aktif `resolution_run_id` için geçerli oldu. |
| 7 | P1 | API örneğinde `originType=owner_curated` vardı; veri enum'unda böyle bir değer yoktu. | Public değer `owner_observation` olarak düzeltildi ve tüm public enum'lar listelendi. |
| 8 | P1 | `override` source/record türü vardı fakat resolver semantiği tanımlı değildi; resmî kaydı sessizce değiştirebilirdi. | V1'den kaldırıldı; düzeltme yeni source release veya açık suppression ile sınırlandı. |
| 9 | P1 | `prefix_bits` hizalaması ve nibble dışı prefix'in string gösterimi belirsizdi. | Sağ-yaslı DB formülü ve sola-yaslı canonical hex gösterimi örnekle tanımlandı. |
| 10 | P1 | Future-start/expiry suppression, `publicationVersion` ve cache purge ile atomik değildi. | Başlangıç/expiry worker'ı, row lock, publication version artışı ve purge transaction akışı eklendi. |
| 11 | P1 | “Aynı transaction” ifadesi `READ COMMITTED` altında iki statement'ın farklı publication state görmesini engellemiyordu. | Lookup active pointer + resolved data + suppression için tek SQL statement/CTE kullanacak. |
| 12 | P1 | Suppression, governance ve retention yazma yetkilerinin sahibi yoktu; migration owner'ın runtime'da kullanılması riski vardı. | Ayrı least-privilege runtime rolleri ve audit INSERT-only yetkisi tanımlandı. |
| 13 | P1 | Correction başvurularının kişisel iletişim/kanıt verisinin hangi tabloda tutulacağı belirsizdi; fiziksel V1 tablo listesiyle çelişiyordu. | İçerik dış erişim-kontrollü ticket sistemine taşındı; DB yalnız opaque referans ve audit tutuyor. |
| 14 | P1 | Evidence API ham satır SHA-256'sını güvenli opaque değer gibi sunuyordu; düşük entropili satırlar sözlük saldırısıyla tahmin edilebilirdi. | Public hash kaldırıldı, opaque `evidenceId` kullanıldı. |
| 15 | P1 | Hak alanları vardı fakat production kabul matrisi ve expiry davranışı yoktu. | Üçüncü taraf/owner-created hak matrisi, expiry alarmı ve aktivasyon kapısı eklendi. |
| 16 | P1 | GC, retained resolution'ın source release zincirini veya suppression FK'lerini silebilirdi. | Retained `resolution_inputs`, suppression, rollback, ticket ve legal-hold korumaları eklendi. |
| 17 | P2 | `full_snapshot`, `delta` ve `snapshot_complete` kombinasyonları çelişkili olabiliyordu. | Delta için false; production full snapshot için true + EOF/count validation zorunlu oldu. |
| 18 | P2 | Rate limit public `X-Forwarded-For` ile spoof edilebilirdi ve IPv6 davranışı tanımsızdı. | Trusted-edge overwrite, origin firewall, IPv6 `/64` ve IPv4 adres politikası eklendi. |
| 19 | P2 | “Kesin API şeması” nullability, enum ve evidence gövdesini tam tanımlamıyordu. | Alan tipi/nullability tablosu, public enum'lar ve evidence şeması eklendi. |
| 20 | P2 | Lookup'ın U/L ve I/G bitlerini temizleyip temizlemediği belirtilmemişti; aynı input farklı implementasyonlarda farklı sonuç verebilirdi. | Bitlerin değiştirilmediği, yalnız flag olarak raporlandığı bağlayıcı hale geldi. |
| 21 | P2 | Import encoding ve Unicode görünmez/bidi karakter politikası eksikti. | UTF-8/BOM, invalid byte/NUL reddi ve bidi/zero-width review kapısı eklendi. |
| 22 | P2 | Build yalnız source config hash saklıyordu; eski config içeriği hash'ten yeniden oluşturulamazdı. | Secret içermeyen bounded `source_config_snapshot` ile hash birlikte saklanacak. |
| 23 | P2 | `reviewed` UI etiketi “Sahip tarafından incelendi” diyerek bağımsız review izlenimi bozuyordu. | Etiket “Kanıtı incelendi” oldu; `owner_asserted` ayrıca açık uyarı taşıyor. |
| 24 | P2 | Source'ların tamamı günlük fetch varsayılıyordu; manuel ve farklı tazelikte kaynaklar modellenmemişti. | Source bazlı fetch policy, interval, max age ve activation-required alanları eklendi. |

## Dış doğrulama

- [IEEE Registration Authority](https://standards.ieee.org/products-programs/regauth/) sayfası MA-L, MA-M, MA-S, IAB ve CID için ayrı public CSV listing'leri ve UTF-8 kullanımını gösteriyor. Aynı sayfa CID'nin EUI-48/EUI-64 üretmek için kullanılamadığını belirtiyor; CID bu nedenle full-MAC lookup'a alınmadı.
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) problem `type`, `title`, gerçek HTTP `status` uyumu ve extension alanlarının kullanımını doğruluyor. API hata sözleşmesi buna göre sıkılaştırıldı.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) deterministik hash için JCS canonical JSON yöntemini tanımlıyor. Build çıktısı custom key-order algoritması yerine normalize edilmiş I-JSON değerler üzerinde JCS kullanacak.
- IEEE public listing bağlantıları mevcut olsa da otomatik fetch'in her istemci için kesintisiz çalışacağı garanti değil. Fetch hatası hiçbir zaman aktif release'i bozmayacak; sistem son doğrulanmış release'i sunmaya devam edecek.

## Henüz doğrulanamayacak alanlar

- Çalıştırılabilir kod olmadığı için unit, integration, migration, concurrency, cache ve load testleri çalıştırılamadı.
- IEEE veya başka bir kaynağın public listing sunması yeniden dağıtım izni kanıtı değildir; production hak incelemesi hâlâ launch blocker'dır.
- CDN, object storage, deployment platformu ve dış ticket sistemi seçilmediği için provider-specific purge, object lock, IAM ve retention davranışları test edilemez.
- İlk owner-curated veritabanı verilmediği için manifest, provenance, range decomposition ve gizlilik kapıları gerçek veri üzerinde sınanmadı.

## Belge doğrulama sonucu

- 7 Markdown belge tarandı.
- Ana aksiyon kaydı tam olarak 25 satır içeriyor.
- Bu denetim 24 onarılmış kusur içeriyor.
- Yerel Markdown link hedefleri mevcut.
- Code fence sayıları dengeli ve trailing-whitespace kontrolü temiz.
- Eski endpoint, enum, polymorphic target ve kaldırılmış override modeline ait aktif normatif referans kalmadı.
