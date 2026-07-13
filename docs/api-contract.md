# macvendor.io V1 API sözleşmesi

Tarih: 11 Temmuz 2026

Bu belge V1 dış API yüzeyini bağlayıcı olarak tanımlar. API, bir cihazın gerçek üreticisini garanti etmez; MAC adresinin eşleştiği kayıtlı atamayı ve ayrı tutulmuş kullanıcı-kürasyonlu iddiaları döndürür.

## 1. Genel kurallar

- Kök yol: `/v1`
- Taşıma: yalnızca HTTPS
- Yanıt biçimi: `application/json; charset=utf-8`
- Zamanlar: UTC, RFC 3339
- Kimlikler: opaque string; istemci anlam çıkarmamalıdır.
- Public `GET` uçlarında CORS `Access-Control-Allow-Origin: *`; kimlik bilgisi kabul edilmez.
- Her yanıtta `X-Request-Id` bulunur. Geçerli bir istemci değeri güvenli biçimde doğrulanabiliyorsa korunur, aksi halde sunucu üretir.
- Resmî atama ile kürasyonlu iddia aynı nesnede birleştirilmez.
- Eşleşme yokluğu hata değildir: lookup ucu `200` ve `assignment: null` döndürür.

## 2. MAC normalizasyonu

Kabul edilen girişler:

- `08:25:32:E0:00:00`
- `08-25-32-E0-00-00`
- `0825.32E0.0000`
- `082532E00000`

Girdi tüm dize olarak doğrulanır. Ayraçları gelişigüzel silip kalan karakterleri kabul etmek yasaktır. Normalleştirilmiş değer 12 büyük hexadecimal karakterdir: `082532E00000`.

Canonical lookup URL'si bu değeri kullanır:

`/v1/lookup/082532E00000`

Geçerli fakat canonical olmayan yol `308 Permanent Redirect` ile canonical yola yönlendirilir. Sorgu parametreleri korunur. Geçersiz veya karma biçimler `400 INVALID_MAC` üretir.

İlk octet'in U/L biti `query.flags.locallyAdministered`, I/G biti `query.flags.multicast` olarak raporlanır. Bu bitler temizlenmez, lookup girdisi değiştirilmez ve tek başına sorguyu geçersiz yapmaz.

Prefix alanı `(prefix, prefixLength)` birlikte yorumlanır. Nibble dışı curated uzunluklarda son hex karakterin kullanılmayan düşük bitleri sıfırdır; örneğin tek bitlik `1` prefix'i `prefix="8", prefixLength=1` olarak döner.

## 3. `GET /v1/lookup/{mac}`

### Sorgu parametreleri

- `mode=all|official`: varsayılan `all`. `official`, `curatedMatches` ve `insights` alanlarını boş dizi olarak döndürür.
- Başka parametre V1'de kabul edilmez; bilinmeyen parametre `400 UNSUPPORTED_PARAMETER` üretir.

### Başarılı yanıt

```json
{
  "query": {
    "input": "082532E00000",
    "normalized": "082532E00000",
    "flags": {
      "locallyAdministered": false,
      "multicast": false
    }
  },
  "assignment": {
    "prefix": "082532E",
    "prefixLength": 28,
    "registry": "MA-M",
    "organizationName": "Example Registrant",
    "address": null,
    "source": {
      "slug": "ieee",
      "sourceReleaseId": "sr_01..."
    }
  },
  "curatedMatches": [
    {
      "claimId": "clm_01...",
      "prefix": "082532E0",
      "prefixLength": 32,
      "claimType": "vendor_label",
      "organizationName": "Example Community Label",
      "verificationStatus": "corroborated",
      "originType": "owner_observation",
      "conflictStatus": "no_official_match",
      "source": {
        "slug": "demo-curated",
        "sourceReleaseId": "sr_02..."
      }
    }
  ],
  "curatedMatchesTruncated": false,
  "insights": [
    {
      "claimId": "clm_03...",
      "prefix": "00005E0001",
      "prefixLength": 40,
      "claimType": "usage_note",
      "organizationName": null,
      "details": { "usage": "VRRP (Virtual Router Redundancy Protocol)", "reference": "[RFC9568]" },
      "verificationStatus": "reviewed",
      "source": { "slug": "iana-ethernet-numbers", "sourceReleaseId": "sr_03..." }
    }
  ],
  "insightsTruncated": false,
  "data": {
    "resolvedReleaseId": "rr_01...",
    "activeVersion": 42,
    "publicationVersion": 7,
    "policyVersion": "git:4f3c...",
    "generatedAt": "2026-07-11T12:00:00Z"
  }
}
```

`assignment` resmî kayıt bulunamazsa `null` olur. Adres alanı kaynakta yoksa, yayımlanmasına izin verilmiyorsa veya bastırılmışsa `null` olur; alan kaldırılmaz.

Alan sözleşmesi:

| Yol | Tip | Null olabilir mi? |
|---|---|---|
| `query.input`, `query.normalized` | string | Hayır |
| `query.flags.locallyAdministered`, `query.flags.multicast` | boolean | Hayır |
| `assignment` | object | Evet |
| `assignment.prefix`, `assignment.registry` | string | Hayır, assignment varsa |
| `assignment.prefixLength` | integer | Hayır, assignment varsa |
| `assignment.organizationName`, `assignment.address` | string | Evet |
| `assignment.source.slug`, `assignment.source.sourceReleaseId` | string | Hayır, assignment varsa |
| `curatedMatches` | array | Hayır; sonuç yoksa `[]` |
| `curatedMatches[].claimId`, `prefix`, `claimType` | string | Hayır |
| `curatedMatches[].prefixLength` | integer | Hayır |
| `curatedMatches[].organizationName` | string | V1 lookup'a giren `vendor_label` için hayır |
| `curatedMatches[].verificationStatus` | enum string | Hayır |
| `curatedMatches[].originType`, `conflictStatus` | enum string | Hayır |
| `curatedMatches[].source.slug`, `sourceReleaseId` | string | Hayır |
| `curatedMatchesTruncated` | boolean | Hayır |
| `insights` | array | Hayır; sonuç yoksa `[]` |
| `insights[].claimType` | enum string | Hayır; `vendor_alias`, `device_hint`, `usage_note` |
| `insights[].organizationName` | string | Evet |
| `insights[].details` | object | Hayır |
| `insightsTruncated` | boolean | Hayır |
| `data.resolvedReleaseId`, `data.policyVersion` | string | Hayır |
| `data.activeVersion`, `data.publicationVersion` | integer | Hayır |
| `data.generatedAt` | RFC 3339 string | Hayır |

Bilinmeyen JSON alanları istemci tarafından yok sayılmalıdır. Tanımlı bir alan V1 içinde koşula göre kaldırılmaz; nullable ise `null`, koleksiyonsa boş koleksiyon döner.

Public enum değerleri:

- `assignment.registry`: `MA-L | MA-M | MA-S | IAB | CID`.
- `curatedMatches[].claimType`: V1'de yalnız `vendor_label`; internal `curated_vendor_claim` kaydının public karşılığıdır.
- `verificationStatus`: `reviewed | corroborated | single_observation | unverified`.
- `originType`: `owner_observation | derived | imported`; `unknown` production/public olamaz.
- `conflictStatus`: `agrees | conflicts | no_official_match | not_evaluated`.

`curatedMatches` en fazla 20 kayıt içerir ve şu sabit sırayla döner:

1. `prefixLength` azalan,
2. doğrulama derecesi: `reviewed`, `corroborated`, `single_observation`, `unverified`,
3. `source.slug` artan byte sırası,
4. `claimId` artan.

Daha fazla sonuç varsa `curatedMatchesTruncated: true` olur. V1 public lookup, tüm kanıt kayıtlarını veya kişisel cihaz düzeyindeki ham veriyi döndürmez.

`insights` en fazla 50 kayıt içerir. Bu alan protokol kullanımı, tarihsel ad
ve olasılıksal cihaz/platform ipuçlarını taşır; `assignment` sonucunu değiştirmez.

### `POST /v1/lookups`

Bir JSON isteğinde 1–25 MAC için yalnız resmî assignment katmanını döndürür:
`{"macs":["001122334455","02:AA:BB:CC:00:01"]}`. Tüm değerler geçerli
olmalıdır; tek bir invalid değer bütün isteği `400 INVALID_MAC` ile reddeder.
Tekrarlanan girişler SQL input'unda deduplicate edilir fakat çıktı sırası ve
tekrarlar korunur. Rate-limit cost gönderilen MAC sayısıdır. Yanıt private,
`no-store` olur ve curated claim içermez.

### Cache

- Başarılı pozitif eşleşme: `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60`
- Geçerli fakat eşleşmesiz sorgu: `Cache-Control: public, max-age=30, s-maxage=60`
- ETag: seçilen aktif sürüm, canonical sorgu ve yanıt varyantından deterministik üretilir.
- `Vary` yalnızca gerçekten yanıtı değiştiren başlıkları içerir; `User-Agent` içermez.

## 4. `GET /v1/assignments/{registry}/{prefix}`

Resmî bir IEEE atamasını registry, exact prefix ve uzunlukla getirir. Registry path değeri `ma-l | ma-m | ma-s | iab | cid` olur. Canonical prefix biçimi `HEX-LENGTH` biçimidir; örnek: `/v1/assignments/ma-m/082532E-28`.

- Registry/uzunluk eşleşmesi zorunludur: `ma-l` ve `cid` 24; `ma-m` 28; `ma-s` ve `iab` 36 bit.
- Registry path'e dahil olduğu için farklı registry'lerde aynı prefix değerinin bulunması belirsizlik yaratmaz.
- Kayıt yoksa `404 ASSIGNMENT_NOT_FOUND` döner.
- Varsayılan yanıt `{ "assignment": <lookup assignment şeması>, "data": <lookup data şeması> }` biçimindedir.
- `include=evidence` yalnızca bu uçta kabul edilir; en fazla 100 kanıt kaydı döner, `Cache-Control: private, no-store` kullanır ve daha sıkı rate limit uygulanır.
- Dağıtım hakkı olmayan ham kaynak satırı evidence içinde gösterilmez; yalnızca kaynak kimliği, hash, gözlem zamanı ve karar özeti gösterilir.

`include=evidence` yanıtı varsayılan gövdeye şu alanı ekler:

```json
{
  "evidence": [
    {
      "evidenceId": "ev_01...",
      "sourceSlug": "ieee",
      "sourceReleaseId": "sr_01...",
      "role": "selected",
      "reasonCode": "longest_prefix_authoritative",
      "observedAt": null
    }
  ],
  "evidenceTruncated": false
}
```

`evidenceId` opaque kimliktir; public API ham satır hash'i yayımlamaz çünkü düşük entropili kaynak satırları hash sözlüğüyle tahmin edilebilir. `observedAt` upstream tarafından verilmediyse `null` olur. Evidence sırası `role`, `sourceSlug`, `evidenceId` byte sırasıdır.

## 5. `GET /v1/data-release`

Aktif veri sürümünü, dahil edilen kaynak sürümlerini ve tazelik durumunu döndürür.
`observedAt`, immutable source release'in ilk import zamanı değil, o aynı
artifact için başarıyla doğrulanmış en yeni fetch observation zamanıdır;
observation yoksa release fetch zamanına düşer.

```json
{
  "resolvedReleaseId": "rr_01...",
  "activeVersion": 42,
  "publicationVersion": 7,
  "policyVersion": "git:4f3c...",
  "outputSha256": "sha256:...",
  "generatedAt": "2026-07-11T12:00:00Z",
  "sources": [
    {
      "slug": "ieee",
      "sourceReleaseId": "sr_01...",
      "observedAt": "2026-07-11T02:00:00Z",
      "verificationStatus": "authoritative",
      "sourceClass": "authoritative",
      "recordCount": 39722,
      "rightsScope": "api_output",
      "rightsStatusAtBuild": "approved",
      "currentRightsStatus": "approved",
      "rightsReviewExpiresAt": null,
      "status": "included",
      "configVersion": 2,
      "configVersionAtBuild": 1,
      "configChangedSinceBuild": true
    }
  ]
}
```

Bu uç, build anındaki hak/config snapshot'ı ile güncel durumu ayırır; böylece
sonradan expired/rejected olan veya config'i değişen kaynak gizlenmez.
`configVersion` güncel source config sürümüdür; `configVersionAtBuild` aktif
resolution'ın kullandığı sürümdür. Eşitsizlik rebuild gerektiğini gösterir fakat
tek başına lookup çıktısını değiştirmez. Kaynak lisans metninin yerine geçmez.
Hassas artifact URL'leri, imza anahtarları, iç notlar ve ham kayıtlar döndürülmez.
`sourceClass` kaynak katmanını, `recordCount` ise dahil edilen immutable source
release içindeki normalize edilmiş kayıt sayısını gösterir; resolved assignment
sayısı değildir.

### `GET /v1/data-release/changes`

Aktif ve bir önceki governed resolution arasındaki assignment ekleme, silme,
değişiklik; claim ekleme/silme ve değişen source release sayılarını aggregate
olarak döndürür. Ham kaynak satırı veya ticari database dump'ı döndürmez.

### Organization endpoint'leri

`GET /v1/organizations?q=...` reviewed exact-name/alias identity bağlantılarını
arar. `limit=1..20`, `scheme` ve `registry=MA-L|MA-M|MA-S|IAB` filtreleri
desteklenir. `GET /v1/organizations/{key}` tek reviewed identity kaydını getirir.
Bu bağlantılar fuzzy merge yapmaz ve IEEE assignment sonucunu değiştirmez.

Cache: `Cache-Control: public, max-age=60, s-maxage=300`. ETag; `activeVersion`,
`publicationVersion`, dahil edilen kaynakların güncel `configVersion`, hak
durumu ve `observedAt` değerlerinden üretilir. Hak/config veya doğrulanmış yeni
fetch observation değişikliği bu endpoint'in surrogate key'ini purge eder.

## 6. Hata modeli

Hatalar `application/problem+json` ve RFC 9457 uyumlu sabit yapıdadır:

```json
{
  "type": "https://macvendor.io/problems/invalid-mac",
  "title": "Invalid MAC address",
  "status": 400,
  "code": "INVALID_MAC",
  "detail": "The value is not a supported 48-bit MAC address format.",
  "requestId": "req_01..."
}
```

`type` URI'si kalıcı problem türü dokümanına çözülür. `title` aynı problem türü için sabittir; `detail` occurrence'a özeldir ve istemci tarafından parse edilmez. JSON içindeki `status`, gerçek HTTP status koduyla aynı olmak zorundadır. `code` ve `requestId` RFC 9457 extension alanlarıdır.

V1 kodları en az şunlardır:

| HTTP | Kod | Anlam |
|---:|---|---|
| 400 | `INVALID_MAC` | MAC biçimi geçersiz |
| 400 | `INVALID_PREFIX` | Prefix veya uzunluk geçersiz |
| 400 | `INVALID_REGISTRY` | Registry veya registry/uzunluk eşleşmesi geçersiz |
| 400 | `UNSUPPORTED_PARAMETER` | Tanımsız parametre |
| 404 | `ASSIGNMENT_NOT_FOUND` | Exact atama bulunamadı |
| 429 | `RATE_LIMITED` | Limit aşıldı; `Retry-After` bulunur |
| 503 | `DATA_RELEASE_UNAVAILABLE` | Aktif ve doğrulanmış sürüm yok |
| 503 | `SERVICE_UNAVAILABLE` | Geçici altyapı hatası |

İç hata, SQL ayrıntısı, dosya yolu veya kaynak artifact içeriği `detail` alanına sızdırılmaz.

## 7. Sürümleme ve uyumluluk

- V1 içinde yalnızca geriye uyumlu alan eklemeleri yapılır.
- Mevcut alanın tipi, null davranışı, anlamı veya sıralama kuralı değişmez.
- Yeni enum değeri eklenebilir; istemci bilinmeyen değeri tolere etmelidir.
- Kırıcı değişiklik yeni ana yol (`/v2`) gerektirir.
- Bir V1 alanı veya uç en az altı ay duyurulmadan kaldırılmaz; güvenlik veya hukuki acil durumlar istisnadır.
- Aynı aktif sürüm ve aynı parametreler için yanıt semantiği deterministik olmalıdır.

## 8. Açıkça garanti edilmeyenler

- MAC adresinin o anda hangi fiziksel cihazda kullanıldığı
- Kullanıcının, konumun veya ağın kimliği
- Resmî registrant ile son ürün markasının aynı olduğu
- Kürasyonlu bir iddianın resmî IEEE ataması olduğu
- Bir prefix altındaki tüm cihazların aynı üreticiye ait olduğu
