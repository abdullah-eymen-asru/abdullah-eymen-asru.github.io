# 11.08.2026 (2. Tur) Düzeltmeleri — Özet

Bu dosya, ikinci turda bildirdiğin 6 sorun için yapılan değişikliklerin özetidir.

## En son değişen dosyalar (bu turda)
- `_layouts/default.html`
- `assets/css/auth.css`
- `assets/js/admin.js`
- `assets/js/auth-guard.js`
- `assets/js/auth-pages.js`
- `assets/js/github-yonetim.js`
- `assets/js/nav-auth.js`
- `assets/js/ozel-icerik.js`
- `assets/js/panel.js`
- `assets/style.css`
- `hesap/giris.md`
- `hesap/hesap-onayla.md`
- `hesap/kayit.md`
- `hesap/sifre-guncelle.md`
- `hesap/sifremi-unuttum.md`
- `panel/admin.md`
- `panel/github-yonetim.md`
- `panel/ozel-icerik.md`
- `panel/panel.md`
- `supabase/functions/admin-change-email/index.ts`

## Bu turda eklenen yeni dosyalar
- `supabase/migrations/0008_email_isim_senkron_ve_kvkk_temizlik.sql` (bir önceki turdan — henüz çalıştırmadıysan mutlaka çalıştır)
- `supabase/migrations/0009_admin_zorla_cikis_ve_bildirim.sql` ⚠️ **YENİ — Supabase SQL Editor'de çalıştırman gerekiyor.**

---

## 1) Çıkış butonu → sadece `panel.html#` ekliyor, çıkış olmuyor
**Kök neden:** `panel.js`, `admin.js` ve `github-yonetim.js`'in `init()` fonksiyonları TEK bir sıralı `await` zinciriydi. Zincirdeki herhangi bir adım (ör. mesajlaşma widget'ı kurulumu) beklenmedik bir hata fırlatırsa, **o adımdan SONRAKİ her şey hiç çalışmıyordu.** `wireLogout()` en sonda çağrıldığı için çıkışa hiç bağlanmıyordu — buton görünüyordu ama tıklanınca sadece `href="#"`'in native tarayıcı davranışı (adres çubuğuna `#` eklenmesi) gerçekleşiyordu.
**Çözüm:** Üç dosyada da `init()`'i yeniden yapılandırdım — her bölüm artık kendi try/catch'i içinde, birbirinden bağımsız kuruluyor. `panel.js`'te ayrıca `wireLogout()`'u en başa aldım (kritik olduğu için en garantili yer).

## 2) Panellerde "Yükleniyor..." takılı kalması
Aynı kök neden (yukarıdaki 1. madde) — bir bölüm patlayınca ondan sonraki TÜM bölümler (KVKK, Özel İçerikler, Mesajlar) sonsuza dek "Yükleniyor..." durumunda kalıyordu. Aynı düzeltmeyle çözüldü; artık bir bölüm hata verse bile diğerleri normal yükleniyor, hatalı bölüm konsola (F12 → Console) hangi bölüm olduğunu yazıyor.

## 3) Sayfa kaymaları / iç içe geçme / mesajlaşma modern görünmüyor / buton bazı tarayıcılarda görünmüyor
**Kök neden (hepsinin ortak kaynağı):** `auth.css`, sayfaların Markdown **gövdesi içinde** (`</head>`'den SONRA, `<body>` içinde) `<link>` ile yükleniyordu — bu geçersiz HTML'dir ve bazı tarayıcılarda (ve tarayıcı uzantılarında) `<body>` içindeki `<link>` etiketleri ya hiç yüklenmiyor ya da farklı/geç önceklilikle yükleniyordu. Bu da tarayıcıya göre değişen görünüm sorunlarının (buton yazısı kayboluyor, mesajlaşma modern görünmüyor) asıl sebebiydi.
**Çözüm:** `auth.css`'i `_layouts/default.html`'in gerçek `<head>`'ine taşıdım; hangi sayfanın bunu yükleyeceğini front-matter'daki `auth_css: true` bayrağıyla kontrol ediyoruz (9 sayfa güncellendi: giriş, kayıt, şifre sayfaları, panel, admin, vb.).
**Ek düzeltme (sayfa kaymaları):** `.panel-section--wide` (mesajlaşma bölümünü genişleten) kuralı `100vw` tabanlı bir ortalama tekniği kullanıyordu — bu, dikey kaydırma çubuğunun kapladığı alan yüzünden yatay taşmaya ve "kayma" hissine yol açıyordu. `body { overflow-x: hidden }` eklendi ve teknik, viewport yerine ebeveyne göre hesaplayan daha güvenli bir versiyona çevrildi. `.panel-grid`'e eksik olan `grid-template-columns` ve taşma önleyici `min-width:0` kuralları da eklendi.

## 4) Ad-Soyad "rol kısmında" görünmüyor / kullanıcı güncellese de sistemde değişmiyor
- Panelim'deki üst satıra (`e-posta · Rol: ... · Çıkış Yap`) Ad-Soyad eklendi — artık `Ad Soyad · e-posta · Rol: ... · Çıkış Yap` şeklinde görünüyor.
- Kaydet butonuna basınca bu üst satır artık **sayfa yenilenmeden anında** güncelleniyor (önceden sadece ilk açılışta dolduruluyordu, bu da "değişmiyor" izlenimi veriyordu — oysa veritabanı doğru güncelleniyordu, sadece ekran yansıtmıyordu).
- Kaydetme isteğine `.select().single()` eklendi: RLS bir sebeple satırı döndürmezse artık "kaydedildi" diye YANLIŞLIKLA bildirim gösterilmiyor, gerçek bir hata mesajı çıkıyor.
- **Admin panelindeki kullanıcı tablosuna gerçek zamanlı (Supabase Realtime) güncelleme eklendi** — bir kullanıcı kendi panelinden ismini değiştirdiğinde, admin paneli açıksa 600ms içinde otomatik tazeleniyor (F5 gerekmiyor).

## 5) Admin e-posta değiştirince eski oturumlardan çıkış yapılmıyor / bildirim gitmiyor
Supabase'in "şu kullanıcıyı ID ile tüm cihazlardan çıkışa zorla" diye hazır bir admin fonksiyonu yok (`auth.admin.signOut()` kullanıcının kendi JWT'sini ister, admin'de bu yok). Yeni migration'da (`0009`) `admin_force_signout_user()` adında bir veritabanı fonksiyonu ekledim — bu, service_role yetkisiyle kullanıcının `auth.refresh_tokens` ve `auth.sessions` kayıtlarını iptal ediyor (mevcut access token en geç 1 saat içinde, refresh token'lar ise anında geçersiz olur). `admin-change-email` fonksiyonu artık e-postayı değiştirdikten hemen sonra bunu otomatik çağırıyor.

Bildirim maili için: ekstra bir SMTP kurulumu istemediğin için, Supabase'in kendi dahili mail sistemini (`resetPasswordForEmail`) kullanıyoruz — bu, "Reset Password" e-posta şablonu üzerinden **gerçekten** postalanıyor (Dashboard'dan şablon metnini "e-postan güncellendi" şeklinde özelleştirebilirsin). *(Not: İlk denemede `generateLink()` kullanmıştım ama bu fonksiyonun mail GÖNDERMEDİĞİNİ, sadece bir link ÜRETTİĞİNİ fark edip düzelttim — bu ayrıntıyı burada belirtiyorum çünkü şeffaf olmak istiyorum.)*

## 6) Ek olarak bulduğum/düzelttiğim hatalar
- **Hesap silme sonrası yanlış hata mesajı:** Hem `panel.js` hem `admin.js`'te, hesap Edge Function tarafından başarıyla silindikten SONRA çağrılan `supabase.auth.signOut()` hata verirse, kod bunu "Hesap silinemedi" diye YANLIŞ gösteriyordu — oysa hesap gerçekten silinmişti. Ayrı try/catch'e alındı.
- **`nav-auth.js`'de memory leak:** Üstteki "Hesabım ▾" menüsü her açılıp kapandığında (ya da başka bir sekmede giriş/çıkış yapıldığında) `document`'a "dışarı tıklayınca kapat" ve "Escape ile kapat" için YENİ event listener'lar ekleniyordu, eskiler hiç temizlenmiyordu. Artık menü DOM'dan kalktığında bu dinleyiciler kendini temizliyor.
- **`ozel-icerik.js` ve `github-yonetim.js`:** Aynı "bir hata her şeyi durdurur" riskine karşı dayanıklı hale getirildi (bkz. madde 1-2).

---

## Uygulama adımları (senin yapman gerekenler)
1. **Supabase Dashboard > SQL Editor**'e git:
   - Eğer `0008_email_isim_senkron_ve_kvkk_temizlik.sql`'i daha önce çalıştırmadıysan, önce onu çalıştır.
   - Ardından **`0009_admin_zorla_cikis_ve_bildirim.sql`**'i çalıştır (bu turun asıl yeni migration'ı).
2. `admin-change-email` fonksiyonunu yeniden deploy et (içeriği değişti):
   ```
   supabase functions deploy admin-change-email
   ```
3. İstersen Dashboard > Authentication > Emails > **Reset Password** şablonunu, "E-postanız site yöneticisi tarafından güncellendi" gibi bir metinle özelleştirebilirsin (zorunlu değil, varsayılan şablon da işlevsel çalışır).
4. Geri kalan tüm dosyalar (CSS/JS/HTML/MD) statik olduğu için, siteyi her zamanki gibi yayınlaman (GitHub Pages / Cloudflare Pages push) yeterli.

**Not:** `0009` migration'ı çalıştırılmadan admin panelinden e-posta değiştirirsen, işlem yine de başarıyla tamamlanır (sadece "eski oturumları sonlandırma" adımı sessizce atlanır ve konsola bir uyarı yazılır) — hiçbir şeyi bozmaz, ama madde 5'in tam çalışması için migration'ın çalıştırılmış olması gerekir.
