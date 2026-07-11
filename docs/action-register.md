# macvendor.io — 25 maddelik aksiyon kaydı

Tarih: 11 Temmuz 2026

`Tasarım kapandı`, kararın bağlayıcı belgeye işlendiğini belirtir. v0.0.1 çekirdek lookup, PostgreSQL şeması, API, demo seed ve testleri uygular; production ingest/CDN/operasyon maddelerinin tamamlandığı anlamına gelmez.

| No | Gözden kaçan konu | Alınan aksiyon | Durum | Bağlayıcı yer |
|---:|---|---|---|---|
| 1 | Resmî atama yokken kürasyonlu eşleşmenin saklanamaması | `resolved_assignment_id` bağımlılığı kaldırıldı; bağımsız `resolved_claims` tablosu tanımlandı. | Tasarım kapandı | [`data-contract.md` — `resolved_claims`](./data-contract.md) |
| 2 | Amatör kayıtların exact/prefix/range biçimi | 1–48 bit CIDR-benzeri prefix kabul edildi; `/48` exact'tir. Keyfi range/wildcard reddedilir veya adapter tarafından kayıpsız CIDR parçalarına ayrılır. | Tasarım kapandı | [`data-contract.md` — desteklenen eşleşme](./data-contract.md) |
| 3 | Exact MAC gizlilik sınırı | 37–47 bit hassas, `/48` cihaz tanımlayıcı olarak sınıflandı. `/48` varsayılan QA-only; kişi/konum/SSID/zaman public değildir. | Tasarım kapandı | [`governance.md` — gizlilik](./governance.md) |
| 4 | Hak beyanı, kanıtı ve kullanım kapsamı | Kaynak manifesti, hak dayanağı, review durumu/referansı ve `internal_only/api_output/raw_redistribution` kapsamları tanımlandı; `owner_asserted` bağımsız review gibi gösterilmiyor. | Tasarım kapandı | [`governance.md` — hak ve dağıtım](./governance.md) |
| 5 | Silme, düzeltme, tombstone ve acil bastırma | Full snapshot/delta silme semantiği, immutable düzeltme, tombstone ve release-dışı acil suppression tanımlandı. | Tasarım kapandı | [`data-contract.md` — temporal ve silme](./data-contract.md) |
| 6 | `policyVersion` dışında deterministik build gereksinimleri | Tüm input hash'leri, kod/schema sürümleri, commit, image digest, locale/UTC ve canonical çıktı sırası manifestte sabitlendi. | Tasarım kapandı | [`data-contract.md` — deterministik build](./data-contract.md) |
| 7 | Active release pointer, race ve idempotency | Singleton pointer, advisory lock, `FOR UPDATE` ve artan sürüm tanımlandı; no-op yalnız zaten aktif run için geçerli, salt output-hash eşitliği provenance'i yutamaz. | Tasarım kapandı | [`data-contract.md` — `active_resolution`](./data-contract.md) |
| 8 | CDN invalidation, URL, TTL ve ETag | Canonical URL/308, pozitif-negatif TTL, release-scoped ETag, surrogate purge ve purge alarmı tanımlandı. | Tasarım kapandı | [`operations.md` — cache](./operations.md), [`api-contract.md` — cache](./api-contract.md) |
| 9 | Aynı prefix ve uzunlukta yetkili kaynak çelişkisi | Otomatik tie-break yasaklandı; çelişki release aktivasyonunu bloklar. | Tasarım kapandı | [`data-contract.md` — resolver](./data-contract.md) |
| 10 | Importer poisoning ve kaynak tüketimi | Egress-allowlist fetcher, SSRF/redirect koruması, ağsız parser sandbox'ı, format ve kaynak limitleri tanımlandı. | Tasarım kapandı | [`operations.md` — importer](./operations.md) |
| 11 | Kesin API yanıt şeması | Üç public uç, nullable alanlar, curated sırası/limiti, hata kodları ve örnek JSON sabitlendi. | Tasarım kapandı | [`api-contract.md`](./api-contract.md) |
| 12 | Normalizasyon standardı | Dört kabul edilen MAC biçimi, whole-string doğrulama, canonical uppercase hex, Unicode NFC ve kontrol karakteri reddi tanımlandı. | Tasarım kapandı | [`data-contract.md` — normalize etme](./data-contract.md) |
| 13 | Kaynak state machine ve `enabled`/`publish_mode` çelişkisi | `enabled` kaldırıldı. Tek çalışma anahtarı `publish_mode`; source release durum geçişleri ayrıca tanımlandı. | Tasarım kapandı | [`data-contract.md` — `data_sources`](./data-contract.md) |
| 14 | Temporal semantik | `observed_at`, `effective_from`, `withdrawn_at`, snapshot türü ve kaybolan kayıt davranışı ayrıldı. | Tasarım kapandı | [`data-contract.md` — temporal ve silme](./data-contract.md) |
| 15 | Kaynak gerçekliği, imza ve review | İmzalı commit/tag veya onaylı detached signature, hash zinciri ve hazırlayan-onaylayan ayrılığı zorunlu oldu. | Tasarım kapandı | [`governance.md` — kaynak özgünlüğü](./governance.md) |
| 16 | İç yetkilendirme, roller, secret ve audit | Ayrı runtime DB rolleri, secret manager/kısa ömürlü kimlik ve değişmez audit olayları tanımlandı. | Tasarım kapandı | [`operations.md` — yetki ve DB rolleri](./operations.md) |
| 17 | Retention ve garbage collection | Artifact, rejected import, audit, access log ve düzeltme kayıtları için süreler ve hash referansı koruma kuralı belirlendi. | Tasarım kapandı | [`operations.md` — retention](./operations.md) |
| 18 | RPO/RTO | PITR, sınıfa göre RPO, 4 saat RTO, üç aylık restore ve altı aylık rebuild testi belirlendi. | Tasarım kapandı | [`operations.md` — backup](./operations.md) |
| 19 | Resource ve payload limitleri | Artifact, açılmış veri, satır, alan, JSON, kaynak, sonuç, evidence ve süre limitleri sayısal olarak sabitlendi. | Tasarım kapandı | [`operations.md` — kaynak limitleri](./operations.md) |
| 20 | Fuzz, race, migration, cache ve failure testleri | Test matrisi ve trafik tahmini gelene kadar geçici 100 RPS/15 dk kabul tabanı tanımlandı. | Tasarım kapandı | [`operations.md` — test matrisi](./operations.md) |
| 21 | UI'da resmî ve amatör verinin karışması | IEEE `official assignment`; curated kayıtlar doğrulama seviyeleriyle ayrı bölüm ve rozetlerde gösterilecek. | Tasarım kapandı | [`governance.md` — UI sunumu](./governance.md) |
| 22 | Düzeltme ve takedown kanalı | Public süreç sayfası, yapılandırılmış e-posta durumu, zorunlu kanıt, hedef süre, acil suppression ve audit iş akışı uygulandı. Dış ticket backend ve sorumlu ataması hâlâ production girdisidir. | Kısmi uygulandı (v0.0.11) | [`governance.md` — düzeltme ve takedown](./governance.md), [`/data-corrections`](../src/app/data-corrections/page.tsx) |
| 23 | Attribution ve disclaimer | Zorunlu ürün metni ile public kaynak, metodoloji, veri şartları ve düzeltme sayfaları uygulandı. | Uygulandı (v0.0.11) | [`governance.md` — disclaimer ve attribution](./governance.md), [`/legal/data-terms`](../src/app/legal/data-terms/page.tsx) |
| 24 | V1 fiziksel tablo kapsamı ile gelecek fikirlerin karışması | V1 için 12 fiziksel tablo listelendi; hesap, ödeme, org katalog ve vendor search ertelendi. | Tasarım kapandı | [`data-contract.md` — fiziksel V1 tabloları](./data-contract.md) |
| 25 | Vendor alias geleceği | Alias V1'de yalnız claim; fuzzy auto-merge yok. Gelecek `organizations/aliases/claim_links` migration sınırı tanımlandı. | Tasarım kapandı | [`data-contract.md` — vendor alias](./data-contract.md) |

## Uygulama öncesi dış girdiler

Bu beş konu tasarımla uydurulamaz; gerçek karar veya kanıt gerekir:

1. IEEE ve production'a girecek her üçüncü taraf kaynak için yazılı hak incelemesi.
2. Amatör veritabanı işi kullanıcı yeniden başlatana kadar ertelendi; bu sırada
   gerçek satır, manifest veya örnek veri sisteme alınmayacak.
3. Production CDN/object storage sağlayıcısı; purge ve object-lock ayrıntıları buna göre uygulanacak.
4. Gerçek trafik tahmini ve kötüye kullanım profili; başlangıç rate/load eşikleri buna göre ölçülecek.
5. `DATA_CORRECTIONS_EMAIL`, veri sorumlusu ve nöbet/escalation sahipleri.

Bu girdiler gelmeden şema ve normalizer geliştirilebilir. Ancak kaynak yayını, production kapasite iddiası ve düzeltme SLA'sının işletilmesi tamamlanmış sayılamaz.
