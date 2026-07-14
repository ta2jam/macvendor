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
| 7 | Active release pointer, race ve idempotency | Singleton pointer, tek source-publication lock, açık base-resolution snapshot, activation compare-and-swap, `FOR UPDATE` ve artan sürüm uygulandı; stale build pointer'ı değiştiremez, no-op yalnız zaten aktif run için geçerlidir. | Uygulandı (v0.5.7) | [`data-contract.md` — `active_resolution`](./data-contract.md) |
| 8 | CDN invalidation, URL, TTL ve ETag | Canonical URL/308, pozitif-negatif TTL, release-scoped ETag, surrogate purge ve purge alarmı tanımlandı. | Tasarım kapandı | [`operations.md` — cache](./operations.md), [`api-contract.md` — cache](./api-contract.md) |
| 9 | Aynı prefix ve uzunlukta yetkili kaynak çelişkisi | Otomatik tie-break yasaklandı; çelişki release aktivasyonunu bloklar. | Tasarım kapandı | [`data-contract.md` — resolver](./data-contract.md) |
| 10 | Importer poisoning ve kaynak tüketimi | Egress-allowlist fetcher, SSRF/redirect koruması, ağsız parser sandbox'ı, format ve kaynak limitleri tanımlandı. | Tasarım kapandı | [`operations.md` — importer](./operations.md) |
| 11 | Kesin API yanıt şeması | Üç public uç, nullable alanlar, curated sırası/limiti, hata kodları ve örnek JSON sabitlendi. | Tasarım kapandı | [`api-contract.md`](./api-contract.md) |
| 12 | Normalizasyon standardı | Dört kabul edilen MAC biçimi, whole-string doğrulama, canonical uppercase hex, Unicode NFC ve kontrol karakteri reddi tanımlandı. | Tasarım kapandı | [`data-contract.md` — normalize etme](./data-contract.md) |
| 13 | Kaynak state machine ve `enabled`/`publish_mode` çelişkisi | `enabled` kaldırıldı. Tek çalışma anahtarı `publish_mode`; source release durum geçişleri ayrıca tanımlandı. | Tasarım kapandı | [`data-contract.md` — `data_sources`](./data-contract.md) |
| 14 | Temporal semantik | `observed_at`, `effective_from`, `withdrawn_at`, snapshot türü ve kaybolan kayıt davranışı ayrıldı. | Tasarım kapandı | [`data-contract.md` — temporal ve silme](./data-contract.md) |
| 15 | Kaynak gerçekliği, imza ve review | İmzalı commit/tag veya onaylı detached signature, hash zinciri ve hazırlayan-onaylayan ayrılığı zorunlu oldu. | Tasarım kapandı | [`governance.md` — kaynak özgünlüğü](./governance.md) |
| 16 | İç yetkilendirme, roller, secret ve audit | Ayrı runtime DB rolleri, secret manager/kısa ömürlü kimlik ve değişmez audit olayları tanımlandı. | Tasarım kapandı | [`operations.md` — yetki ve DB rolleri](./operations.md) |
| 17 | Retention ve garbage collection | Süreler ve hash referansı koruma kuralı belirlendi; expired retired-resolution GC 90 günlük taban, sekiz rollback run'ı, suppression koruması, iki-run batch sınırı ve append-only audit ile devreye alındı. | Uygulandı (v0.5.6) | [`operations.md` — retention](./operations.md) |
| 18 | RPO/RTO | 24 saat logical-backup RPO, 4 saat RTO, günlük şifreli off-host kopya, üç aylık gerçek-dump restore ve altı aylık rebuild testi belirlendi. | Uygulandı (v0.5.5) | [`operations.md` — backup](./operations.md) |
| 19 | Resource ve payload limitleri | Artifact, açılmış veri, satır, alan, JSON, kaynak, sonuç, evidence ve süre limitleri sayısal olarak sabitlendi. | Tasarım kapandı | [`operations.md` — kaynak limitleri](./operations.md) |
| 20 | Fuzz, race, migration, cache ve failure testleri | Test matrisi uygulandı; 15 dakikalık privacy-preserving trafik özeti peak, 429 ve 5xx investigation eşiklerini besliyor. | Uygulandı (v0.5.5) | [`operations.md` — test matrisi](./operations.md) |
| 21 | UI'da resmî ve amatör verinin karışması | IEEE `official assignment`; curated kayıtlar doğrulama seviyeleriyle ayrı bölüm ve rozetlerde gösteriliyor. | Uygulandı | [`governance.md` — UI sunumu](./governance.md) |
| 22 | Düzeltme ve takedown kanalı | Public form, şifreli iletişim, opaque reference, append-only event, operator CLI, SLA timer, suppression ve repository-owner sorumluluğu uygulandı. | Uygulandı (v0.5.5) | [`governance.md` — düzeltme ve takedown](./governance.md), [`incident-ownership.md`](./incident-ownership.md), [`/data-corrections`](../src/app/data-corrections/page.tsx) |
| 23 | Attribution ve disclaimer | Zorunlu ürün metni ile public kaynak, metodoloji, veri şartları ve düzeltme sayfaları uygulandı. | Uygulandı (v0.0.11) | [`governance.md` — disclaimer ve attribution](./governance.md), [`/legal/data-terms`](../src/app/legal/data-terms/page.tsx) |
| 24 | V1 fiziksel tablo kapsamı ile gelecek fikirlerin karışması | Governed organization identity records ve exact identifier search eklendi; hesap ve ödeme kapsam dışında tutuldu. | Uygulandı | [`data-contract.md` — fiziksel V1 tabloları](./data-contract.md) |
| 25 | Vendor alias geleceği | Alias V1'de yalnız claim; fuzzy auto-merge yok. Gelecek `organizations/aliases/claim_links` migration sınırı tanımlandı. | Tasarım kapandı | [`data-contract.md` — vendor alias](./data-contract.md) |

## Dış girdiye bağlı genişleme kapıları

Bu beş konu tasarımla uydurulamaz; gerçek karar veya kanıt gerekir:

1. IEEE için 2026-07-11 owner risk acceptance kaydedildi; 2027-07-11'de veya
   çelişkili yeni şart çıktığında yeniden review zorunlu. IEEE dışındaki her
   production üçüncü taraf kaynak için ayrıca yazılı hak incelemesi gerekir.
2. Owner-created intake karantina hattı hazırdır; production değerlendirmesi
   ancak gerçek dosya ve hak/gizlilik beyanı geldiğinde başlayan ayrı bir karardır.
3. Mevcut trafik seviyesinde kısa TTL ve release-scoped ETag kullanılır; cache
   purge kimliği production bağımlılığı değildir. Harici object storage/PITR,
   bağımsız sağlayıcı seçildiğinde bir kapasite genişlemesidir.
4. Caddy loglarından kişisel veri içermeyen 24 saatlik istek, peak-minute, 429,
   5xx ve origin süre özeti 15 dakikada bir üretilir; eşikler gerçek veriyle
   yeniden değerlendirilir.
5. Şifreli correction kuyruğu sistem kaydıdır; repository-owner production,
   correction ve data-decision rollerinden sorumludur. Slack `#team` yalnız
   failure/recovery bildirim kanalıdır.

Bu girdiler mevcut V1'in tamamlanmamış işi değildir. Yeni veri, ekip üyesi,
ölçülen kapasite baskısı veya harici sağlayıcı geldiğinde yeniden açılan
genişleme kapılarıdır.
