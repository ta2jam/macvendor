# Operasyon, güvenlik ve test sözleşmesi

## Job modeli

Importer ve resolver aynı repo/build artifact'inden CLI komutlarıdır. Public admin endpoint yoktur.

Her job:

- Import için `(source_id, import_key)`, resolution için `(input_manifest_hash, policy_commit_sha, schema_version)` idempotency anahtarı kullanır.
- İş türüne göre advisory lock alır: ingest için source-scoped, resolver için tek global build lock, activation için tek global publication lock.
- Başlangıç/bitiş/audit event yazar.
- Timeout ve bounded retry uygular.
- Aynı idempotency anahtarı tamamlanmışsa no-op olur. Artifact byte'larının aynı olması, adapter/normalizer/policy değiştiğinde no-op nedeni değildir.

Scheduler timezone `UTC` kullanır; her kaynağın `fetch_policy/fetch_interval_seconds` ayarına göre çalışır ve scheduled fetch'e jitter eklenir.

### Migration bütünlüğü

`migrations/checksums.json` deploy edilen SQL dosya kümesinin birebir SHA-256
ledger'ıdır. Migrator DB bağlantısından önce dosya/ledger eşleşmesini, advisory
lock altında da `schema_migrations(name, checksum)` geçmişini doğrular. Uygulanmış
bir dosya değişmişse, DB geçmişindeki dosya deploy setinden eksikse veya ledger
eksikse yeni SQL çalıştırılmaz. Eski yalnız-filename geçmişi ancak doğrulanmış
ledger hash'leriyle aynı transaction içinde backfill edilir ve checksum kolonu
yeniden `NOT NULL` yapılır.

```bash
npm run db:migrations:verify
npm run db:migrate
```

`APPLIED_MIGRATION_DRIFT` ve `APPLIED_MIGRATION_MISSING` otomatik onarım nedeni
değildir. Dosyayı değiştirmek veya history satırını silmek yasaktır; yeni bir
ileri migration hazırlanır ya da yanlış deployment artifact'i geri çekilir.

### Source governance mutation

`source:governance` varsayılan olarak preview'dur; `--apply` ve
`OPERATOR_ACTOR_ID` olmadan DB yazmaz. Apply global governance advisory lock ve
source row lock altında config update, monoton `config_version` ve immutable
audit event'i birlikte commit eder. Aktif publication'ı zayıflatan patch explicit
risk acceptance olmadan durur. Commit sonrası `data-release` surrogate key purge
edilir; hata committed sonucu içeren non-zero çıktı üretir.

Karar belgesi review artifact'i olarak ticket sisteminde saklanır. Repo örneği
yalnız no-op preview içindir; bir rights approval kanıtı değildir.

### IEEE güncelleme job'u

```bash
OPERATOR_ACTOR_ID=operator:ieee-scheduler npm run source:update:ieee
```

Komut sabit MA-L/MA-M/MA-S URL'lerini prepare, verify, import, resolve ve activate
eder; commit sonrası surrogate purge ve source-health kontrolünü çalıştırır.
Session-level advisory lock nedeniyle çakışan ikinci job `already_running`
döndürür. Sağlayıcıya özgü scheduler bu repoya gömülü değildir; günlük UTC
çalıştırma, jitter, secret injection ve non-zero exit alarmı deployment
sorumluluğudur.

Değişmeyen artifact yeni source release veya active version üretmez. Bunun
yerine yeni append-only fetch observation yazar; freshness bu son gözlemden
hesaplanır. Import, observation veya build hatası mevcut active pointer'ı
değiştirmez; doğrulanmış ara kayıtlar audit/provenance için kalabilir. Activation
commit'inden sonraki purge/health hatası rollback olmuş gibi sunulmaz:
`IeeeUpdatePostCommitError.committed=true` ve hata fazı raporlanır.

## Yetki ve DB rolleri

- `app_readonly`: Active pointer, resolved assignments/claims, publication suppressions ve public release metadata okur.
- `ingest_writer`: Source release/artifact/record yazar; resolved veya active pointer yazamaz.
- `resolver_writer`: Resolution tablolarını yazar; active pointer değiştiremez.
- `release_activator`: Yalnız validated run aktivasyonu/rollback ve audit event.
- `publication_guard`: Yalnız suppression ekleme/revoke/expire, `publication_version` artırma ve audit event.
- `governance_writer`: Source config, publish mode ve rights review metadata değişikliği; ingest/resolution yazamaz.
- `retention_worker`: Yalnız retention politikasıyla seçilmiş retired/rejected kayıtları siler; active/retained FK zincirini aşamaz.
- `migration_owner`: Runtime'da kullanılmaz.

Kimlik bilgileri secret manager veya deployment secret store'da tutulur. Repo, log veya source manifest içine yazılmaz. Rotasyon runbook'u bulunur.

Runtime roller `audit_events` için yalnız `INSERT` yetkisine sahiptir; `UPDATE/DELETE` yoktur. Governance, activation ve suppression komutları insan/iş yükü kimliğini opaque actor ID olarak audit'e yazar. Production komutları doğrudan geliştirici laptop kimliğiyle çalıştırılmaz.

### Fetcher sınırı

Kaynağı indiren process parser'dan ayrıdır:

- Yalnız source config içinde önceden onaylanmış HTTPS origin/port allowlist'ine çıkar.
- Redirect varsayılan kapalıdır; açılırsa her hop yeniden allowlist ve maksimum redirect sayısı kontrolünden geçer.
- DNS sonucu private, loopback, link-local, metadata-service ve internal network aralıklarına çözülürse istek reddedilir; connect öncesi ve redirect sonrası yeniden doğrulanır.
- TLS sertifika doğrulaması kapatılamaz.
- Response streaming sırasında byte limiti uygulanır; `Content-Length` ve `Content-Type` güvenilir kabul edilmez.
- Kimlik bilgisi URL, redirect, artifact metadata veya loglara yazılmaz.

## Importer izolasyonu

V1 kabul edilen artifact biçimleri:

- Plain CSV.
- Plain TSV.
- Bounded JSON/JSON Lines.

V1'de ZIP/TAR, XML, executable format ve macro içeren spreadsheet alınmaz. Böylece archive bomb, zip-slip ve XXE yüzeyi kaldırılır.

Text artifact yalnız geçerli UTF-8 kabul eder; UTF-8 BOM normalize katmanında kaldırılır. Invalid byte sequence, beklenmeyen NUL veya ilan edilen şemayla uyuşmayan delimiter release'i reddeder. Ham artifact object storage'dan doğrudan public servis edilmez.

Parser ayrı sandbox/container process'inde çalışır:

- Fetch tamamlandıktan sonra network kapalı.
- Read-only root filesystem.
- Ayrı geçici dizin.
- CPU, memory, wall-time ve disk quota.
- Symlink takip edilmez.
- Dosya adı path olarak güvenilmez.

## Başlangıç kaynak limitleri

Limitler configuration'dır; artırma ölçüm ve review ister.

| Limit | Değer |
|---|---:|
| İndirilen artifact | 20 MiB |
| Parse edilen toplam byte | 100 MiB |
| Source release satır sayısı | 250.000 |
| Tek satır | 64 KiB |
| Tek metin alanı | 16 KiB |
| `claim_value` / validation JSONB | 32 KiB / 256 KiB |
| JSON nesting | 20 |
| `claim_value` JSON nodes | 4.096 |
| Source sayısı | 32 |
| Bir lookup'ta curated sonuç | 20 |
| Evidence detay endpoint'i | 100 kayıt |
| Import wall time | 5 dakika |
| Resolver wall time | 10 dakika |

Limit aşımı partial import üretmez; source release reddedilir.

## Validation gate'leri

### Source release

- Artifact hash ve manifest uyumu.
- Production input için hak matrisi: üçüncü taraf kaynak `rights_status=approved`, süresi dolmamış review ve V1'de `distribution_scope=api_output`; owner-created kaynak en az `owner_asserted`, `owner_created` ve `api_output` ister.
- Şema/header ve encoding doğrulaması.
- Prefix ve alan constraint'leri.
- Duplicate/conflict sayımı.
- Önceki release'e göre kayıt farkı.
- Authoritative registry %95 altına düşerse karantina.
- Owner-curated `unknown` hak/köken kayıtları QA-only.
- Hassas `/37–/48` kayıtların gizlilik review kontrolü.

### Resolution run

- Tüm input release'ler valid.
- Input manifest hash sabit.
- Her input için source config snapshot/hash uyumu.
- Authoritative same-length conflict yok.
- Evidence ve suppression FK/check constraint'leri geçiyor.
- Her resolved assignment/claim hot-path source slug ve source release snapshot'ı taşıyor.
- Owner-curated claim core assignment'ı mutate etmiyor.
- Golden ve boundary testleri geçiyor.
- Aynı input/policy için output hash önceki build ile aynı.

## Aktivasyon, rollback ve yarış koşulları

- Aynı anda yalnız bir ingest per source ve bir resolver çalışabilir.
- Advisory lock alınamazsa job fail değil `already_running` sonucu verir.
- Aktivasyon tek DB transaction'ıdır.
- Public lookup tek SQL statement/CTE içinde active pointer, resolved kayıtlar ve suppression overlay'ini okur; PostgreSQL `READ COMMITTED` altında iki ayrı statement kullanıp publication değişimini karıştırmaz.
- Rollback yalnız önceki `retired` ve validation geçmişi sağlam run'a yapılır.
- Rollback yeni audit event ve pointer version üretir; geçmiş silinmez.
- Gelecek başlangıç zamanlı suppression doğrudan yazılmaz; scheduler zamanı geldiğinde transaction içinde aktive eder. Expiry worker due kayıtları expire eder, `publicationVersion` artırır ve purge tetikler.

## Cache sözleşmesi

### Canonical URL

Canonical lookup URL 12 uppercase bare hex kullanır:

`/v1/lookup/082532E00000`

Kabul edilen diğer biçimler normalize edilir ve `308 Permanent Redirect` ile canonical URL'ye yönlendirilir. Geçersiz veya mixed format redirect edilmez; 400 döner.

### Header'lar

Pozitif ve curated sonuç:

- `ETag: "rr-{activeVersion}-pv-{publicationVersion}-{responseHash}"`
- `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=604800`
- `Surrogate-Key: data-release resolved-release-{resolutionRunId}`

Geçerli fakat eşleşmeyen MAC:

- `Cache-Control: public, max-age=60, s-maxage=3600`

Hata, rate-limit ve evidence içeren response shared cache'e girmez.

### Aktivasyon sırası

1. DB pointer transaction commit.
2. Yeni active version uygulama tarafından okunabilir olur.
3. Eski surrogate key purge edilir.
4. Purge başarısızsa alarm; bounded TTL stale pencereyi sınırlar.

Suppression ekleme/revoke/expire işlemi `publicationVersion` değerini atomik artırır ve aynı release surrogate key'ini purge eder. Origin yeni overlay'i transaction commit edildiği anda uygular; paylaşılan edge cache purge ile, istemci cache'i ise en geç beş dakikalık `max-age` sonunda temizlenir.

Mutation CLI'ları commit sonrasında provider-bağımsız bir HTTPS adapter'ına şu
sözleşmeyle çağrı yapar:

```http
POST ${CACHE_PURGE_ENDPOINT}
Authorization: Bearer ${CACHE_PURGE_TOKEN}
Content-Type: application/json

{"surrogateKeys":["data-release","resolved-release-<uuid>"]}
```

Endpoint credentials/query/fragment içeremez; key sayısı ve biçimi sınırlıdır,
redirect izlenmez ve çağrı 5 saniyede kesilir. Production'da
`CACHE_PURGE_REQUIRED=true` olmalıdır. Purge hatası commit'i geri almış gibi
sunulmaz: CLI non-zero çıkar ve commit edilmiş mutation bilgisini makine-okunur
hata içinde döndürür. Gerçek provider adapter'ı ve alarm teslimatı, CDN seçilip
staging'de doğrulanana kadar dış bağımlılıktır.

Aktif build'de kullanılan bir source'un hak/config değişikliği `/v1/data-release` surrogate key'ini purge eder. Lookup çıktısı suppression/rollback olmadan değiştirilmez.

Provider custom cache-key destekliyorsa active pointer version CDN key'e eklenir. Desteklemiyorsa purge zorunludur.

Rate-limit header'ları cache edilen origin body ile birleştirilmez; edge response aşamasında eklenir.

## Rate limiting ve DoS

Mevcut token bucket process-local fallback'tir; yatay ölçekli ortak kota
değildir. Edge sağlayıcısı, güvenilen IP sözleşmesi ve gerçek trafik/abuse
ölçümleri olmadan Redis veya PostgreSQL hot-path yazısı eklenmeyecektir. Bu iş
[#19](https://github.com/ta2jam/macvendor/issues/19) üzerinde blocked durumdadır.

- İlk koruma edge token bucket: IP başına 5 req/s, burst 25; ölçümle değişir.
- Client IP yalnız güvenilen edge/load-balancer'ın overwrite ettiği header'dan alınır; public `X-Forwarded-For` zincirine doğrudan güvenilmez. Doğrudan origin erişimi firewall ile kapalıdır.
- IPv6 limiti varsayılan `/64`, IPv4 limiti adres bazlıdır; NAT etkisi metriklerle izlenir.
- Origin global concurrency limiti load test ile belirlenir.
- Günlük IP kotası ürün planı olarak sunulmaz.
- 429 yanıtı `Retry-After` taşır.
- Path/input uzunluğu request parsing öncesi sınırlandırılır.
- Evidence endpoint'i lookup'tan daha düşük limite sahiptir.

## Retention ve garbage collection

| Veri | Retention |
|---|---|
| Active + başarılı resolved releases | Son 8 release, minimum 90 gün |
| Rejected resolution metadata/hash | 1 yıl |
| Valid source releases | Son 8 release, minimum 90 gün |
| Rejected source records | 30 gün; manifest/hash 1 yıl |
| Production raw artifacts | 1 yıl, versioned object storage |
| QA-only raw artifacts | 90 gün |
| Audit events ve rights review refs | Minimum 2 yıl |
| Expired/revoked publication suppression | 1 yıl; karar özeti audit'te 2 yıl |
| Public access log | 7 gün |
| Hassas correction başvuru içeriği | Kapanıştan sonra 90 gün; ticket özeti 1 yıl |

GC active pointer, retained bir `resolution_inputs` zinciri, henüz retention süresi dolmamış suppression FK'si, rollback seti, açık correction/ticket veya legal hold ile ilişkili hiçbir source release/artifact/resolved run'ı silemez. Orphan artifacts haftalık raporlanır, 7 günlük grace period sonrası temizlenir.

Correction başvurusunun iletişim ve kanıt içeriği V1 PostgreSQL şemasında tutulmaz; erişim kontrollü dış ticket sistemindedir. DB yalnız opaque ticket reference ve karar audit olayını tutar. Retention satırı bu dış sistem için de uygulanır.

## Backup, RPO ve RTO

- PostgreSQL PITR: en az 7 gün.
- Configuration, rights, suppression ve correction audit verisi RPO: en fazla 15 dakika.
- Kaynak/resolved veri RPO: 24 saat; immutable artifact'ten yeniden üretilebilir.
- Public servis RTO: 4 saat.
- Dış correction ticket sistemi: RPO 24 saat, RTO 4 saat; günlük şifreli export veya sağlayıcı backup kanıtı.
- Object storage versioning açık.
- Günlük logical backup + managed physical backup/PITR.
- Quarterly restore drill.
- Altı ayda bir artifact'ten sıfırdan rebuild drill.

Logical backup, disposable restore ve sentetik artifact'tan sıfır kurulum
komutları [`recovery.md`](recovery.md) içinde uygulanmıştır ve container CI'da
çalışır. PITR/WAL arşivleme, şifreli/versioned uzak hedef, scheduler ve RPO alarmı
sağlayıcı seçilmeden tamamlanmış sayılmaz.

Disaster durumunda öncelik son doğrulanmış resolved release'i read-only servis etmektir; importer kapalı kalabilir.

## Gözlemlenebilirlik ve sahiplik

### SLO hedefleri

- Aylık availability: %99,9 hedef.
- Origin p95: 75 ms altında hedef.
- Her `required_for_activation` kaynağın yaşı kendi `max_acceptable_age_seconds` sınırının altında; IEEE için başlangıç değeri 48 saat.
- Source import: 5 dakika altında.
- Resolution: 10 dakika altında.

Bunlar ölçüm hedefidir; ölçülmeden garanti değildir.

### Metrikler

- HTTP p50/p95/p99 ve status sınıfları.
- Cache hit/miss/purge failure.
- DB pool saturation ve query latency.
- Source fetch/validation/rejection.
- Kayıt/claim/conflict/suppression sayıları.
- Active pointer version ve release age.
- Hak review expiry ve aktif build'in source-config version uyumu.
- Curated verification/origin dağılımı.
- Correction queue age.

Configured production-source freshness and rights state can be checked without
changing the database:

```bash
npm run source:health
npm run source:health -- --warning-days 45
```

The command emits JSON. Active-resolution inputs are monitored instead of being
masked by a newer but unpublished release or disappearing after a publish-mode
change. It exits `1` for expired/blocked rights, non-API scope, missing or
inactive required releases, stale active releases, invalid active inputs,
active non-production sources, or future-dated fetch timestamps. Build/current
config-version drift, approaching rights expiry, and a missing freshness
threshold are warnings and do not change the exit code. A successful rebuild
and activation snapshots the current config versions and clears drift. The
database query uses the latest-valid-release index and the evaluator is `O(S)`
for `S` configured production or currently active sources; report memory is
also `O(S)`.

### Alarm sahipliği

Her alarm runbook URL, severity ve owner taşır. Başlangıçta owner proje sahibidir; boş owner ile alarm oluşturulmaz.

P0:

- Active release yok/mixed release şüphesi.
- Authoritative same-length conflict.
- DB erişilemiyor.
- Hassas veri public response şüphesi.

P1:

- Required source yaşı kendi configured sınırını aşıyor.
- Aktif release içindeki bir kaynağın hak review'u expired/rejected duruma geçti.
- İki ardışık authoritative fetch hatası.
- CDN purge hatası.
- Restore/PITR başarısızlığı.

## Test matrisi

### Unit/property

- MAC format parser property tests.
- Prefix mask/leading-zero/boundary property tests.
- `block_size = end - start + 1`.
- Unicode/control-character normalization.
- Source state-machine transition tests.
- Import key'in adapter/normalizer/schema değişiminde değişmesi.

### Fuzz

- Public MAC/prefix parser.
- CSV/TSV/JSON importer.
- Deep/large/malformed JSON.
- Encoding ve truncated input.

### Resolver

- Same input + policy = same output hash.
- Same-length authoritative conflict rejection.
- Owner-curated no-official-match claim.
- Unknown rights suppression.
- Expired rights review'in yeni aktivasyonu engellemesi ve aktif release alarmı.
- Tombstone/withdrawal/suppression.
- Stale optional source.

### Database/migration

- Forward-only migration testi.
- Eski app + yeni schema ve yeni app + geçiş schema compatibility.
- Constraint/index existence.
- Evidence/suppression FK ve exactly-one-target constraint'leri.
- Advisory lock ve concurrent activation.
- Pointer rollback sırasında canlı trafik.

### Cache/edge

- Noncanonical 308.
- Positive/negative TTL.
- ETag/304.
- Activation purge.
- Suppression overlay, `publicationVersion` ve purge.
- Suppression başlangıç/expiry worker yarışı.
- Purge failure stale sınırı.
- Rate-limit header'ın cache edilmemesi.

### Failure injection

- Upstream timeout/500/truncated artifact.
- Object storage write/read failure.
- DB commit failure.
- Resolver crash mid-build.
- CDN purge failure.
- Restore ve rebuild.

### Load

- Beklenen pik x10; tahmin yoksa 100 RPS/15 dakika başlangıç baseline.
- Cache-hit ve cache-miss ayrı ölçülür.
- 48 curated prefix probe worst case ölçülür.
- CPU, memory, DB pool ve enerji/IO sürücüleri raporlanır.
