# Veri yönetişimi, haklar ve kullanıcıya sunum

Bu belge özellikle kullanıcı tarafından hazırlanmış amatör/lisanssız verilerin hangi şartlarda saklanabileceğini ve yayımlanabileceğini belirler.

## Temel ilke

“Dosyayı ben hazırladım” üç farklı durumu kapsayabilir:

1. Satır tamamen kullanıcının kendi gözleminden oluşur.
2. Satır izinli/lisanslı başka bir kaynaktan türetilmiştir.
3. Satırın kökeni veya yayın hakkı bilinmiyordur.

Bu üç durum aynı muameleyi görmez. Source-level beyan yeterli değildir; record-level provenance zorunludur.

## Owner-curated source manifest

Her owner-curated kaynak aşağıdaki manifesti taşır:

- `sourceSlug`, görünen ad ve sahibi.
- `schemaVersion`.
- `snapshotKind` ve `snapshotComplete`.
- Kaynak repository/commit SHA.
- Commit veya artifact signature durumu.
- Varsayılan `originType`, `rightsBasis`, `distributionScope`, `verificationStatus`.
- Reviewer ve review reference; `reviewed` iddiasında zorunlu, `owner_asserted` durumda nullable.
- Dosya SHA-256 listesi.

Satır alanları manifest varsayılanlarını override edebilir. Eksik alan güvenilir varsayılmaz:

- `originType=unknown`.
- `rightsBasis=unknown`.
- `verificationStatus=unverified`.
- `recordStatus=qa_only`.

## Hak ve dağıtım politikası

### Kabul edilen production dayanakları

- `owner_created`: Kullanıcının kendi gözlemi/araştırması; üçüncü taraf liste kopyası değil.
- `licensed`: Açık veya ticari lisans kaydı var.
- `permission_granted`: Yazılı izin referansı var.

### Production için yetersiz dayanaklar

- `public_domain_claim`: Hukuk review olmadan yeterli değildir.
- `unknown`: Production'a giremez.
- Kaynak URL'sinin herkese açık olması.
- Dosyanın GitHub/Gist üzerinde bulunması.

### Dağıtım kapsamı

- `internal_only`: Yalnız QA ve karşılaştırma.
- `api_output`: Lookup sonucunda sınırlı claim gösterilebilir; raw indirme yok.
- `raw_redistribution`: Yalnız açık izinle; V1'de kullanılmaz.

V1 ham veritabanı indirme sunmaz. API kullanıcılarının sonucu hangi koşullarda kullanabileceği Terms of Service içinde ayrıca tanımlanır; source rights kaydı bunun yerine geçmez.

Production hak matrisi:

- Üçüncü taraf veri: `rights_status=approved`, süresi dolmamış review ve V1 için `distribution_scope=api_output`.
- Tamamen kullanıcının kendi oluşturduğu veri: en az `rights_status=owner_asserted`, `rights_basis=owner_created` ve `distribution_scope=api_output`.
- `licensed` veya `permission_granted` kaydında sözleşme/izin süresi dolarsa yeni release aktivasyonu durur; aktif release P1 alarmı üretir ve hukuk kararı suppression veya rollback belirler.
- “Lisanssız amatör veri” üçüncü taraf satırlarının kopyasıysa owner-created sayılmaz ve public edilemez.

## Gizlilik

### Veri sınıfları

- `/1–/36` prefix claim: Varsayılan olarak cihaz-tekilleştirici sayılmaz; yine de provenance gerekir.
- `/37–/47`: Küçük cihaz grubu; `sensitive_prefix` olarak review ister.
- `/48`: Exact MAC; `device_identifier` olarak hassas kabul edilir.
- Konum, SSID, kullanıcı, müşteri, zaman serisi veya ağ içi gözlem: Public dataset alanı değildir.

### Yayın kuralları

- Exact `/48` owner-curated kayıt varsayılan `qa_only` olur.
- `/37–/48` production için hak dayanağına ek olarak gizlilik review reference gerekir.
- Exact MAC ile konum/zaman/kişi ilişkisi public API'ye çıkmaz.
- Evidence içinde hassas bilgi gerekiyorsa ayrı restricted storage'da tutulur; public `evidenceReference` yalnız opaque kimliktir.
- Access log tam MAC tutmaz; canonical MAC HMAC veya ilk 24 bit aggregate ile ölçülür.
- Public API log retention 7 gündür.

## Veri zehirlenmesi ve kötü niyetli içerik

Owner-curated veri güvenilir kabul edilmez. Şunlar zorunludur:

- Organization adı ve claim metninde kontrol karakteri yok.
- UI tüm metni escape eder; raw HTML render edilmez.
- Unicode raw ve NFC display değerleri ayrı tutulur; homograph şüphesi review flag üretir.
- Bidi override/isolate, zero-width ve görünmez format karakterleri otomatik public edilmez; satır reddedilir veya açık insan review'ine gider.
- Hakaret, kişisel veri, kimlik bilgisi veya çalıştırılabilir payload içeren satır reddedilir.
- Aynı kaynağın conflict hacmi eşik üstüne çıkarsa source release karantinaya alınır.
- Bir kaynak hiçbir zaman kendi verification durumunu `reviewed` yapamaz; reviewer ayrı kimliktir.

## Doğrulama durumları

| Durum | Anlam | Public sunum |
|---|---|---|
| `reviewed` | Kanıtı ayrı bir reviewer tarafından kontrol edildi | “Kanıtı incelendi” |
| `corroborated` | En az iki bağımsız kayıt aynı iddiayı destekliyor | “Birden fazla kayıtla destekleniyor” |
| `single_observation` | Tek gözlem/kayıt | “Tek gözlem” |
| `unverified` | Doğrulanmadı | Varsayılan olarak QA; yayımlanırsa açık uyarı |

“Corroborated” aynı dosyanın kopyalarıyla oluşmaz. Bağımsız source/artifact zinciri gerekir.

## UI sunum sözleşmesi

Sonuçlar görsel ve metinsel olarak ayrılır; yalnız renk kullanılmaz.

### Resmî atama

Etiket: `IEEE resmî adres bloğu kaydı`

Gösterilecekler:

- Registry ve prefix.
- Kayıt sahibi organization.
- IEEE source release tarihi.
- “Bu kayıt cihaz üreticisini kesin olarak tanımlamaz” uyarısı.

### Owner-curated eşleşme

Etiketler:

- `Kanıtı incelendi`.
- `Birden fazla kayıtla destekleniyor`.
- `Tek gözlem`.
- `Doğrulanmamış`.

Her claim için:

- Kaynak adı.
- Hak durumu; `owner_asserted` ise “Kaynak sahibi beyanı; bağımsız hak incelemesi yok” uyarısı.
- Prefix ve prefix length.
- Verification durumu.
- Origin türü.
- IEEE ile `agrees | conflicts | no_official_match` ilişkisi.

IEEE ve curated metin tek organization alanında birleştirilmez. IEEE yoksa arayüz “Resmî eşleşme bulunamadı” demeye devam eder; curated sonuç ayrı bölümde gösterilir.

## Zorunlu disclaimer metni

UI ve API dokümanında şu anlam korunur:

> Sonuç, bir adres bloğunun kayıt sahibini veya ayrı bir kullanıcı kaynağının iddiasını gösterir. Cihazın gerçek üreticisini, modelini, sahibini ya da ağdaki kimliğini kanıtlamaz. MAC adresleri değiştirilebilir veya rastgeleleştirilebilir.

Private IEEE kayıt için:

> IEEE kaydı mevcuttur ancak kayıt sahibi public listede gizlenmiştir.

Curated conflict için:

> Bu kullanıcı kaynağı resmî kayıtla çelişiyor; resmî kayıt değiştirilmemiştir.

## Attribution sayfaları

V1'de şu public sayfalar bulunur:

- `/data-sources`: Kaynak, sınıf, güncellik ve kullanım rolü.
- `/data-release`: Aktif resolved release ve input source release'leri.
- `/methodology`: Normalizasyon, longest-prefix ve curated ayrımı.
- `/legal/data-terms`: Veri kullanımı, attribution ve disclaimer.
- `/data-corrections`: Yanlış veri bildirim süreci.
- `/problems/{problem-slug}`: RFC 9457 problem type açıklaması ve istemci düzeltme adımı.

IEEE adı endorsement izlenimi yaratacak biçimde kullanılmaz.

## Düzeltme, geri çekme ve takedown

### Kanal

- Public `/data-corrections` formu.
- Yapılandırılabilir `DATA_CORRECTIONS_EMAIL`; adres kodda sabitlenmez.
- Her başvuru opaque ticket ID alır.
- Form ve e-posta erişim kontrollü dış ticket sistemine yazar; V1 PostgreSQL kişisel iletişim veya kanıt eki tutmaz.

### Gerekli alanlar

- İlgili prefix/MAC.
- Kaynak ve görünen iddia.
- İstenen düzeltme.
- Kanıt/reference.
- Başvuran iletişim bilgisi; public edilmez.

### Hedef süreler

- Otomatik alındı bildirimi: hemen.
- İlk insan incelemesi: 2 iş günü.
- Normal karar hedefi: 10 iş günü.
- Açık kişisel veri, güvenlik veya ağır yanlış atıf: 24 saat içinde geçici suppression review.

### Karar türleri

- Reddet; gerekçe kaydı.
- Yeni source release ile düzelt.
- Geçici/permanent suppression.
- Hak veya gizlilik incelemesine yönlendir.

Mevcut source/release satırları mutate edilmez. Her karar audit event ve ticket reference üretir.

## Kaynak özgünlüğü ve review

- Production owner-curated artifact signed Git commit/tag veya onaylı detached signature ile bağlanır.
- Commit SHA, artifact SHA-256 ve manifest hash source release'e yazılır.
- Hazırlayan ve reviewer aynı kişi olamaz; tek kişilik başlangıç operasyonunda bu ayrım mümkün değilse durum `owner_asserted` kalır ve public UI bunu gizlemez.
- Policy veya publish-mode değişikliği code review gerektirir.
- Emergency suppression iki aşamalı review beklemeden uygulanabilir; 24 saat içinde ikinci review zorunludur.

## Vendor alias geleceği

Alias, organization birleşimi değildir. V1'de `vendor_alias` curated claim olarak gösterilir.

Gelecekte organization katalogu kurulursa:

- Birleştirme evidence ve tarih aralığı ister.
- İştirak, marka, eski ad ve yazım varyasyonu ayrı ilişki türleridir.
- Otomatik fuzzy matching organization kimliği oluşturamaz.
- Kullanıcıya dönülen mevcut organization metni geriye dönük değiştirilmez.
