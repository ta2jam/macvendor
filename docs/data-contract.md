# Veri sözleşmesi

Bu belge verinin nasıl temsil edildiğini, sürümlendiğini, çözümlendiğini ve aktif edildiğini tanımlar. Şema implementasyonu bu semantiği değiştiremez.

## Desteklenen eşleşme modeli

### Authoritative assignment

IEEE kayıtları yalnız şu prefix uzunluklarını kullanır:

- MA-L: 24 bit.
- MA-M: 28 bit.
- MA-S: 36 bit.
- IAB: 36 bit.
- CID: 24 bit, fakat full MAC lookup'a dahil edilmez.

### Owner-curated claim

Kullanıcı tarafından hazırlanan kaynaklarda desteklenen tek geometrik model CIDR-benzeri prefix'tir:

- `prefix_length`: 1–48.
- Exact MAC: `/48` prefix olarak temsil edilir.
- Arbitrary start/end range, wildcard metni ve maskesi bitişik olmayan desen desteklenmez.
- Range içeren bir kaynak adapter tarafından kayıpsız CIDR prefix'lerine ayrılabiliyorsa alınır; aksi halde kayıt reddedilir.

Bu karar lookup'ı sınırlı ve deterministik tutar. Full EUI-48 için en fazla 48 aday prefix vardır; kaynak sayısı lookup maliyetini değiştirmez.

### Bit temsili

- MAC, unsigned 48-bit değer olarak değerlendirilir.
- `prefix_bits`, MAC'in üst `prefix_length` bitlerinin sağa yaslanmış unsigned tamsayı değeridir: `prefix_bits = mac_uint48 >> (48 - prefix_length)`.
- Leading zero bilgi kaybı değildir; sunum `prefix_length` kullanılarak yeniden üretilir.
- Canonical MAC metni 12 karakter uppercase hex'tir: `082532E00000`.
- Canonical prefix metni `ceil(prefix_length / 4)` uppercase hex karakteridir. Uzunluk nibble sınırında değilse anlamlı bitler son nibble'ın yüksek bitlerine sola yaslanır; örneğin tek bitlik `1` prefix'i `8/1` olarak gösterilir. Kimlik daima `(prefix_bits, prefix_length)` çiftidir; metin DB kimliği değildir.

## Fiziksel V1 tabloları

V1'de aşağıdaki tablolar gerçekten oluşturulur. “Gelecekte gerekebilir” diye ek tablo bırakılmaz.

### `data_sources`

- `id` UUID primary key.
- `slug` unique, immutable.
- `name`.
- `source_class`: `authoritative | enrichment | owner_curated | reference`.
- `publish_mode`: `production | qa_only | disabled`.
- `adapter_key`.
- `fetch_policy`: `scheduled | manual`.
- `fetch_interval_seconds`, `max_acceptable_age_seconds`: manual kaynaklarda nullable.
- `required_for_activation` boolean.
- `homepage_url`, `terms_url`.
- `rights_status`: `unreviewed | owner_asserted | approved | rejected | expired`.
- `rights_basis`: `owner_created | licensed | permission_granted | public_domain_claim | unknown`.
- `distribution_scope`: `internal_only | api_output | raw_redistribution`.
- `rights_review_reference`, `rights_review_expires_at`.
- `fetch_origins`: gözden geçirilmiş HTTPS origin/port allowlist JSON array'i.
- `signature_key_sha256`: güvenilen artifact imza anahtarının SHA-256 parmak izi.
- `diff_policy`: full-snapshot ekleme/çıkarma eşikleri.
- `config_version` monoton artan bigint.
- `created_at`, `updated_at`.

`enabled` alanı yoktur; `publish_mode` tek çalışma anahtarıdır.

Resolver davranışını veya hak/freshness kararını etkileyen her değişiklik `config_version` değerini ve audit event'i aynı transaction'da artırır.

### `source_releases`

- `id` UUID primary key.
- `source_id` foreign key.
- `status`: `fetched | staged | valid | rejected | retired`.
- `snapshot_kind`: `full_snapshot | delta`.
- `snapshot_complete` boolean.
- `schema_version`, `adapter_version`, `normalizer_version`.
- `fetched_at`, `validated_at`.
- `upstream_last_modified`, `upstream_etag`.
- `content_hash`.
- `import_key`: source kimliği, artifact hash listesi, manifest hash'i, adapter/normalizer/schema sürümleri ve import policy sürümünden üretilen SHA-256.
- `record_count`, `rejected_record_count`.
- `validation_report` bounded JSONB.

Unique: `(source_id, import_key)`. Aynı byte'lar yeni adapter veya normalizer ile tekrar işlenebilir; yalnız `content_hash` idempotency anahtarı değildir.

State transition:

- `fetched -> staged`
- `staged -> valid | rejected`
- `valid -> retired`
- `rejected` terminaldir.

`snapshot_kind=delta` için `snapshot_complete=false` zorunludur. Production'a girecek `full_snapshot` için `snapshot_complete=true` ve parser'ın EOF/row-count kontrollerini geçmiş olması zorunludur.

Release satırları immutable'dır. Yalnız state transition ve zaman alanları değişebilir; artifact veya kayıt içeriği değişemez.

### `source_fetch_observations`

- `id`, `source_release_id`.
- `observed_at`, `source_url`, `actor_id`.
- Boyutlandırılmış `metadata`: registry, record/byte sayıları ve adapter uyarıları.

Aynı immutable release byte'larının daha sonra doğrudan ve başarıyla yeniden
alındığını kaydeder. Unique anahtar `(source_release_id, observed_at)` çiftidir;
satırlar append-only trigger ile update/delete'e kapalıdır. Resolver ve source
health ile `/v1/data-release` tazeliği release'in ilk `fetched_at` zamanı yerine
varsa son observation zamanını kullanır. Release kimliği, import key'i veya
active version sırf yeniden-fetch nedeniyle değişmez.

### `source_artifacts`

- `id`, `source_release_id`.
- `dataset_key`.
- `source_url` veya owner-curated repo path.
- `sha256`, `byte_size`, `mime_type`.
- `storage_key`.
- `source_commit_sha`, `source_signature_status`.
- `http_metadata` bounded JSONB.

### `source_records`

- `id`, `source_release_id`.
- `record_kind`: `assignment | curated_vendor_claim | vendor_alias | device_hint | usage_note | tombstone`.
- `record_status`: `eligible | qa_only | suppressed | withdrawn | rejected`.
- `registry`: nullable enum.
- `prefix_bits`, `prefix_length`.
- `organization_name_raw`, `organization_name_display`.
- `organization_address_raw`, `is_private`.
- `claim_value` bounded JSONB.
- `origin_type`: `owner_observation | derived | imported | unknown`.
- `rights_basis`.
- `distribution_scope`.
- `verification_status`: `unverified | single_observation | corroborated | reviewed`.
- `evidence_reference`, `created_by`, `reviewed_by`.
- `observed_at`, `effective_from`, `effective_to`, `withdrawn_at`.
- `raw_record_hash`, `raw_locator`.

Check constraints:

- `prefix_length BETWEEN 1 AND 48`.
- IEEE assignment türleri yalnız 24/28/36 olabilir.
- `is_private=true` ise public organization adı `null` olmalıdır.
- `origin_type=unknown` veya `rights_basis=unknown` production için `eligible` olamaz.
- `/37–/48` owner-curated kayıtlar varsayılan olarak `qa_only` olur; ayrıca gizlilik onayı olmadan production'a giremez.
- `claim_value` en fazla 32 KiB'dir.

`created_by` ve `reviewed_by`, V1'de ayrı kullanıcı tablosuna foreign key değildir; deployment IdP veya dış ticket sistemindeki opaque actor kimliğidir. E-posta veya görünen ad tutulmaz.

### `resolution_runs`

- `id` UUID primary key.
- `status`: `building | validated | rejected | active | retired`.
- `policy_version`.
- `policy_commit_sha`.
- `schema_version`, `normalizer_version`.
- `container_image_digest`.
- `input_manifest_hash`, `output_hash`.
- `started_at`, `completed_at`, `activated_at`.
- Sayım ve validation özeti.

State transition:

- `building -> validated | rejected`
- `validated | retired -> active`
- `active -> retired`
- `rejected` terminaldir.

`active` olan tek run bulunur.

DB partial unique index: `UNIQUE ((status)) WHERE status = 'active'`. Pointer ile active status yalnız aktivasyon transaction'ı tarafından birlikte değiştirilir.

### `resolution_inputs`

- `resolution_run_id`.
- `source_release_id`.
- `role`: `authoritative | enrichment | owner_curated`.
- `freshness_status`: `fresh | stale_accepted`.
- `stale_acceptance_reference`: yalnız `stale_accepted` için zorunlu.
- `source_config_snapshot`: build sırasında kullanılan publish mode, hak kapsamı, config version ve freshness kararının bounded JSONB kopyası; secret/URL credential içermez.
- `source_config_hash`: bu canonical snapshot'ın SHA-256 değeri.

Primary key: `(resolution_run_id, source_release_id)`.

### `resolved_assignments`

Yalnız authoritative atamaları taşır.

- `id` UUID primary key.
- `resolution_run_id`.
- `registry`.
- `prefix_bits`, `prefix_length`.
- `organization_name`, `organization_address`, `is_private`.
- `attribution_status`: `authoritative | authoritative_private`.
- `core_source_record_id`.
- `core_source_slug`, `core_source_release_id`: lookup hot path'inde source tablolarına join gerektirmeyen provenance snapshot'ı.

Unique: `(resolution_run_id, registry, prefix_length, prefix_bits)`.

Lookup index: `(resolution_run_id, prefix_length, prefix_bits)`.

### `resolved_claims`

Owner-curated ve enrichment iddiaları authoritative assignment'tan bağımsızdır. IEEE eşleşmesi olmasa da yaşayabilir.

- `id` UUID primary key.
- `resolution_run_id`.
- `claim_type`: `curated_vendor_claim | vendor_alias | device_hint | usage_note`.
- `prefix_bits`, `prefix_length`.
- `claim_value` bounded JSONB.
- `organization_name`: vendor claim/alias türlerinde API için normalize edilmiş nullable display alanı.
- `verification_status`, `origin_type`.
- `conflict_status`: `agrees | conflicts | no_official_match | not_evaluated`.
- `source_record_id`.
- `source_slug`, `source_release_id`: lookup hot path provenance snapshot'ı.

Index: `(resolution_run_id, prefix_length, prefix_bits)`.

Bu tablo önceki `resolved_annotations -> resolved_assignment_id` çelişkisini kaldırır.

Check constraint, `curated_vendor_claim` için `organization_name` değerini zorunlu kılar. Diğer claim türlerinin public şeması ayrıca sürümlenmeden `claim_value` içeriği lookup yanıtına açılmaz.

### `resolution_evidence`

- `resolution_run_id`.
- `resolved_assignment_id`: nullable FK.
- `resolved_claim_id`: nullable FK.
- `field_name`.
- `source_record_id`.
- `role`: `selected | corroborating | conflicting | suppressed`.
- `reason_code`.

`CHECK (num_nonnulls(resolved_assignment_id, resolved_claim_id) = 1)` uygulanır. Böylece iki gerçek foreign key DB seviyesinde orphan evidence'i ve yanlış target türünü engeller.

### `active_resolution`

Tek satırlı pointer tablosudur.

- `singleton_id = 1` primary key ve check constraint.
- `resolution_run_id` unique foreign key.
- `version` monoton artan release sürümü bigint.
- `publication_version` monoton artan yayın overlay sürümü bigint.
- `updated_at`, `updated_by`.

Aktivasyon transaction'ı:

1. Global PostgreSQL advisory lock alır.
2. `active_resolution` satırını `FOR UPDATE` kilitler.
3. Run'ın `validated` veya rollback için `retired` olduğunu; input manifest, policy ve output hash bütünlüğünü doğrular.
4. Eski run'ı `retired`, yeniyi `active` yapar.
5. Pointer, version ve publication_version'ı günceller.
6. Audit event yazar ve commit eder.

Aynı `resolution_run_id` zaten aktifse tekrar aktivasyon idempotent no-op'tur. Yalnız `output_hash` eşitliği no-op için yeterli değildir: yeni source release veya hak/config snapshot'ı aynı public satırları üretse bile provenance değişmiştir ve yeni active version gerekir.

### `publication_suppressions`

Acil geri çekme ve yanlış veriyi yeni build beklemeden public çıktıdan kapatma mekanizmasıdır.

- `id`.
- `resolution_run_id`: yalnız prefix hedefinde nullable daraltıcı; doluysa yalnız o resolved release için geçerlidir. Exact resolved hedefte ilgili run hedef kaydın FK'sinden türetilir.
- `resolved_assignment_id`: nullable FK.
- `resolved_claim_id`: nullable FK.
- `prefix_bits`, `prefix_length`, `surface`: prefix hedefinde zorunlu; `surface=official | curated | both`.
- `source_slug`: nullable daraltıcı.
- `reason_code`, `ticket_reference`.
- `created_by`, `reviewed_by`.
- `starts_at`, `expires_at`.
- `status`: `active | expired | revoked`.

Check constraint tam olarak şu üç hedeften birine izin verir: `resolved_assignment_id`, `resolved_claim_id` veya eksiksiz `(prefix_bits, prefix_length, surface)` çifti. İki resolved kolon gerçek FK'dir; exact hedefte `resolution_run_id/source_slug` yasaktır. API aktif suppression overlay'ini aynı SQL statement içinde indeksli exact anahtarla kontrol eder; suppressed sonuç body veya shared cache'e girmez. Prefix hedefi rollback sonrasında da koruma gerektiğinde kullanılır. Suppression kaynak veya resolved kaydı silmez. Kalıcı karar yeni source release ve resolution run'a işlenir; geçici overlay daha sonra revoke/expire edilir.

Prefix suppression bir MAC aralığını kapsama testiyle topluca gizlemez; resolved sonucun `(prefix_bits, prefix_length)` kimliğiyle exact eşleşir. Böylece yanlışlıkla daha geniş veya daha dar atamaların bastırılması önlenir.

Partial index'ler `status='active'` için resolved assignment ID, resolved claim ID ve `(prefix_length, prefix_bits, surface, source_slug)` hedeflerini ayrı taşır. `source_slug` yalnız prefix hedefinde kullanılabilir.

Suppression ekleme, revoke ve expire işlemi `active_resolution` satırını kilitleyip `publication_version` değerini aynı transaction'da artırır. Bu değer cache kimliğinin parçasıdır; transaction sonrasında ilgili release surrogate key'i purge edilir.

### `audit_events`

- Kaynak modu/hak durumu değişikliği.
- Release validation.
- Resolution build/activation/rollback.
- Suppression ve governance değişiklikleri.
- Retention/GC.

Audit kayıtları append-only'dir.

## Normalize etme sözleşmesi

### MAC input

Kabul edilen tam biçimler:

- `001122334455`
- `00:11:22:33:44:55`
- `00-11-22-33-44-55`
- `0011.2233.4455`

Tüm input baştan sona tek bir kabul edilen regex'e uymalıdır. Karakter silerek düzeltme yapılmaz. Mixed separator, whitespace içi, slash ve eksik grup reddedilir.

Normalizer U/L veya I/G bitini temizlemez ve MAC'i “vendor lookup için” değiştirmez. Lookup kullanıcının verdiği 48 bit üzerinde yapılır; `locallyAdministered` ve `multicast` yalnız ayrı flag olarak raporlanır.

### Metin

- Raw upstream metin değiştirilmeden korunur.
- Display metni Unicode NFC, trim ve ardışık whitespace sıkıştırmasıyla üretilir.
- Comparison key ayrıca Unicode case-fold uygular; kullanıcıya gösterilmez.
- Kontrol karakterleri reddedilir.
- JSON output ham HTML sayılmaz; UI her metni escape eder.
- Empty string normalize katmanında `null` olur.
- Private kayıtlar `is_private=true`, public ad/adres `null` olarak sunulur.

## Temporal ve silme semantiği

- Upstream zaman veriyorsa `effective_from/effective_to` korunur; yoksa tahmin edilmez.
- `observed_at`, kaydın owner-curated gözlem zamanıdır; import zamanı değildir.
- Full snapshot'ta kaybolan authoritative satır ancak diff validation geçerse withdrawal kabul edilir.
- Full snapshot'ta kaybolan owner-curated satır, `snapshot_complete=true` değilse silinmez.
- Delta kaynak yalnız açık tombstone ile siler.
- Düzeltme mevcut release'i mutate etmez; yeni source release üretir.
- Acil kaldırma suppression ile yapılır, ardından kalıcı düzeltme release'i hazırlanır.

## Resolver kuralları

### Authoritative

- Full MAC lookup sırası 36 -> 28 -> 24 bittir.
- CID ayrı exact sorgudur.
- Aynı prefix uzunluğunda birden fazla farklı authoritative sonuç aktivasyonu bloke eder.
- Aynı sonuç byte-identical ise evidence olarak corroborating tutulabilir.
- Otomatik registry tie-break yoktur.

### Owner-curated

- Authoritative alanın üzerine yazmaz.
- IEEE yoksa dahi `resolved_claims` içinde kalır.
- `reviewed`, `corroborated`, `single_observation`, `unverified` ayrı durumdur; sayısal confidence üretilmez.
- `unknown` köken/hak production'a giremez.
- Exact /48 ve /37–/47 iddialar yalnız açık gizlilik/hak onayıyla API output olabilir.
- V1 public lookup yalnız `curated_vendor_claim` kayıtlarını `vendor_label` olarak döndürür; alias, device hint ve usage note saklanabilir fakat public yanıt sözleşmesine girmez.

### Lookup maliyeti

- Authoritative: 3 composite-index probe.
- Curated: 1–48 bit için en fazla 48 candidate key üretimi ve composite-index probe.
- Sabit üst sınır nedeniyle aday üretimi `O(1)`; B-tree maliyeti en fazla `48 * O(log N)`.
- Request sırasında source tablolarına join yapılmaz.

## Deterministik build

Input manifest şunları içerir:

- Sıralı source release ID ve content hash listesi.
- Her input için `source_config_hash`; publish mode, hak kapsamı ve freshness kabulü sonradan değişse bile build geçmişi yeniden açıklanabilir.
- Adapter/normalizer/schema sürümleri.
- Resolver policy commit SHA.
- Container image digest.
- Sabit locale `C`, timezone `UTC`.

Output hash:

- Kayıtlar `(record_type, prefix_length, prefix_bits, source_slug, source_record_hash)` sırasına göre canonical sıralanır.
- Her satırı RFC 8785 JSON Canonicalization Scheme ile canonical edilmiş UTF-8 JSON Lines üretilir. Girdi, normalizer'ın ürettiği değerlerdir; JCS aşamasında Unicode yeniden normalize edilmez.
- Her kayıttan sonra tek `LF` byte (`0x0A`) bulunur; son kayıt da LF ile biter. BOM ve CRLF yoktur.
- Timestamp, DB ID ve build host output hash'e girmez.
- SHA-256 alınır.

Aynı input manifest ve policy commit farklı output hash üretirse run reddedilir.

## Vendor alias geleceği

V1 canonical organization kimliği üretmez. Upstream organization adı korunur.

`vendor_alias` yalnız `resolved_claims` içinde ayrı iddia olarak saklanır. Gelecekte vendor search gerektiğinde ayrı migration ile şu yapı eklenebilir:

- `organizations`.
- `organization_names`.
- `organization_links` ve gerekçe/evidence.

V1 API kalıcı `vendorId` yayımlamaz; erken ve yanlış şirket birleştirmesini sözleşmeye kilitlemez.
