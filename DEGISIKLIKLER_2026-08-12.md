# 12.08.2026 Düzeltmeleri — Özet

Bu dosya, bildirdiğin 2 sorun için yapılan değişikliklerin özetidir.

## Değişen dosyalar
- `assets/css/auth.css`
- `panel/admin.md`
- `panel/github-yonetim.md` (aynı hatayı taşıdığı için, istemesen de düzelttim — aşağıda 1. maddede açıklandı)
- `supabase/migrations/0004_mesajlasma_ve_temizlik.sql`

Yeni migration YOK — bu turda veritabanı şeması değişmedi, sadece mevcut
`0004` dosyasının kendisi düzeltildi (aşağıya bkz).

---

## 1) "Panelim" / "Admin Paneli" karışık/iç içe geçmiş görünüyordu

**Kök neden:** `panel/admin.md`, sayfayı solda sabit (sticky) bir menü +
sağda içerik olacak şekilde iki sütunlu bir grid'e (`.admin-layout {
grid-template-columns: 220px 1fr }`) bölüyordu. Bu grid'in içindeki
"Mesajlar" bölümü ise `.panel-section--wide` adlı, sayfayı normal 860px'lik
`.wrap` sınırının dışına taşırıp **viewport'a göre ortalayan** bir CSS
tekniği kullanıyordu (`margin-left: calc(50% - 50vw + 2vw)`). Bu teknik
SADECE elemanın ebeveyni tam simetrik ortalanmışsa doğru sonuç verir — ama
admin sayfasında ebeveyn (`.admin-content`), 220px'lik sol menü yüzünden
artık simetrik değildi. Sonuç: "Mesajlar" kutusu sayfanın soluna doğru
kayıyor, diğer kartlarla hizası bozuluyor, sticky sidebar da kaydırma
sırasında bağımsız davranıp genel görünümü "iç içe geçmiş/karışık" hale
getiriyordu (ekran kaydında gördüğüm tam olarak buydu).

`panel/github-yonetim.md` (GitHub İçerik Yönetimi paneli) da **aynı**
iki sütunlu yapıyı kullanıyordu — sen bahsetmemiş olsan da ileride aynı
sorunu yaşamaman için onu da düzelttim.

**Çözüm:** Her iki sayfayı da, zaten düzgün çalışan `panel/panel.md`
(Panelim) ile birebir aynı, **tek sütunlu, normal yukarıdan-aşağıya akan**
düzene çevirdim:
- Sol sidebar kaldırıldı. Yerine üstte, **sticky OLMAYAN**, yatay bir
  "sekme" şeridi (`.admin-tabs`) kondu — tıklayınca ilgili bölüme yumuşak
  kaydırma (smooth scroll) yine çalışıyor, JS tarafında hiçbir değişiklik
  gerekmedi.
- Tüm bölümler artık `panel.md`'deki gibi tek bir `.panel-grid` içinde,
  aynı hizada, kart kart alt alta diziliyor. "Mesajlar" bölümündeki geniş
  görünüm artık doğru şekilde ortalanıyor çünkü ebeveyni tekrar simetrik.
- `assets/css/auth.css`: `.admin-layout` / `.admin-nav` / `.admin-content`
  kuralları kaldırıldı, yerine sade `.admin-tabs` stili eklendi. Ayrıca bir
  bölüme anchor/link ile atlarken sticky header'ın başlığı KAPATMAMASI
  için tüm `.panel-section`'lara `scroll-margin-top` eklendi (önceden bu
  değer admin sayfasında 16px'ti, bu bazen başlığın header'ın altında
  gizlenmesine yol açabiliyordu).

## 2) Migration hatası: `column "conversation_user_id" does not exist`

**Kök neden:** `supabase/migrations/0006_konusma_bazli_mesajlasma.sql`,
`messages` tablosunu eski `conversation_user_id` modelinden yeni
`conversation_id` modeline taşıyor ve eski kolonu **tamamen siliyor**.
Sen (muhtemelen daha önce 0001→0009'u sırayla çalıştırdığın, önceki
tur özetlerinde de görülen) veritabanın zaten bu yeni şemaya
yükseltilmiş haldeyken `0004`'ü tek başına tekrar çalıştırdın. `0004`
içinde `create table if not exists public.messages (...)` tablo zaten
var olduğu için hiçbir şey yapmıyor (atlıyor), ama hemen ardından gelen
`create index ... (conversation_user_id, ...)` ve RLS politikaları hâlâ
**artık var olmayan** bu kolonu referans alıyordu — hata tam da bu yüzden
çıkıyordu.

**Çözüm:** `0004`'teki mesajlaşma kurulum bloğunu, projenin kendi `0006`
dosyasındaki idempotent yaklaşımıyla aynı mantıkla koruma altına aldım:
artık önce `messages` tablosunda `conversation_id` kolonu olup olmadığına
bakıyor.
- **Varsa** (yani veritabanı zaten `0006`'ya/sonrasına yükseltilmiş):
  index/politika kurulumu tamamen ATLANIYOR — `0006` bunları zaten doğru
  şekilde kurmuş durumda, `0004`'ün tekrar dokunmasına gerek yok. Bu
  durumda konsolda sadece bilgilendirici bir `NOTICE` görürsün, hata
  almazsın.
- **Yoksa** (sıfırdan kurulum ya da `0006` henüz çalıştırılmamış eski bir
  veritabanı): eskisi gibi, orijinal `conversation_user_id` şemasıyla
  tabloyu/index'i/politikaları kurar.

Yani artık `0004`'ü — veritabanının hangi aşamada olduğuna bakmaksızın —
güvenle (tekrar tekrar) çalıştırabilirsin.

### Yapman gereken
Sadece `assets/css/auth.css`, `panel/admin.md` ve `panel/github-yonetim.md`
dosyalarını yayınlaman (GitHub Pages / Cloudflare Pages push) yeterli —
CSS/HTML olduğu için ekstra bir adım gerekmiyor. `0004` SQL dosyasını
tekrar çalıştırmana GEREK YOK (veritabanın zaten güncel); dosya sadece
ileride biri bu dosyayı yeniden çalıştırırsa artık hata vermesin diye
düzeltildi.
