[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · **🔐 Supabase Sistemi** · [🍴 Fork Kurulumu](./03-fork-kurulumu.md) · [☁️ Cloudflare Secret & Ayarlar](./04-cloudflare-secretlar.md) · [🔄 Dönüştürücü & Belge Düzenleyici](./05-donusturucu.md) · [📑 Belge Tarayıcı & Sıkıştırma](./06-belge-tarayici.md)

---

# 🔐 Supabase Kullanıcı Sistemi — Kurulum, Güvenlik ve Sorun Giderme

Bu bölüm, siteye eklenen **Supabase (PostgreSQL + Auth + Storage)** tabanlı
kullanıcı kayıt/giriş, rol yönetimi ve gizli içerik sistemini anlatıyor.
Eskiden ayrı bir `KURULUM-REHBERI-supabase.md` dosyasındaydı, artık
karışıklık olmasın diye buraya taşındı — tek doğruluk kaynağı burası.

Sistem şunları sağlıyor:

- Google OAuth + E-posta/Şifre ile kayıt-giriş, e-posta doğrulama, şifre sıfırlama
- **Cloudflare Turnstile** bot koruması (giriş/kayıt/şifre sıfırlama; kullanıcıdan işlem istemeyen görünmez doğrulama) — bkz. "Bot Koruması" bölümü
- Mail gönderilen HER ekranda (kayıt, hesabı onayla, şifremi unuttum, e-posta
  değiştirme) aynı **"SPAM klasörünü kontrol et"** uyarısı — bkz. "E-posta
  Gönderilen Ekranlarda SPAM Uyarısı" bölümü
- `user` / `special_user` / `admin` rolleri, veritabanı seviyesinde **RLS** ile korunan
- Gizli makaleler ve dosyalar (10 saniyelik Signed URL ile indirme)
- `/panel/panel.html`: profil düzenleme, **çift onaylı e-posta değiştirme**
  (hem eski hem yeni adrese onay + linkin yanında kod ile onaylama yedeği;
  mail veya Google ile kayıtlı herkes için), şifre değiştirme, **Hesabımı Sil**
- `/panel/admin.html`: kullanıcı rol yönetimi, **bir üyenin e-postasını tek
  onaylı değiştirme** (eski adresine erişimi kalmamış üyeler için), özel
  içerik/dosya yükleme + üyelere atama, "Hakkımda" metni düzenleme
- Header'daki tek **"Hesabım"** menüsü: çıkış yapmışken "Giriş Yap", giriş
  yapmışken Panelim / (adminse) Admin Paneli / Çıkış Yap seçenekleri

Mimari notu: Sitene **hiçbir zaman** sunucu eklemiyoruz. Her şey statik
kalıyor (GitHub Pages / Cloudflare Pages ile tam uyumlu); tüm kullanıcı
işlemleri tarayıcıdan doğrudan Supabase'e gider. Gerçek güvenlik, tarayıcıdaki
JavaScript'te değil, **veritabanındaki RLS politikalarında** yaşar — istemci
tarafı kontroller (`auth-guard.js` gibi) sadece kullanıcı deneyimi (UX)
içindir.

---

## Paketteki Dosyalar

```
supabase/
  migrations/0001_schema_rbac_rls.sql      <- Adım 1: SQL Editor'de çalıştır (ilk kurulum)
  migrations/0002_guvenlik_sikilastirma.sql <- Adım 1b: SQL Editor'de çalıştır (güvenlik sıkılaştırma + büyük dosya linki)
  migrations/0003_yeni_ozellikler_ve_guvenlik.sql <- Adım 1c: SQL Editor'de çalıştır (KVKK onayı, okundu/son geçerlilik, admin üye silme, arama indeksi, kalan Advisor uyarıları)
  migrations/0013_taslak_icerikler_supabase_taslak_sistemi.sql <- SQL Editor'de çalıştır (blog/proje TASLAKLARI için `taslak_icerikler` tablosu + RLS + `taslak_onizleme_getir` RPC'si — bkz. Değişiklik Geçmişi 15.08.2026 ve rehber/01-site-rehberi.md Bölüm 10 "Supabase Taslak Sistemi")
  functions/delete-account/index.ts        <- Adım 5: Edge Function (hesap silme — artık admin başkasını da silebiliyor)
  functions/admin-change-email/index.ts    <- Adım 5c: Edge Function (admin, bir üyenin e-postasını ANINDA — mail göndermeden — değiştirir)
assets/
  js/supabase-client.js                    <- Ortak Supabase istemcisi (URL/KEY burada) + showSpamNotice() yardımcısı
  js/auth-guard.js                         <- Korumalı sayfa mantığı
  js/auth/auth-pages.js                    <- Giriş/Kayıt/Şifre/Hesap Onayla sayfaları mantığı
  js/auth/turnstile.js                     <- Cloudflare Turnstile ↔ Supabase Auth Captcha köprüsü (görünmez token ekleme)
  js/panel.js                              <- /panel/panel.html mantığı (e-posta değiştirme dahil)
  js/admin.js                              <- /panel/admin.html mantığı
  js/ozel-icerik.js                        <- Tekil gizli içerik sayfası
  js/nav-auth.js                           <- Header'daki "Hesabım" menüsü
  css/auth.css                             <- Bu sayfalara özel stiller (.auth-spam-notice dahil)
hesap/giris.md / hesap/kayit.md / hesap/sifremi-unuttum.md / hesap/sifre-guncelle.md / hesap/hesap-onayla.md
panel/panel.md / panel/admin.md / panel/ozel-icerik.md       <- Jekyll sayfaları (_layouts/default.html'i kullanır)
```

---

## Adım 1 — Supabase Projesi ve SQL Şeması

1. [supabase.com](https://supabase.com) üzerinden ücretsiz bir proje oluştur
   (bölge olarak Frankfurt/eu-central-1 seçmen Türkiye'den erişim için
   gecikmeyi azaltır).
2. Dashboard'da **SQL Editor** sekmesine git, **New query**.
3. `supabase/migrations/0001_schema_rbac_rls.sql` dosyasının TAMAMINI
   yapıştır ve **Run**'a bas. Bu dosya şunları kurar:
   - `profiles` tablosu (rol dahil) + yeni kullanıcıda otomatik profil açan trigger
   - Rol yükseltme saldırısına karşı trigger (kullanıcı kendi rolünü değiştiremez)
   - `special_content` ve `content_access` tabloları (gizli makale/dosya + atama)
   - `site_settings` tablosu ("Hakkımda" metni için)
   - **Tüm tablolarda RLS'i açan `alter table ... enable row level security;`
     satırları** (bkz. aşağıdaki "RLS Hakkında Sık Sorulan Sorular" — RLS'i
     ayrıca bir yerden "aç"man GEREKMİYOR, bu dosya zaten açıyor)
   - `ozel-dosyalar` (private) ve `avatarlar` (public-read) Storage bucket'ları + politikaları
   - `admin_set_user_role()` ve `delete_own_profile_data()` güvenli RPC fonksiyonları
4. Ardından **yeni bir query** aç, `supabase/migrations/0002_guvenlik_sikilastirma.sql`
   dosyasının TAMAMINI yapıştır ve **Run**'a bas. Bu dosya 0001'i bozmadan
   üzerine ekleme yapar: Security Advisor'ın "Warnings" sekmesinde çıkan
   uyarıları giderir ve büyük-dosya-linki kolonunu ekler (aşağıda ayrı
   başlıkta anlatılıyor).
4b. Ardından **bir query daha** aç, `supabase/migrations/0003_yeni_ozellikler_ve_guvenlik.sql`
   dosyasının TAMAMINI yapıştır ve **Run**'a bas. Bu dosya şunları ekler:
   - KVKK onay alanları (`profiles.kvkk_onay_verildi` vb.) + `kvkk_onayini_ver()` RPC'si
     (Not: yurt dışına aktarım açık rızası bu onaydan AYRI kolonlarda tutulur —
     bkz. aşağıdaki 0042 migration'ı, `profiles.yurtdisi_onay_verildi` vb.)
   - Özel içerik "okundu" bilgisi ve üye başına isteğe bağlı son geçerlilik
     tarihi (`content_access` tablosuna yeni kolonlar) + otomatik/temizlik RPC'leri
   - Admin'in başka bir üyeyi (veya kendini) silebilmesi için `admin_delete_user_data()`
     (Edge Function tarafından kullanılır, doğrudan çağrılamaz)
   - Üye arama için `pg_trgm` indeksleri
   - `avatarlar` bucket'ına kullanıcı yükleme izinlerinin kaldırılması (panel
     artık profil fotoğrafı yüklemiyor, Supabase Storage kullanmıyor)
   - Kalan tüm "Signed-In Users Can Execute" uyarılarını gidermek için izin normalizasyonu
5. **Dashboard → Authentication → Auth Settings (veya Policies) → Password
   Security** kısmına git ve **"Leaked password protection"** seçeneğini
   **aç**. Bu, SQL ile yapılamayan tek ayardır ve Security Advisor'daki
   "Leaked Password Protection Disabled" uyarısını giderir.
6. Dosyanın en altındaki talimatla **kendini admin yap**:
   - Önce siteden normal şekilde kayıt ol (Adım 6'dan sonra, anahtarları girdikten sonra).
   - **E-postanı doğrulamayı unutma** (aşağıdaki "Giriş Yapamıyorum" bölümüne bak).
   - Sonra SQL Editor'de:
     ```sql
     update public.profiles set role = 'admin' where email = 'SENIN_EPOSTAN@ornek.com';
     ```
   - Bundan sonraki tüm rol atamaları `/panel/admin.html` üzerinden yapılabilir.

---

## RLS Hakkında Sık Sorulan Sorular

**"Proje oluştururken RLS'i aktif etmeyi unuttum, şimdi nasıl açarım?"**

Endişelenmene gerek yok — Supabase projesi **oluşturulurken** işaretlenecek
genel bir "RLS'i aç" seçeneği (checkbox) YOKTUR. RLS, tablo bazında,
`alter table <tablo> enable row level security;` komutuyla açılır — ve bu
komutlar zaten `0001_schema_rbac_rls.sql` dosyasının içinde, senin için
hazır halde duruyor (dosyada "6) RLS'İ AKTİF ET" başlığını ara). Yani
**yukarıdaki Adım 1'de bu dosyayı çalıştırdıysan RLS zaten açık.**

Bunu doğrulamanın yolu: Dashboard → **Advisors → Security Advisor →
Errors** sekmesine bak. Ekran görüntünde bu sekme **"0 errors"**
gösteriyordu — eğer herhangi bir tabloda RLS kapalı olsaydı, Supabase bunu
tam olarak burada, **"Errors"** (uyarı değil, hata) olarak listelerdi.
Gördüğün 15 madde **"Warnings"** (uyarı) sekmesindeydi — bunlar RLS'in kapalı
olmasıyla ilgili değil, ek sıkılaştırma önerileriydi; `0002_guvenlik_sikilastirma.sql`
dosyası tam olarak bunları gideriyor.

**"Yeni bir proje oluştursam mı, olmayacak mı diye?"**

Hayır, gerek yok. Mevcut projendeki anahtarlar zaten `assets/js/core/supabase-client.js`
ve `assets/js/panel.js` içine işlenmiş durumda; yeniden başlarsan bu iki
dosyayı, Google OAuth ayarlarını, e-posta şablonlarını ve Edge Function'ı
BAŞTAN kurman gerekir. Önce aşağıdaki "Giriş Yapamıyorum" bölümündeki
kontrol listesini dene — büyük ihtimalle proje değil, tek bir ayar (en sık:
e-posta doğrulama) sorunun kaynağı.

---

## "Giriş Yapamıyorum / Panele Giremiyorum" — Sorun Giderme

Admin rolünü SQL ile verdiğin halde ne admin ne de normal bir kullanıcı
olarak giriş yapamıyorsan, sırayla şunları kontrol et:

1. **E-posta doğrulanmamış olabilir (en sık neden).** Supabase'de
   varsayılan olarak "Confirm email" açıktır — kullanıcı, gelen doğrulama
   linkine tıklamadan `signInWithPassword` ile giriş yapamaz
   (`auth-pages.js` bu durumda zaten "E-posta adresini henüz doğrulamadın"
   mesajını gösterir, ama e-posta hiç gelmediyse bu mesajı görmeden takılırsın).
   - Dashboard → **Authentication → Users** kısmına git, kendi hesabını bul.
     "Email Confirmed At" sütunu boşsa henüz doğrulanmamış demektir.
   - Aynı satırdaki **⋯ menüsünden "Confirm email"** ile elle doğrulayabilirsin
     (test için hızlı çözüm).
   - Kalıcı çözüm: Supabase'in ücretsiz katmandaki kendi SMTP'si **saatte
     sadece birkaç e-postayla sınırlıdır** — çok deneme yaptıysan e-postalar
     hiç gelmemiş olabilir (spam/gereksiz klasörünü de kontrol et). Gerçek
     kullanıcı trafiği bekliyorsan **Project Settings → Auth → SMTP Settings**
     kısmından kendi SMTP'ni (ör. Resend, Brevo'nun ücretsiz katmanları)
     bağlaman önerilir.
   - Alternatif: "Google ile Giriş Yap" e-posta doğrulaması gerektirmez —
     test için onu deneyebilirsin.
2. **Site URL / Redirect URLs eksik olabilir.** Dashboard →
   **Authentication → URL Configuration**:
   - **Site URL**, sitenin gerçekte yayında olduğu adresle BİREBİR aynı
     olmalı (`https://abdullah-eymen-asru.pages.dev`).
   - **Redirect URLs** listesinde en azından şunlar olmalı:
     ```
     https://abdullah-eymen-asru.pages.dev/panel/panel.html
     https://abdullah-eymen-asru.github.io/panel/panel.html
     http://localhost:4000/panel/panel.html
     ```
   Bu liste eksikse OAuth/e-posta linkleri tıklandığında "redirect not
   allowed" hatası alırsın, giriş formu kendisi çalışsa bile.
3. **Anahtarlar güncel projeyle eşleşiyor mu?** `assets/js/core/supabase-client.js`
   içindeki `SUPABASE_URL` ve `SUPABASE_ANON_KEY`, Dashboard → **Project
   Settings → API** kısmındaki DEĞERLERLE birebir aynı olmalı. Farklı bir
   proje oluşturup denediysen ve eski anahtarlar hâlâ dosyada duruyorsa,
   tarayıcı hâlâ eski (artık var olmayan) projeye bağlanmaya çalışır.
4. **Tarayıcı konsoluna bak.** F12 (veya sağ tık → İncele) → **Console**
   ve **Network** sekmeleri, gerçek hata mesajını gösterir (örn.
   "Invalid API key", "fetch failed", CORS hatası vb.) — bu mesaj sorunu
   kesinleştirir, README'deki genel ihtimalleri tek tek denemek yerine
   doğrudan asıl nedene gider.
5. **RLS bu sorunun nedeni DEĞİLDİR.** Yukarıdaki "RLS Hakkında Sık Sorulan
   Sorular" bölümünde açıklandığı gibi RLS zaten açık ve giriş/kayıt akışını
   (Supabase Auth) hiç etkilemez — RLS sadece `profiles`, `special_content`
   gibi TABLOLARA erişimi kontrol eder, kimlik doğrulamanın (login) kendisini
   değil.

---

## Adım 2 — Google OAuth Kurulumu (kısa özet)

1. **Google Cloud Console** → yeni proje (veya mevcut) → *APIs & Services →
   Credentials* → **Create Credentials → OAuth client ID** → Application
   type: **Web application**.
2. **Authorized redirect URIs** kısmına Supabase'in sana Dashboard'da
   (Authentication → Providers → Google) gösterdiği callback URL'ini ekle —
   formatı şuna benzer:
   `https://XXXXXXXXXXXX.supabase.co/auth/v1/callback`
3. Oluşan **Client ID** ve **Client Secret**'ı Supabase Dashboard →
   **Authentication → Providers → Google** sayfasına yapıştır, provider'ı
   **Enable** yap.
4. Yukarıdaki "Giriş Yapamıyorum" bölümünün 2. maddesindeki **Site URL /
   Redirect URLs** ayarını yap — bu adım olmadan Google girişi de
   "redirect not allowed" hatası verir.

---

## Adım 3 — E-posta Şablonları (Doğrulama / Şifre Sıfırlama / E-posta Değiştirme)

Supabase varsayılan e-posta şablonları İngilizce gelir. Dashboard →
**Authentication → Email Templates** kısmından şu şablonları Türkçeleştirebilirsin:

| Şablon | Ne zaman gider | Hangi sayfamız kullanır |
|---|---|---|
| **Confirm signup** | Kayıt olunca | `hesap/kayit.md` → `hesap/hesap-onayla.md` (kod ile) veya linkle |
| **Reset password** | "Şifremi Unuttum" gönderilince | `hesap/sifremi-unuttum.md` → `hesap/sifre-guncelle.md` |
| **Change Email Address** | Panelden e-posta değiştirilince — "Secure email change" açıkken hem eski hem yeni adrese ayrı ayrı gider | `panel/panel.md` ("E-posta Değiştir") → `hesap/giris.md` (veya panelden kodla) |

Ücretsiz katmanda Supabase'in kendi SMTP'si **saatte sadece birkaç
e-postayla sınırlıdır**; gerçek kullanıcı trafiği bekliyorsan
**Project Settings → Auth → SMTP Settings** kısmından kendi SMTP'ni
bağlaman önerilir. Ücretsiz/uygun seçenekler:

| Sağlayıcı | Ücretsiz katman | Not |
|---|---|---|
| [Resend](https://resend.com) | Ayda 3.000 mail, günde 100 | Kurulumu en basit olanlardan, Supabase dokümanlarında da örnek olarak geçer |
| [Brevo](https://www.brevo.com) (eski Sendinblue) | Günde 300 mail | Türkiye'den kayıt/onay süreci diğerlerine göre biraz daha sorunsuz |
| [Amazon SES](https://aws.amazon.com/ses/) | İlk 62.000 mail/ay (EC2 üzerinden) ücretsiz, dışarıdan gönderimde ücretli | Kurulumu daha teknik, "sandbox" modundan çıkmak için AWS'e başvuru gerekir |

SMTP Settings kısmında dolduracağın alanlar tipik olarak: **Sender email**
(gönderen adresin, ör. `no-reply@siten.com` — sağlayıcıda domain
doğrulaması yapman gerekir), **Sender name**, **Host**, **Port** (genelde
587), **Username**, **Password** (sağlayıcının verdiği API anahtarı/SMTP
şifresi). Kaydettikten sonra Dashboard'daki **"Send test email"** ile
gerçekten gidip gitmediğini kontrol et — kendi SMTP'ni bağlasan bile mail
sağlayıcıları (Gmail, Outlook vb.) yeni/az kullanılan bir gönderen
domainini ilk başta SPAM'e atabilir; bu yüzden site genelinde her mail
ekranında kullanıcıya SPAM klasörünü kontrol etmesini hatırlatıyoruz (bkz.
aşağıki "E-posta Gönderilen Ekranlarda SPAM Uyarısı" bölümü) — kendi SMTP'ni
bağladıktan sonra bile bu uyarıyı kaldırman ÖNERİLMEZ.

Kendi SMTP'ni bağlamazsan bile site çalışır; sadece Supabase'in ücretsiz
saatlik limitine takılabilirsin (bkz. yukarıdaki "Giriş Yapamıyorum"
bölümü, madde 1).

---

## Adım 4 — Dosyaları Siteye Kopyala ve Anahtarları Gir

1. `assets/`, `hesap/giris.md`, `hesap/kayit.md`, `hesap/sifremi-unuttum.md`,
   `hesap/sifre-guncelle.md`, `hesap/hesap-onayla.md`, `panel/panel.md`,
   `panel/admin.md`, `panel/ozel-icerik.md` dosyaları zaten kendi
   klasörlerinde (`hesap/`, `panel/`) hazır geliyor — fork'ladıysan bunları
   olduğu gibi koru.
2. `assets/js/core/supabase-client.js` içindeki iki değeri doldur (Dashboard →
   **Project Settings → API**):
   ```js
   const SUPABASE_URL = "https://XXXXXXXXXXXX.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";  // "anon public" anahtarı — GİZLİ DEĞİL
   ```
   > `anon` anahtar tarayıcıda açıkta olacak şekilde tasarlanmıştır, sorun
   > değil. **ASLA** `service_role` anahtarını buraya veya herhangi bir
   > frontend dosyasına yazma — o anahtar RLS'i tamamen by-pass eder.
3. `assets/js/panel.js` içindeki `DELETE_ACCOUNT_FUNCTION_URL` değerini
   Adım 5'te deploy ettiğin Edge Function URL'iyle güncelle.
4. Header menüsü (`_layouts/default.html` içindeki `#auth-nav`) zaten
   otomatik — ayrıca link eklemene gerek yok, `assets/js/auth/nav-auth.js`
   oturum durumuna göre kendisi dolduruyor (bkz. "Header'daki Hesap Menüsü"
   bölümü, README'nin "Site Rehberi" kısmında).

---

## Adım 5 — `delete-account` Edge Function'ını Deploy Et

Bu fonksiyon **zorunludur**: bir kullanıcının kendi Auth hesabını gerçekten
silebilmesi için `service_role` yetkisi gerekir ve bu yetki asla tarayıcıya
verilemez — bu yüzden bu işlemi Supabase'in sunucusuz Edge Function'ı
üstlenir.

```bash
# Supabase CLI kurulu değilse:
npm install -g supabase

# Proje köküne git, login ol ve projeyi bağla:
supabase login
supabase link --project-ref XXXXXXXXXXXX   # Dashboard URL'indeki proje id'si

# Fonksiyonu deploy et:
supabase functions deploy delete-account
```

Deploy sonrası Dashboard → **Edge Functions → delete-account** kısmında
görünen URL'i kopyala (`.../functions/v1/delete-account`) ve Adım 4.3'te
`panel.js` içine yapıştır. `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
ortam değişkenleri Supabase tarafından otomatik sağlanır, elle bir şey
eklemene gerek yok.

`supabase/functions/delete-account/index.ts` içindeki `ALLOWED_ORIGINS`
listesini kendi domainlerinle güncellemeyi unutma (CORS koruması).

**Güncelleme notu:** Bu fonksiyon artık isteğe bağlı bir
`hedef_kullanici_id` parametresi kabul ediyor — admin panelindeki
"Kullanıcılar & Roller" bölümünde bir üyenin yanındaki **Sil** butonuna
basıldığında bu parametre gönderilir ve (çağıran gerçekten admin ise)
o üyenin hesabı silinir. Parametre gönderilmezse (panelim sayfasındaki
"Hesabımı Kalıcı Olarak Sil" gibi) çağıran her zaman **kendi** hesabını
siler — admin de dahil, kendi hesabını aynı şekilde silebilir. Eğer
daha önce bu fonksiyonu deploy ettiysen, güncellenmiş `index.ts`'i
tekrar deploy etmen gerekir (`supabase functions deploy delete-account`),
yoksa admin panelindeki üye silme butonu çalışmaz.

---

## Adım 5c — `admin-change-email` Edge Function'ını Deploy Et

Bu fonksiyon **zorunludur** eğer admin panelindeki "E-posta Değiştir"
butonunu kullanacaksan. Kullanıcının kendi panelinden yaptığı e-posta
değişikliği ("Panelim" → "E-posta Değiştir") **çift onaylıdır** (hem eski
hem yeni adres onaylanmalı — bkz. yukarıdaki "E-posta Değiştirme Akışı"
bölümü); bu, eski adresine artık erişimi olmayan bir kullanıcıyı
kilitleyebilir. Bu fonksiyon, admin panelinden çağrılan yedek yoldur:
e-posta **hiçbir mail gönderilmeden, anında** değişir — ne eski ne yeni
adrese hiçbir şey gitmez, eski adrese erişim gerekmez. Bunu
`auth.admin.updateUserById(id, { email, email_confirm: true })`
(service_role) ile yapıyoruz; `email_confirm: true`, Supabase'e bu adresi
zaten doğrulanmış say demektir, bu yüzden onay maili göndermez.

```bash
# delete-account'ı zaten deploy ettiysen supabase CLI kurulu ve login'sindir,
# sadece bu ikinci fonksiyonu deploy etmen yeterli:
supabase functions deploy admin-change-email
```

Deploy sonrası Dashboard → **Edge Functions → admin-change-email**
kısmında görünen URL'i kopyala (`.../functions/v1/admin-change-email`) ve
`assets/js/admin.js` içindeki `ADMIN_CHANGE_EMAIL_FUNCTION_URL` sabitini
güncelle (`delete-account` ile aynı Supabase projesindeysen genelde sadece
fonksiyon adı değişir, `SUPABASE_URL` kısmı aynı kalır).

`supabase/functions/admin-change-email/index.ts` içindeki
`ALLOWED_ORIGINS` listesini de `delete-account/index.ts` ile **aynı**
domainlerle güncellemeyi unutma (CORS koruması).

**Nasıl kullanılır:** Admin panelinde "Kullanıcılar & Roller" tablosundaki
bir üyenin yanındaki **"E-posta Değiştir"** butonuna basınca açılan
formdan yeni adresi girip **"E-postayı Şimdi Değiştir"**e basılır.
İşlem tamamlanır tamamlanmaz (mail beklemeden) kullanıcının e-postası
değişmiş olur; bir sonraki girişte yeni adresini kullanması yeterlidir.

**Neden mail göndermiyoruz (versiyon geçmişi notu):** İlk sürümde bu
fonksiyon `email_confirm` parametresini göndermiyordu ve "bu, admin API'yi
'Secure email change' kuralından muaf tutar, sadece yeni adrese onay
maili gider" varsayılıyordu. Bu varsayım **yanlıştı** — Supabase'in kendi
dokümantasyonu, "Secure email change" projede açıkken
`updateUserById()`'ın da (admin API üzerinden bile) davranışının proje
ayarına bağlı olduğunu, bazı durumlarda hiç mail göndermediğini belirtiyor.
Pratikte bu, "onay maili gönderildi" mesajı görünmesine rağmen kullanıcıya
hiçbir mailin ulaşmamasına yol açıyordu. `email_confirm: true` ile bu
belirsizlik tamamen ortadan kalkıyor: değişiklik anında, garantili şekilde
gerçekleşiyor. Bu güvenli çünkü zaten admin, kullanıcının kimliğini (mesaj/
iletişim formu üzerinden) elle doğrulamış olarak bu işlemi başlatıyor —
ekstra bir e-posta onayına ihtiyaç yok.

### "admin-change-email 'Load failed' / CORS Hatası Alıyorum"

Admin panelinde "E-postayı Şimdi Değiştir"e basınca kırmızı kutuda
**"E-posta değiştirilemedi: Load failed"** (Safari) veya **"...: Failed to
fetch"** (Chrome/Edge) görüyorsan, bu istek Edge Function'a **hiç
ulaşmadan** tarayıcı tarafından engellendiği/başarısız olduğu anlamına
gelir — yani hata fonksiyonun İÇİNDE değil, fonksiyona ULAŞMADAN ÖNCE
oluyor. Sırayla kontrol et:

1. **Fonksiyon gerçekten deploy edildi mi?** Dashboard → **Edge Functions**
   listesinde `admin-change-email` görünüyor mu ve durumu "Deployed" mi?
   Görünmüyorsa yukarıdaki `supabase functions deploy admin-change-email`
   komutunu (proje köküne `cd`'lenmiş, `supabase login` yapılmış halde)
   tekrar çalıştır. Deploy sırasında bir hata çıktıysa (ör. `SUPABASE_URL`
   env değişkeni tanımsız) terminal çıktısını oku, deploy başarısız olmuş
   olabilir.
2. **URL doğru mu?** `assets/js/admin.js` içindeki
   `ADMIN_CHANGE_EMAIL_FUNCTION_URL` sabiti, Dashboard'daki fonksiyonun
   gerçek URL'iyle **birebir** eşleşmeli (proje referansı — `https://`
   ile `.supabase.co` arasındaki rastgele harf/rakam dizisi — dahil).
   Farklı bir Supabase projesinden kopyalanmış eski bir URL kalmışsa bu
   hata tam olarak buradan çıkar.
3. **Sitenin adresi `ALLOWED_ORIGINS` listesinde mi?** (en sık karşılaşılan
   sebep) `supabase/functions/admin-change-email/index.ts` içindeki
   `ALLOWED_ORIGINS` dizisi, admin panelini AÇTIĞIN adresin **birebir
   aynısını** içermeli — protokol (`https://`), `www.` öneki (varsa/yoksa)
   ve sondaki `/` olmaması dahil tam eşleşmesi gerekir. Örnek: siteyi
   `https://www.siten.com` üzerinden açıyorsan ama listede sadece
   `https://siten.com` varsa (başında `www.` yoksa) bu bir CORS engeli
   olarak sayılır. Listeye eksik olan adresi ekleyip **yeniden deploy et**
   (`supabase functions deploy admin-change-email`) — dosyayı düzenlemek
   tek başına yeterli değildir, deploy edilmesi gerekir.
4. **Tarayıcı konsolunu kontrol et** (F12 / Geliştirici Araçları → Console
   ve Network sekmesi). Kırmızı bir CORS hatası mesajı (`has been blocked
   by CORS policy` gibi) görüyorsan bu 3. maddeyi doğrular. `net::ERR_*`
   ile başlayan bir hata görüyorsan (ör. `ERR_NAME_NOT_RESOLVED`) bu
   genelde 2. maddedeki URL hatasını doğrular.
5. **Reklam engelleyici / gizlilik uzantısı** bazı tarayıcı uzantıları
   `*.supabase.co` gibi adreslere giden istekleri engelleyebilir; farklı
   bir tarayıcıda/gizli sekmede deneyerek bunu eleyebilirsin.

Bu kontrolleri yaptıktan sonra hâlâ sorun yaşıyorsan, Dashboard →
**Edge Functions → admin-change-email → Logs** kısmına bak — istek
fonksiyona ulaştıysa (yani sorun 1-5 değilse) buradaki loglarda gerçek
hatayı (ör. yetkisiz kullanıcı, geçersiz e-posta biçimi) görürsün.

### "İşlem Başarılı Görünüyor Ama Kullanıcıya Mail Gelmedi"

Bu senaryoyu yaşadıysan ve fonksiyon şu an (2. sürüm, `email_confirm:
true` gönderen versiyon) deploy ediliyse endişelenme — bu **artık beklenen
davranış**: fonksiyon zaten mail göndermiyor, e-postayı **anında** ve
mailsiz değiştiriyor. "E-postası güncellendi" mesajını gördüysen işlem
tamamlanmış demektir; kullanıcı bir sonraki girişte yeni adresini
kullanmalı, mail bekletmesine gerek yok.

Eğer hâlâ eski davranışı (yani "mail gönderildi" mesajını) görüyorsan,
`supabase/functions/admin-change-email/index.ts` dosyandaki
`updateUserById()` çağrısında `email_confirm: true` parametresinin olup
olmadığını kontrol et — yoksa dosyanın eski bir sürümünü kullanıyorsun
demektir, güncel dosyayla değiştirip **yeniden deploy et**
(`supabase functions deploy admin-change-email`).

---

## Adım 5b — İki Faktörlü Doğrulama (2FA / TOTP)

Panelim sayfasındaki "İki Faktörlü Doğrulama" bölümü, Supabase Auth'un
**yerleşik** TOTP MFA desteğini kullanır (`supabase.auth.mfa.*` — ekstra
bir tablo veya paket kurmana gerek yok). Varsayılan olarak Supabase
projelerinde bu özellik zaten açıktır; kapalıysa Dashboard →
**Authentication → Providers** sayfasının altındaki **"Multi-Factor
Authentication"** bölümünden **"Authenticator App (TOTP)"** seçeneğini aç.
Üyeler kendi isteğiyle etkinleştirir/kaldırır, zorunlu değildir.

**Yedek/kurtarma kodları:** 2FA etkinleştirildiği anda (ve panelden
istenildiği zaman) 8 adet tek seferlik yedek kod üretilir — authenticator
uygulamasına erişim kaybedilirse (telefon değişimi, uygulama silinmesi
vb.) girişte bu kodlardan biriyle devam edilebilir. Bu, Supabase Auth'un
yerleşik MFA API'sinin **desteklemediği** bir özellik olduğu için ayrı bir
migration ile eklendi: `supabase/migrations/0017_2fa_yedek_kodlar.sql`
(tablo + `yedek_kodlar_olustur()` / `yedek_kod_durumu()` /
`yedek_kod_ile_2fa_kaldir()` / `yedek_kodlar_temizle()` fonksiyonları).
Kodların yalnızca SHA-256 hash'i saklanır; düz metin kod sadece üretildiği
an panelde gösterilir ve kısa süreli bir `.txt` indirmesiyle sunulur (bkz.
`panel.js` → `yedekKodlariGosterVeIndir`). Girişte "Authenticator'a
erişemiyorum" bağlantısına tıklayıp doğru bir yedek kod girmek, hesaptaki
2FA'yı kaldırır (kullanıcıya panelden tekrar kurması önerilir) — bkz.
`auth-pages.js` → `mfaKoduIste()`. Bu migration'ı da diğerleri gibi
Supabase Dashboard → SQL Editor'den çalıştırman gerekiyor.

**İçerik editörü kendi yazısı dışını göremez/düzenleyemez:**
`supabase/migrations/0018_editor_sadece_kendi_icerigi.sql` — role='editor'
artık `taslak_icerikler` tablosunda SADECE kendi oluşturduğu satırları
görebilir/düzenleyebilir/silebilir; içerik sorumlusu (manager) ve admin'in
gizli taslakları editöre hiç görünmez. manager ve admin bu kısıttan
etkilenmez. GitHub'a commit edilmiş içerikler için AYNI kural hem panelde
(`assets/js/github-yonetim/github-yonetim.js`) hem de sunucu tarafında
(`cloudflare worker/github_icerik_yonetim_worker/worker.js`) uygulanır —
Worker'ı güncellediysen yeniden deploy etmeyi unutma.

**Mesajlarda "sil" artık sadece kendi tarafından siler:**
`supabase/migrations/0019_mesajlarda_kisisel_silme.sql` — bir sohbeti ya da
tek bir mesajı silmek artık karşı taraftaki kopyayı ETKİLEMEZ, sadece
silen kişinin kendi görünümünden kaldırır (bkz. dosyanın başındaki notlar).

**BUG DÜZELTMESİ — editor için "Admin adına yayınla" hiç çalışmıyordu:**
`supabase/migrations/0020_admin_listesi_rpc_editor_erisimi.sql` ⚠️ **YENİ —
Supabase Dashboard → SQL Editor'den çalıştırman gerekiyor.** Migration
0016 § 3, `profiles` tablosunun SELECT RLS'ini `is_manager_or_admin()`'e
bağlamıştı (admin + manager görebilir) — ama role='editor' için "Admin
adına yayınla" kutusu da tam olarak manager ile aynı şekilde çalışması
gerekiyordu (bkz. `github-yonetim.js` dosya başı notu). Sonuç: bir editor
hedef admin listesini çekmeye çalıştığında RLS sessizce boş bir liste
döndürüyordu (hata fırlatmıyordu), dropdown boş kalıyor, kutuyu
işaretleyip kaydetmeye çalışınca panel "Yazar bilgisi belirlenemedi
(profil adı boş)" hatası veriyor ve içerik hiçbir zaman admin onayına
gitmiyordu. Bu migration, RLS'i gevşetmeden (editor'ün tüm profilleri
görmesi gereksiz bir bilgi sızıntısı olurdu) sadece bu ihtiyaç için dar
kapsamlı bir `admin_listesi_getir()` RPC'si ekliyor — içerik yönetebilen
herkese (editor/manager/admin) SADECE admin profillerinin
id/full_name/email'ini döner. `github-yonetim.js` → `wireAdminAdinaTalep()`
artık doğrudan tablo sorgusu yerine bu RPC'yi çağırıyor.

---

## Adım 6 — CSP / `_headers` Kontrolü

Mevcut `_headers` dosyandaki CSP zaten şunu içeriyor:

```
connect-src 'self' https:; ...
```

`https:` joker değeri tüm HTTPS kaynaklarına (Supabase API'si dahil)
izin verdiği için **hiçbir değişiklik yapmana gerek yok**. (Not: Supabase
JS SDK artık `esm.sh` CDN'inden DEĞİL, yerel `assets/js/vendor/
supabase.js` dosyasından yükleniyor — bkz. `assets/js/core/
supabase-client.js` başındaki not — bu yüzden CSP'de `esm.sh` için ayrıca
bir izin gerekmiyor.)

---

## E-posta Gönderilen Ekranlarda SPAM Uyarısı

Supabase'in (kendi SMTP'si veya bağladığın 3. parti SMTP) gönderdiği
mailler bazen alıcının SPAM/Gereksiz klasörüne düşebiliyor. Kullanıcının
"mail gelmedi" sanıp takılmasını önlemek için, mail gönderilen **her**
ekranda aynı uyarı **tutarlı bir şekilde** gösteriliyor:

| Sayfa | Ne zaman görünür |
|---|---|
| `hesap/kayit.md` | Kayıt formu başarıyla gönderildikten sonra |
| `hesap/hesap-onayla.md` | Sayfa açılır açılmaz (kod kayıt mailinde geldiği için) |
| `hesap/sifremi-unuttum.md` | Sıfırlama linki isteği gönderildikten sonra |
| `panel/panel.md` ("E-posta Değiştir") | Onay linki isteği gönderildikten sonra |

Teknik olarak:

- Metin ve gösterme/gizleme mantığı **tek bir yerde**, `assets/js/core/supabase-client.js`
  içindeki `showSpamNotice(el)` / `hideSpamNotice(el)` fonksiyonlarında
  toplanıyor — uyarı metnini değiştirmek istersen SADECE bu dosyayı
  düzenlemen yeterli, dört ayrı sayfada arama yapmana gerek yok.
- Görünüm `assets/css/auth.css` içindeki `.auth-spam-notice` sınıfıyla
  geliyor — sarı/bilgi renginde, başarı (yeşil) veya hata (kırmızı)
  mesajlarıyla karışmaması için bilinçli olarak farklı stillendirildi ve
  ayrı bir `<div>`'de duruyor (`id="auth-spam-notice"`), böylece ikisi
  aynı anda görünebiliyor.
- `hesap/hesap-onayla.md` sayfasında uyarı **statik olarak** HTML'de duruyor
  (sayfa açılır açılmaz görünür) çünkü o sayfaya zaten "mail gönderildikten
  sonra" geliniyorsun; diğer üç ekranda ise ilgili JS fonksiyonu (kayıt,
  şifremi unuttum, e-posta değiştirme) API çağrısı **başarıyla** dönünce
  uyarıyı JS ile açıyor.
- `hesap/sifre-guncelle.md` sayfasına bu uyarı **eklenmedi** — o sayfa mail
  göndermiyor, zaten gönderilmiş bir maildeki linkten geliniyor.

**Yeni bir mail-gönderen ekran eklersen:** aynı deseni kullan —
`<div id="..." class="auth-spam-notice" hidden></div>` ekle, ilgili JS
fonksiyonunda başarı durumunda `showSpamNotice(document.getElementById(...))`
çağır.

---

## E-posta Değiştirme Akışı (`/panel/panel.html`)

Panelde artık "Profil Bilgileri" ile "Şifre Değiştir" arasında bir
**"E-posta Değiştir"** bölümü var. Hem e-posta/şifre ile hem **Google ile**
kayıt olmuş kullanıcılar için aynı şekilde çalışır (Supabase, Google ile
girmiş bir hesaba da e-posta/şifre girişini sonradan ekleyebilir; bu form
ikisi için de aynı `supabase.auth.updateUser({ email })` çağrısını yapar).

### Neden çift onaylı? (ve neden bu bir risk taşıyor)

Dashboard → **Authentication → Emails → "Secure email change"** ayarı
**açık olmalı** (varsayılan olarak zaten açıktır, kapatmamanı öneririm).
Açıkken Supabase, e-posta değiştirme isteğinde **hem eski (şu anki) HEM
yeni adrese** ayrı birer onay linki/kod gönderir ve değişiklik **ikisi de**
onaylanmadan tamamlanmaz. Bunun amacı: birinin hesabına izinsiz erişip
sessizce e-postayı kendi adresine çevirmesini engellemek — eski adresin
gerçek sahibi de onay vermeden değişiklik geçerli olmaz.

**Dürüstçe belirtmem gereken risk:** Bu güvenlik, eski adresine artık
erişimi olmayan (mailini unutmuş, hesabı kapatmış, vb.) meşru bir
kullanıcıyı da kilitleyebilir — "eski mailime giremiyorum, o yüzden zaten
yeni mail yazmak istiyorum ama sistem bunu tamamlamama izin vermiyor" gibi
bir çelişkiye düşebilir. Bunu tamamen ortadan kaldırmanın (yani tek onayla
değişikliğe izin vermenin) güvenlik bedeli daha büyük olduğu için, bunun
yerine riski **azaltan** iki önlem ekledik:

1. **Kod ile onaylama yedeği** — her iki mail de sadece bir link değil,
   aynı token'ı temsil eden bir **kod** da içerir (Supabase varsayılan
   mail şablonu ikisini de gönderir). Panel ekranındaki her iki durum
   satırının altında "Linke tıklayamıyor musun? Kod ile onayla" seçeneği
   var — link açılmasa/tıklanamasa bile (ör. mail istemcisi linki önden
   tüketmişse, ya da kullanıcı linki farklı bir cihazda/tarayıcıda
   açtıysa) değişiklik yine tamamlanabilir.
2. **Açık durum takibi** — panel, "Eski adres: Bekleniyor / ✓ Onaylandı" ve
   "Yeni adres: Bekleniyor / ✓ Onaylandı" rozetlerini ayrı ayrı gösterir,
   kullanıcı hangi adımda kaldığını görür; belirsizlik/kafa karışıklığı
   azalır.

Eski adresine gerçekten hiç erişimi kalmamış bir kullanıcı için tek çözüm
site yöneticisinin manuel müdahalesidir (Dashboard → Authentication →
Users → ilgili kullanıcı → e-postayı elle güncelle/doğrula). Bu, bilinçli
bir ödünleşim: "biri hesabımı ele geçirip mailimi çalabilir" riski, "eski
mailime erişemiyorum" senaryosundan istatistiksel olarak daha tehlikeli ve
daha sık istismar edilen bir saldırı olduğu için güvenlik tarafı seçildi.

### Akış (adım adım)

1. Kullanıcı yeni e-posta adresini girip **"Onay Linklerini Gönder"**e basar.
2. Supabase **hem eski hem yeni** adrese ayrı bir onay maili gönderir. Bu
   noktada giriş e-postası **henüz değişmemiştir**; panel ekranı bunu
   açıkça belirtir, SPAM uyarısını gösterir ve iki adres için de ayrı bir
   durum satırı açar ("Bekleniyor").
3. Kullanıcı **her iki** maildeki linke tıklar (ya da panelden ilgili
   satırın altındaki kutuya kodu girer). Linkle onaylananlar
   `hesap/giris.md`'ye döner ve "Bu e-posta adresi onaylandı, diğer adresi
   de onaylaman gerekiyor" mesajını görür; kodla onaylananlarda panel
   ekranındaki rozet anında "✓ Onaylandı"ya döner.
4. Her iki taraf da onaylanınca Supabase e-postayı gerçekten değiştirir.
   Kullanıcı artık **yeni** adresiyle giriş yapabilir.

### Teknik detay (dokunmana gerek yok ama bilgi için)

- `assets/js/panel.js` → `wireEmailChange()`: formu gönderir
  (`updateUser({ email })`), sonra her iki adres için ayrı bir "kod ile
  onayla" formu render eder. Kod doğrulaması
  `supabase.auth.verifyOtp({ email, token, type: "email_change" })` ile
  yapılır — `email` parametresi olarak eski adres için **mevcut**
  (henüz değişmemiş) e-posta, yeni adres için **kullanıcının az önce
  girdiği** adres gönderilir; Supabase hangi tarafın onaylandığını buna
  göre ayırt eder.
- `assets/js/auth/auth-pages.js` → `initGirisPage()`: linkle gelindiğinde URL
  hash'indeki `type=email_change` bilgisini okuyup "bu adres onaylandı,
  diğerini de onayla" mesajını gösterir (kesin "değişti" demez, çünkü tek
  link her zaman yeterli değildir).

**Not:** Google ile giriş yapan bir kullanıcı e-postasını değiştirirse, bu
değişiklik sadece Supabase Auth'daki (ve `profiles` tablosundaki, trigger
sayesinde) kayda uygulanır — Google hesabının kendisini etkilemez, bir
dahaki "Google ile Giriş Yap"ta kullanıcı yine kendi Google e-postasıyla
oturum açar ama panelde artık kayıtlı olan yeni e-postayı görür. Bu iki
adresin birbirinden ayrışmasını istemiyorsan (yani Google kullanıcılarının
e-posta değiştirmesini engellemek istersen), `panel/panel.md`'deki
"E-posta Değiştir" bölümünü `profile.app_metadata` veya
`session.user.app_metadata.provider` kontrolüyle koşullu gizleyebilirsin —
mevcut kod bunu bilinçli olarak KISITLAMIYOR, herkes değiştirebiliyor.

### Eski Adresine Erişimi Kalmamış Kullanıcılar İçin: Admin'in Tek Onaylı Değişikliği

Yukarıdaki çift onay akışını eski adresine erişemediği için tamamlayamayan
kullanıcılar için iki parça eklendi:

**1. Kullanıcı tarafı — "Eski Mailime Erişemiyorum" kutusu**
(`panel/panel.md`, "E-posta Değiştir" bölümünün hemen altında, her zaman
görünür bir bölüm): kullanıcıya durumu kısaca anlatır ve iki seçenek sunar
— **"Yöneticiyle Mesajlaş"** (sayfayı zaten var olan "Mesajlar" bölümüne
kaydırır — `panel/panel.md` içindeki `#chat-kullanici` mesajlaşma kutusu,
bkz. `assets/js/chat.js` → `wireUserChat()`) veya **"İletişim Formuna
Git"** (`kurumsal/iletisim.md`'ye, siteye gömülü Google Forms'a yönlendirir).
Kullanıcı oturum açmış durumda değilse (şifresini de unuttuysa vb.) zaten
panele giremez — bu durumda tek yol doğrudan `kurumsal/iletisim.html`'den
ya da sitedeki başka bir iletişim kanalından (bkz. `_config.yml` →
`social:`) admine ulaşmaktır.

**2. Admin tarafı — Admin panelinde "E-posta Değiştir" butonu**
(`panel/admin.md`, "Kullanıcılar & Roller" tablosunda her üyenin
yanında): admin, kullanıcının kimliğini (mesaj/iletişim formu üzerinden)
doğruladıktan sonra bu butona basar, açılan mini formda yeni adresi girer.
`assets/js/admin.js` → `wireAdminEmailChange()`, `supabase/functions/
admin-change-email/index.ts` Edge Function'ını çağırır — bu, `service_role`
ile `auth.admin.updateUserById()` kullanarak **sadece yeni adrese** bir
onay maili/kodu gönderir; **eski adrese hiçbir şey gitmez** ve eski adrese
erişim **gerekmez**. Kullanıcı yeni adresindeki linke tıklayabilir; linke
erişemiyorsa (farklı cihaz, mail istemcisi sorunu vb.) panelindeki "Eski
Mailime Erişemiyorum" bölümünün altındaki **"Yönetici benim için bir
değişiklik başlattı, kodum var"** açılır formuna dönüp yeni e-postasını ve
mailde gelen kodu girerek de tamamlayabilir (`wireAdminBaslatilanEpostaKodOnay()`
→ `supabase.auth.verifyOtp({ type: "email_change" })`). Bu form BİLİNÇLİ
OLARAK yukarıdaki çift-onay formundan ayrıdır — kullanıcının kendi
başlattığı istekten hemen sonraki oturum durumuna değil, sadece girdiği
e-posta + koda bağlıdır; kullanıcı panele daha sonra, farklı bir ziyarette
dönse bile çalışır. Kurulumu için bkz. "Adım 5c" (aşağıda, `delete-account`'ın
hemen ardından).

**Neden bu ayrım güvenli?** Kullanıcının kendi başına yapabildiği
değişiklik (panel → "E-posta Değiştir") her zaman ÇİFT onay ister — kimse
(kullanıcının kendisi dahil, bir saldırgan hesaba girmiş olsa bile) TEK
onayla e-postayı değiştiremez. Tek onaylı yol SADECE admin'in elle,
kimlik doğrulaması yaptıktan sonra tetikleyebildiği ayrı bir işlemdir —
yani "tek onay yeterli" istisnası kullanıcıya değil, güvendiğin bir
yöneticiye verilmiş oluyor.

---

## Gizli Dosya Nasıl Gönderilir? (Admin → Kullanıcıya Özel Dosya Paylaşımı)

Bu, "gizli dosyayı nasıl göndereceğim" sorusunun cevabı — hazır bir akış
zaten var, ekstra bir araca gerek yok:

1. `/panel/admin.html` sayfasını aç (sadece admin rolündeki hesap görebilir).
2. **"Yeni Özel İçerik / Makale Ekle"** formunu doldur: başlık, özet,
   (istersen) makale metni.
3. **"Ek Dosya"** alanından dosyayı seç — bu, formu gönderdiğinde otomatik
   olarak `ozel-dosyalar` adlı **private** Storage bucket'ına yüklenir
   (bucket herkese kapalı, sadece admin ve içeriğe erişimi olan kullanıcılar
   görebilir — bkz. `0001_schema_rbac_rls.sql` içindeki storage politikaları).
4. **"Erişim Verilecek Özel Üyeler"** listesinden dosyayı görmesini
   istediğin `special_user`/`admin` rolündeki hesapları işaretle. Her
   satırın sağında isteğe bağlı bir **tarih alanı** var — doldurursan o
   üyenin erişimi seçtiğin tarihte (gün sonunda) otomatik olarak sona
   erer; boş bırakırsan erişim **sınırsızdır**.
5. **"Yayınla ve Ata"**'ya bas. Seçtiğin kullanıcılar `/panel/panel.html`
   üzerinden içeriği görüp `/panel/ozel-icerik.html?id=...` sayfasından **"Eki
   İndir"** butonuyla indirebilir — bu buton her tıklandığında sadece
   **10 saniye geçerli**, tek seferlik bir Signed URL üretir (bkz.
   `ozel-icerik.js`), yani link kopyalanıp başkasıyla paylaşılsa bile işe
   yaramaz.

**İçeriği yayınladıktan sonra düzenleme:** "Mevcut Özel İçerikler"
bölümündeki **Düzenle** butonuyla başlık, özet, makale metni ve harici
dosya linkini istediğin zaman değiştirebilirsin — form otomatik olarak
"düzenleme moduna" geçer, değişikliklerini kaydettiğinde aynı içerik
güncellenir (yeni bir kopya oluşmaz).

**Okundu bilgisi ve son geçerlilik:** Üye, kendisine atanan bir içeriği
`/panel/ozel-icerik.html` üzerinden açtığı an içerik otomatik "okundu"
işaretlenir; bu bilgi hem üyenin kendi panelinde hem (istersen)
`content_access` tablosunda görünür. Bir üyeye tarih verdiysen, o tarih
geçtiğinde erişimi **anında** kesilir (veritabanı seviyesinde), ilgili
kayıt da en geç bir sonraki admin paneli ziyaretinde otomatik temizlenir.

Bu akış küçük/orta boy dosyalar (Supabase Storage sınırları içinde) için
tasarlandı. Çok büyük dosyalar (örn. 50GB) için aşağıdaki bölüme bak.

---

## Çok Büyük Dosyalar (Cloudflare R2)

Supabase Storage, ücretsiz ve düşük katmanlarda tek dosya boyutunu
sınırlar (ücretsiz katmanda varsayılan üst sınır 50MB'tır; Pro planla bile
tek dosya varsayılan 5GB'a kadar yükseltilebilir ama otomatik olarak 50GB
gibi bir boyutu desteklemez). 50GB gibi devasa bir dosyayı paylaşman
gerekiyorsa, `0002_guvenlik_sikilastirma.sql` migration'ı ile eklenen
**"harici dosya linki"** özelliğini kullan:

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2 Object
   Storage** → yeni bir bucket oluştur (R2, tek dosyada 5TB'a kadar
   destekler, GB başına Supabase'ten çok daha ucuzdur ve **egress/indirme
   ücreti almaz**).
2. Büyük dosyayı bucket'a yükle (Dashboard'dan sürükle-bırak ile; büyük
   dosyalarda `wrangler` CLI veya `rclone` kullanmak daha güvenilir olur).
3. Dosyanın herkese açık bir linkle erişilebilir olmasını istiyorsan,
   bucket ayarlarından **"Public access"**'i aç (R2.dev alt domaini verir,
   `https://pub-xxxx.r2.dev/dosya-adi.zip` gibi) — ya da kendi domainini
   bağlayabilirsin (Cloudflare, "custom domain" bağlama seçeneği sunar).
4. Aldığın linki, `/panel/admin.html`'deki içerik formunda **"50GB gibi çok
   büyük dosya için harici link"** alanına yapıştır, "Ek Dosya" alanını
   BOŞ bırak (ikisini aynı anda kullanma).
5. Kullanıcı `/panel/ozel-icerik.html` sayfasında artık **"Büyük Dosyayı İndir
   (harici bağlantı)"** butonunu görür, tıklayınca doğrudan R2 linkine
   gider.

**Dürüstçe belirtmem gereken güvenlik farkı:** Supabase'teki normal "Eki
İndir" akışı, her indirmede RLS kontrolünden geçen 10 saniyelik tek
kullanımlık bir link üretir — yani erişimi olmayan biri linki ele geçirse
bile işe yaramaz. R2'deki harici link ise (public açtıysan) **sabit ve
süresiz**dir; linki bilen HERKES indirebilir, RLS'in bir koruması yoktur.
Bu yüzden bu özelliği sadece "gerçekten gizli değil ama boyutu yüzden
Supabase'e sığmayan" dosyalar için kullan. Gerçekten hassas/gizli, 50GB
gibi büyük bir dosyayı erişim kontrollü paylaşmak istiyorsan, R2 bucket'ını
**private** bırakıp süreli imzalı linkleri (presigned URL) üreten bir
Cloudflare Worker yazmak gerekir — bu, mevcut "sunucusuz statik site"
mimarisinin ötesinde ayrı bir entegrasyondur, istersen ayrı bir adım olarak
kurabiliriz.

---

## Adım 8 — Test Kontrol Listesi

- [ ] (Turnstile açıkken) `/hesap/giris.html`, `/hesap/kayit.html` ve `/hesap/sifremi-unuttum.html`: form gönderiminde ekstra bir tıklama istenmeden işlem tamamlanıyor mu? Üst üste iki kez deneyince (token yenilenmesi) ikincisi de geçiyor mu?
- [ ] Giriş sayfasında formun üstünde Turnstile kutusu "Başarılı!" gösteriyor mu? (Cloudflare panelindeki siteverify uyarısı ilk başarılı denemeden sonra kapanır.)
- [ ] Tarayıcı konsolunda `challenges.cloudflare.com` için CSP/engelleme hatası yok mu? Google ile giriş hâlâ çalışıyor mu?
- [ ] `/hesap/kayit.html`'den e-posta ile kayıt ol → doğrulama e-postası geldi mi? → kayıt sonrası SPAM uyarısı göründü mü?
- [ ] E-postadaki linke tıkla → `/hesap/giris.html`'den giriş yapabiliyor musun?
- [ ] `/panel/panel.html` → "E-posta Değiştir" ile yeni bir adres gir → hem eski
      hem yeni adrese mail geldi mi (ve SPAM uyarısı göründü mü)? → sadece
      BİRİNİ onayla, e-posta hâlâ değişmemiş olmalı → diğerini de onayla
      (linkle veya kodla) → değişiklik tamamlandı mı, yeni adresle giriş
      yapabiliyor musun?
- [ ] Aynı testi "kod ile onayla" yedek yoluyla da dene (linke hiç tıklamadan,
      sadece panel ekranındaki kod formlarını kullanarak).
- [ ] `/panel/panel.html`'de "Eski Mailime Erişemiyorum" kutusundaki
      "Yöneticiyle Mesajlaş" linki mesaj bölümüne kaydırıyor mu? "İletişim
      Formuna Git" linki `/kurumsal/iletisim.html`'e gidiyor mu?
- [ ] `/panel/admin.html` → "Kullanıcılar & Roller"deki bir üye için
      "E-posta Değiştir"e bas → yeni adresi gir → SADECE o adrese mail geldi
      mi (eski adrese hiçbir şey gelmemeli) → linke tıklayınca değişiklik
      tamamlanıyor mu?
- [ ] Aynı admin testini kod ile de dene: kullanıcı olarak `/panel/panel.html`'e
      dön → "Eski Mailime Erişemiyorum" → "Yönetici benim için bir değişiklik
      başlattı, kodum var" formunu aç → yeni e-postayı ve mailde gelen kodu
      gir → e-posta güncelleniyor mu, yeni adresle giriş yapabiliyor musun?
- [ ] `/hesap/giris.html`'de "Google ile Giriş Yap" çalışıyor mu?
- [ ] `/hesap/sifremi-unuttum.html` → e-posta geldi mi → `/hesap/sifre-guncelle.html`'de
      yeni şifre belirleyip giriş yapabiliyor musun?
- [ ] `/panel/panel.html`: profil adı (Ad Soyad) kaydediliyor mu? (Avatar/bio
      alanları artık YOK — Supabase Storage kullanılmıyor, bkz. 0003 migration.)
- [ ] Kayıt formunda yurt dışı aktarım onay kutusunu (yurtdisi_onay)
      işaretlemeden kayıt olmaya çalış — engellenmeli. Aydınlatma
      bilgilendirmesi (Aydınlatma Metni linki) artık bir onay kutusu
      DEĞİL, sadece bilgi metni olduğu için ayrıca test edilmez.
      Checkbox'ı işaretleyip kayıt ol, `/panel/panel.html` → "KVKK Onayı"
      bölümünde HEM aydınlatma beyanının HEM yurt dışı rızasının ayrı ayrı
      onay tarihleriyle göründüğünü doğrula (bkz. migration 0042).
- [ ] `/panel/panel.html` → "İki Faktörlü Doğrulama" bölümünden 2FA'yı
      etkinleştir (Google Authenticator ile QR kodu okut, 6 haneli kodu
      doğrula) → tekrar sayfayı aç, "aktif" göründüğünü ve istersen
      kaldırabildiğini doğrula.
- [ ] Header'daki "Hesabım" menüsü giriş/çıkışa göre doğru içeriği gösteriyor mu?
- [ ] Kendini admin yaptıktan sonra `/panel/admin.html` açılıyor mu? Normal bir
      `user` hesabıyla `/panel/admin.html`'e gidince `panel/panel.html?hata=yetkisiz`'e
      yönlendiriliyor musun? (İKİNCİ bir tarayıcı/gizli sekme ile test et.)
- [ ] Admin panelindeki sol menüden her bölüme tıklayıp doğru alana
      kaydığını (sayfanın tek parça kaydırma olmadığını) doğrula.
- [ ] Admin panelinde "Kullanıcılar & Roller" arama kutusuna bir isim veya
      e-posta yaz, listenin filtrelendiğini doğrula.
- [ ] Admin panelinden bir kullanıcıyı `special_user` yap, bir özel içerik
      oluştur, o kullanıcıya (isteğe bağlı bir son geçerlilik tarihiyle)
      ata. O kullanıcıyla giriş yapıp `/panel/panel.html` üzerinden içeriği
      görebiliyor musun?
- [ ] Aynı içeriğin linkini (`/panel/ozel-icerik.html?id=...`) **yetkisi olmayan**
      bir hesapla (veya çıkış yapıp anonim olarak) açmayı dene — "Erişim
      yok" mesajı görmelisin.
- [ ] Özel içeriği üye hesabıyla aç → panelinde "Okundu" olarak
      işaretlendiğini doğrula. Admin panelinden aynı içeriği **Düzenle**
      ile değiştir, kaydet, değişikliğin yansıdığını doğrula.
- [ ] Bir üyeye kısa (ör. yarın) bir son geçerlilik tarihi ver, tarihi
      geçtikten sonra o üyenin içeriği artık göremediğini doğrula.
- [ ] Dosya ekli bir içerikte "Eki İndir" butonuna bas, indirme başlıyor mu?
      10 saniye sonra aynı linki tekrar kullanmayı dene (ör. tarayıcı
      geçmişinden) — artık çalışmamalı.
- [ ] Harici (Cloudflare R2) link eklediğin bir içerikte "Büyük Dosyayı
      İndir" butonu doğru adrese gidiyor mu?
- [ ] `/panel/panel.html`'de "Hesabımı Sil" akışını **test hesabıyla** dene:
      onay kutusuna "SİL" yaz → onayla → Supabase Dashboard →
      Authentication → Users listesinde hesabın gerçekten silindiğini
      doğrula.
- [ ] Admin panelinden **başka bir test üyesini** "Sil" butonuyla sil,
      gerçekten silindiğini doğrula (eski sürümde bu hata veriyordu).
- [ ] Admin hesabıyla `/panel/admin.html` → "Hesabım" bölümünden **kendi**
      admin hesabını silmeyi dene (başka bir admin hesabın olduğundan
      emin olarak test et, yoksa siteyi yönetecek kimse kalmaz).
- [ ] `supabase functions deploy delete-account` ile güncel Edge
      Function'ı deploy ettiğini doğrula — deploy etmezsen yukarıdaki iki
      madde başarısız olur.
- [ ] Dashboard → Authentication → Auth Settings → "Leaked password
      protection" seçeneğini açtığını doğrula.
- [ ] Dashboard → Advisors → Security Advisor → "Rerun linter" ile
      `0003_yeni_ozellikler_ve_guvenlik.sql`'den sonra uyarı sayısının
      azaldığını doğrula.

---

## Redirect URL'leri ve Supabase Danışman (Advisor) Uyarıları

### Authentication › URL Configuration — ne olmalı?
Kod, Supabase'e şu adresleri gönderir (`assets/js/auth/auth-pages.js`, `assets/js/panel.js`). **Redirect URLs listesinde bunların her biri bulunmalı:**

| Adres | Ne için kullanılır |
|---|---|
| `https://abdullah-eymen-asru.github.io/hesap/giris.html` | Google ile giriş ve e-posta doğrulama dönüşü |
| `https://abdullah-eymen-asru.github.io/hesap/kayit.html` | Google ile **kayıt** dönüşü (listede eksikse bu akış Site URL'ye düşer) |
| `https://abdullah-eymen-asru.github.io/hesap/sifre-guncelle.html` | Şifre sıfırlama e-postasındaki bağlantı |
| `https://abdullah-eymen-asru.github.io/panel/dashboard.html` | Panelden Google hesabı bağlama (`linkIdentity`) dönüşü |

**Öneri (en dar liste):** `**` joker karakterli girdileri (`.../**`) kaldırıp yukarıdaki 4 adresi tek tek tut. Joker, o alan adındaki *her* sayfaya token'lı yönlendirmeye izin verir; gerekmeyen izin açık kapıdır. Aynı 4 adresi `pages.dev` yedek sitesi **gerçekten kullanılıyorsa** onun için de tut; kullanılmıyorsa `pages.dev` girdilerinin hepsini sil.
**Silinecekler:** `.../panel/panel.html` (eski, yalnızca yönlendirme sayfası; artık hiçbir akış oraya dönmüyor), `http://localhost:4000/panel.html` (yanlış yol; yerelde Jekyll ile deniyorsan onun yerine `http://localhost:4000/hesap/giris.html`, `.../hesap/kayit.html`, `.../hesap/sifre-guncelle.html`, `.../panel/dashboard.html` koy, denemiyorsan sil).
**Site URL** alanı `https://abdullah-eymen-asru.github.io` olmalı (sonunda `/` olmadan). Yeni bir auth sayfası eklersen önce bu listeye ekle, yoksa Supabase kullanıcıyı Site URL'ye atar.

### Danışman (Advisor) uyarıları — hangisi neden kalır?
`supabase/migrations/0151_supabase_guvenlik_ve_performans_onerileri.sql` yapılabilecek her şeyi güvenli biçimde uygular (RLS politikaları, `(select auth.uid())`, yabancı anahtar indeksleri, sabit `search_path`, tetikleyici fonksiyon yetkileri, bucket listeleme, `btree_gist`). Geriye kalanlar **bilerek** böyledir:
- **`anon_security_definer_function_executable` (26) ve `authenticated_security_definer_function_executable` (~329):** Uygulama bu RPC'leri doğrudan çağırır; her biri içinde rol/yetki denetimi yapar. `anon` listesindeki 26 fonksiyon herkese açık sayfalar (yorum listesi, duyurular, demo ayarı, paylaşım bağlantısı, Substack/sitemap) ve RLS yardımcıları (`is_admin`, `is_owner`…) içindir; yalnızca doğru/yanlış ya da zaten herkese açık veri döndürürler. Hepsini kapatmak siteyi bozar.
- **`extension_in_public` (`pg_net`):** Supabase'in yönettiği bir eklenti, taşınamaz. Güvenle yok sayılabilir.
- **`unused_index` (INFO):** Yeni eklenen yabancı anahtar indeksleri henüz kullanılmadığı için çıkar. Silme: silersen "unindexed foreign key" uyarısı geri gelir. Veri büyüdükçe (silme/join) bu indeksler iş görür. Yok say.
- **Elle yapılacak (SQL ile olmaz):** Authentication › Providers › Email › *OTP expiry* ≤ 3600 sn; Authentication › Passwords › *Leaked password protection* (Pro plan ister; ücretsiz planda kapalı kalır).

---

## Auth → Providers → Email Ayarları
| Ayar | Değer | Neden |
|---|---|---|
| Enable email provider | AÇIK | Kayıt/giriş buna bağlı |
| Secure email change | AÇIK | Panel e-posta değişiminde eski+yeni adrese kod akışı buna dayanır |
| Secure password change | KAPALI | Açılırsa 24 saatten eski oturum şifre değiştiremez; Google ile gelip ilk şifre belirleyen üyeler de zorlanır |
| Require current password | KAPALI | Şifre değiştirme formunda "mevcut şifre" alanı yok; açılırsa Google-only üyeler kilitlenir |
| Prevent leaked passwords | KAPALI | Yalnızca Pro planda var |
| Minimum password length | 12 | Site formlarıyla aynı (`SIFRE_KURALLARI`). Kural yalnızca şifre belirlerken/değiştirirken uygulanır; eski şifreyle GİRİŞ engellenmez, üye panelde uyarı görür |
| Password requirements | Lowercase, uppercase letters, digits and symbols (recommended) | Sitedeki `SIFRE_KURALLARI` / `sifreKuraliHatasi()` ile aynı kural; kayıt, şifre sıfırlama ve panel şifre değiştirme formlarında canlı ✓ listesi gösterilir |
| Email OTP expiration | 3600 | Advisor `auth_otp_long_expiry` uyarısı 3600 üstünü işaretler |
| Email OTP length | 8 | Site kod alanları buna uygun, değiştirme |
| Enable magic links and email OTP | AÇIK (varsayılan) | Onay/sıfırlama e-postaları bunu kullanır |

Şifre kuralı değişirse `assets/js/core/supabase-client.js` içindeki `SIFRE_KURALLARI` da güncellenmelidir. Formlarda kural kutusu `<div data-sifre-kural="<input id>">` ile eklenir; stil `auth.css` içindedir.

## Bot Koruması — Cloudflare Turnstile (Giriş / Kayıt / Şifre Sıfırlama)
Giriş, kayıt ve "şifremi unuttum" formları **Cloudflare Turnstile** ile bot/kaba kuvvet saldırılarına karşı korunur. Formda küçük bir Turnstile kutusu görünür ("Doğrulanıyor… → Başarılı!"); **Managed** modda kullanıcıdan tıklama istenmez, yalnızca şüpheli trafikte bir onay kutusu çıkar. (Giriş/kayıt/şifre sıfırlama dışındaki sayfalarda, ör. Notlar'ın parola sınaması, widget görünmez çalışır.)

### Nasıl çalışır? (mimari)

```
Tarayıcı ──(görünmez Turnstile)──► token
Tarayıcı ──signInWithPassword / signUp / resetPasswordForEmail + captchaToken──► Supabase Auth
Supabase Auth ──(Captcha secret ile)──► Cloudflare siteverify ──► kabul / ret
```

- Token'ı doğrulayan **Supabase'in kendisidir**. Secret yalnızca Supabase Dashboard'da durur; sitede, Worker'larda veya GitHub'da **secret yoktur**, ekstra Worker/proxy gerekmez (statik site mimarisi bozulmaz).
- Cloudflare panelindeki *"Siteverify isn't being called"* uyarısı, Supabase'te Captcha **AÇIK + Secret kayıtlıyken** siteden ilk giriş/kayıt/şifre-sıfırlama denemesi yapılana kadar görünür; deneme yapılınca (siteverify'ı Supabase çağırır) kendiliğinden kapanır. Sitede kendi siteverify'ını çağıracak bir Worker/endpoint YOKTUR ve gerekmez: korunan formların hepsi doğrudan Supabase Auth'a gider.
- Token'ı ekleyen tek yer `assets/js/auth/turnstile.js` → `captchaKur()`'dur; `supabase-client.js` bunu ortak istemciye bir kez uygular. Yani `auth-pages.js`, `sistem-durumu.js` gibi çağıran kodlar değişmez ve **ileride eklenecek yeni auth çağrıları da otomatik korunur**. Notlar'ın "giriş parolasını doğrula" adımındaki geçici istemci de `captchaKur()` ile korunur.
- Token tek kullanımlıktır: her istekten sonra widget sıfırlanır, bir sonraki deneme için arka planda yenisi hazırlanır. Giriş/kayıt/şifre sıfırlama sayfaları açılır açılmaz token'ı önceden çözer, yani kullanıcı submit'e bastığında genelde bekleme olmaz.

**Korunanlar:** e-posta+şifre girişi, e-posta ile kayıt, şifre sıfırlama maili, onay mailini yeniden gönderme.
**Captcha gerektirmeyenler (Supabase böyle çalışır):** Google ile giriş/kayıt (OAuth), kod ile hesap onaylama (`verifyOtp`), şifre güncelleme (`updateUser`), 2FA doğrulaması.

### Kurulum (sırayı bozma — kendini kilitlemeden açmak için)

1. **Cloudflare'de widget oluştur:** [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile → Add widget** (ya da Add site). Ad: `abdullah-eymen-asru-site`. **Hostname** olarak sitenin yayınlandığı **her** adresi ekle: `abdullah-eymen-asru.github.io`, `abdullah-eymen-asru.pages.dev` (yedek kopya) ve varsa kendi alan adın. Mod: **Managed**. Oluşturunca **Site Key** (herkese açık) ve **Secret Key** (gizli) verir.
2. **Site Key'i siteye yaz:** `_config.yml` → `turnstile_sitekey: "0x4AAAA..."` (Secret Key'i buraya ASLA yazma). Commit'le, siteyi deploy et (GitHub Pages ve Cloudflare Pages'in ikisi de yeniden build almalı).
3. **Supabase'te aç:** Dashboard → **Authentication → Attack Protection** → **Enable Captcha protection** AÇIK, **Choose Captcha Provider: Turnstile by Cloudflare**, **Captcha secret** alanına Cloudflare'deki **Secret Key**'i yapıştır → **Save changes**.
4. **Test et** (aşağıdaki liste).

> ⚠️ **Sıra önemli:** Supabase'te captcha'yı, Site Key'i içeren site yayına çıkmadan ÖNCE açarsan herkes (sen dahil) "captcha verification process failed" ile reddedilir. Bu yüzden önce 1-2. adımlar (site yayında), sonra 3. adım.
> 🆘 **Acil geri alma:** Giriş yapamaz hale gelirsen Supabase → Attack Protection → **Enable Captcha protection**'ı kapatıp kaydet; site eskisi gibi çalışır.

**Yerel geliştirme / test:** Cloudflare'in resmi test anahtarlarını kullanabilirsin: Site Key `1x00000000000000000000AA` (her zaman geçer), Secret `1x0000000000000000000000000000000AA`. Bunları yalnızca geçici bir test projesinde kullan; gerçek projede güvenlik sağlamazlar.

### Sorun giderme

| Belirti | Sebep | Çözüm |
|---|---|---|
| "captcha verification process failed" / "Güvenlik doğrulaması tamamlanamadı…" | Supabase'te captcha AÇIK ama `_config.yml`'de `turnstile_sitekey` boş/yanlış, ya da Supabase'teki Secret başka widget'a ait | Site Key ve Secret **aynı widget'ın** çifti olmalı; `_config.yml`'i düzelt + deploy et |
| Widget hiç yüklenmiyor, aynı hata | Reklam/içerik engelleyici `challenges.cloudflare.com`'u engelliyor, ya da CSP bu adresi engelliyor | Engelleyiciyi bu site için kapat. CSP'de `script-src https:` ve `frame-src https:` zaten izinli; sıkılaştırdıysan `https://challenges.cloudflare.com`'u iki yönergeye de ekle |
| Konsolda `Blocked a frame with origin "https://challenges.cloudflare.com"…` ve `…/challenge-platform/…/pat/… 401` | Safari'de Turnstile'ın kendi iç iletişimi / Private Access Token denemesi | **Zararsızdır**, giriş/kayıt'ı etkilemez; yok sayabilirsin |
| Konsolda `Refused to connect to data:`, `NaN`, `Object` | Cloudflare'in kendi iframe'inden gelir | Zararsızdır; site kodundan kaldırılamaz (bkz. "Turnstile — Tema, Mobil ve Konsol Mesajları") |
| Cloudflare hata kodu `110200` (domain not allowed) | Siteyi açtığın adres widget'ın Hostname listesinde yok | Cloudflare → Turnstile → widget → Hostname Management'a o adresi ekle |
| Bazı ziyaretçilerde kutu çıkıyor | Normaldir: Cloudflare o ziyaretçiyi şüpheli buldu | Bir işlem gerekmez, kutuyu onaylaması yeterli |
| Admin "e-posta değiştir"den sonra bildirim maili gitmedi (`bildirim_maili_gonderildi: false`) | Edge Function'daki `resetPasswordForEmail` (sunucu tarafı) de captcha ister; token olmadığı için reddedilebilir | E-posta değişikliği yine tamamlanır (kod bu hatayı zaten yakalar). Bildirim maili gerekliyse kullanıcıya "Şifremi unuttum"dan kendisi gönderebilir; bu çağrıyı kendi test ettiğinde sonucu kontrol et |

### Dosyalar

- `assets/js/auth/turnstile.js` — widget yükleme (tembel), token alma/sıfırlama, `captchaKur()` sarmalayıcı, Türkçe hata metni.
- `assets/js/core/supabase-client.js` — ortak istemciye `captchaKur(supabase)` uygular (demo modunda uygulanmaz).
- `_layouts/default.html` — `<meta name="turnstile-sitekey">` (değer `_config.yml`'den gelir).
- `hesap/giris.md`, `hesap/kayit.md`, `hesap/sifremi-unuttum.md` — sayfada `#turnstile-kutu` (görünmez widget'ın yeri) ve `#turnstile-durum`.

---

## Kullanıcı Davet Etme
Panel → **Üye Ayarları → ✉ Kullanıcı Davet Et**. Yönetici/Site Sahibi bir e-posta girer; Supabase davet maili gönderir. Kişi linke tıklar →
`/hesap/sifre-guncelle.html` (başlık "Hesabını oluştur") → şifresini belirler → giriş yapınca KVKK/açık rıza modalı çıkar. Hesap, formda seçilen rolle açılır (varsayılan Üye).
**Kayıtlar kapalıyken de çalışır** (davet tablosu sayesinde; istemci verisine güvenilmez).

**Kurulum (bir kez):**
1. SQL Editor'de sırayla `supabase/migrations/` altındaki `0152_kullanici_davetleri.sql`, `0153_davet_ayarlari_ve_arama.sql`, `0154_davet_rol_secimi.sql` ve `0155_davet_demo_rolu.sql` dosyalarını çalıştır.
2. Edge Function'ı deploy et: `supabase functions deploy admin-invite-user` (Dashboard → Edge Functions → *Deploy a new function* ile `index.ts` içeriğini yapıştırarak da olur; ad birebir `admin-invite-user` olmalı).
3. **Fonksiyonun adresini ayrıca bir yere eklemen GEREKMEZ.** Adres Supabase'in standart kalıbıdır:
   `https://<PROJE-REF>.supabase.co/functions/v1/admin-invite-user`. Bu adres `assets/js/uye-ayarlari.js` içindeki `ADMIN_INVITE_FUNCTION_URL` sabitinde zaten yazılı
   (diğer fonksiyonlarla aynı proje ref'i: `eahvcirspmvntffzphye`). Proje ref'in değişirse yalnızca o sabitleri güncelle.
   `config.toml`'a satır eklemek de gerekmez: fonksiyon varsayılan olarak "JWT doğrula" modunda çalışır (giriş yapmış oturum şart), ayrıca içeride rol (admin/owner) denetlenir.
4. CORS: fonksiyon yalnızca `ALLOWED_ORIGINS` listesindeki adreslerden çağrılır (`index.ts` başı). Sitenin adresi değişirse/yeni alan adı eklenirse oraya da ekle ve yeniden deploy et.
5. Authentication → URL Configuration → Redirect URLs'te `/hesap/sifre-guncelle.html` (kullandığın her alan adı için) olmalı (şifre sıfırlama zaten kullanıyor).
6. Authentication → Emails → **Invite user** şablonunu istersen Türkçeleştir. Varsayılan Supabase SMTP'si saatlik çok düşük mail sınırına sahiptir; çok sayıda davet için özel SMTP (Resend vb.) bağla. "Sınırsız" ayarı senin tarafındaki sınırı kaldırır; Supabase'in kendi mail/oran sınırları geçerli kalır.

**Paneldeki kullanım:** Üye Ayarları → Kullanıcı Davet Et. Alttaki **Davetler** listesi kaydırmalıdır ve e-posta ya da isimle aranır (kabul edildi / bekliyor / süresi doldu rozetleriyle).

**Davet ayarları (yalnızca Site Sahibi görür ve değiştirir; yönetici yalnızca durum özetini görür):**
- **Davet gönderme açık** kaydırmalı düğmesi: kapatınca hiçbir yönetici davet gönderemez (kayıtları kapatmaya benzer; kayıt kapatmadan bağımsızdır).
- **Gelişmiş sınırlar:** başlangıç/bitiş tarihi (belirli tarihler arası), ya da "şimdiden itibaren N gün/hafta/ay" ile bitişi hesaplama; toplam davet sınırı; yönetici başına günlük sınır. **Boş bırakılan her alan = sınırsız** (varsayılan). Güvenlik için sınırsız günlük ayarda bile mutlak tavan: yönetici başına 24 saatte 500 davet.
- Sınırlar sunucuda (Edge Function) ve veritabanında uygulanır; tarayıcıdan atlatılamaz.

**Diğer sınırlar:** zaten hesabı olan e-postaya davet gitmez ("Şifremi unuttum" kullanır); davet edilen kişi linke hiç tıklamadıysa aynı e-postaya yeniden davet için önce Üye listesinden o bekleyen hesabı sil. **Davet rolü:** Üye, Özel Üye, Editör, İçerik Sorumlusu, Demo seçilebilir; **Yönetici yalnızca Site Sahibi tarafından** verilebilir; Site Sahibi rolü davetle hiç verilmez. Bu kural arayüzde, Edge Function'da ve veritabanında ayrı ayrı uygulanır.

## Turnstile — Tema, Mobil ve Konsol Mesajları

- **Tema:** widget site temasını (açık/koyu) izler. Doğrulama bittikten sonra tema değişirse yeniden doğrulama istenmez; geçerli token korunur.
- **Mobil/zayıf ağ:** `api.js` sayfa açılırken önceden indirilir; hata olursa 2 kez otomatik yeniden denenir, olmazsa hata koduyla "Yeniden dene" düğmesi çıkar. Kod `110200` = alan adı widget'ta yetkili değil; `600010`/`3000xx` = cihaz, ağ veya engelleyici sorunu.
- **Konsol mesajları:** `NaN`, `{}`, `Object`, `console.trace`, `Refused to connect to data:`, `Blocked a frame…`, `/pat/` 401, preload, Permissions-Policy, çerez uyarıları gibi mesajlar `challenges.cloudflare.com` iframe'inin içinden gelir (Cloudflare'in kendi kodu ve kendi CSP'si). Site kodundan kaldırılamaz ve doğrulamayı bozmaz. `cloud.umami.is` hatası, tarayıcının analitik betiğini engellemesidir.
- **Kod 600010 (Mullvad/Tor/Firefox "parmak izi koruması"):** tarayıcı canvas/WebGL okumasını ve üçüncü taraf çerezini engellediği için Cloudflare'in kontrolü tamamlanamaz. Çözüm: siteyi korumadan muaf tut, başka tarayıcı dene ya da **Google ile giriş** yap (captcha gerektirmez).
- **pages.dev ile github.io farklı görünüyorsa:** biri eski sürümde kalmıştır; ikisine de aynı dosyaları deploy et ve Turnstile widget Hostname listesinde ikisini de tut.

## İzlediklerim/Okuduklarım — "Something went wrong" (GraphQL)
Worker, tek issue'nun proje öğesini hafif sorguyla bulur ve geçici GitHub hatalarında 3 kez yeniden dener.
Worker kodunu (`cloudflare worker/izleme_okuma_yonetim_worker/worker.js`) değiştirirsen Cloudflare'e yeniden deploy et (`wrangler deploy` veya paneldeki Quick edit).

## Güvenlik Özeti — Neden Güvenli?

- **RLS her yerde açık.** `profiles`, `special_content`, `content_access`,
  `site_settings` ve iki storage bucket'ının hepsinde satır bazlı politika
  var; hiçbir tabloda "RLS kapalı, sadece frontend kontrolü var" durumu yok.
- **Rol yükseltme engellenmiş.** Kullanıcı kendi `role` kolonunu ne RLS'in
  `WITH CHECK`'i ne de ekstra bir `BEFORE UPDATE` trigger'ı üzerinden
  değiştiremez; sadece `admin_set_user_role()` RPC'si (admin kontrolü
  içeren) rol değiştirebilir.
- **Signed URL'ler kısa ömürlü ve yetki kontrollüdür.** `createSignedUrl`
  çağrısının kendisi, çağıran kullanıcının o dosya üzerinde SELECT RLS
  yetkisi var mı diye kontrol eder — yetkisi yoksa link üretilmez; üretilse
  bile 10 saniye sonra geçersizleşir. (İstisna: yukarıda anlatılan,
  opsiyonel Cloudflare R2 "harici link" özelliği — bunun kendi güvenlik
  ödünleşimi ayrı başlıkta anlatıldı.)
- **`service_role` anahtarı hiçbir yerde frontend'de yok.** Sadece
  hesap-silme Edge Function'ının sunucu tarafında, Supabase'in kendi
  ortam değişkeni olarak durur.
- **Girdi enjeksiyonuna karşı önlem.** Gizli makale metni önce
  `escapeHtml` ile kaçırılır, sonra çok basit bir markdown dönüştürücüden
  geçer — kullanıcı/admin girdisine ham `<script>` yazılsa bile çalışmaz.
- **SECURITY DEFINER fonksiyonlarında en az yetki ilkesi.**
  `0002_guvenlik_sikilastirma.sql` ile her fonksiyon SADECE gerçekten
  ihtiyacı olan role'e (anon/authenticated) açık, PUBLIC'e değil; trigger
  fonksiyonlarında (`handle_new_user`, `prevent_role_self_escalation`,
  `set_updated_at`) hiçbir role'e EXECUTE izni verilmiyor çünkü trigger'lar
  buna ihtiyaç duymuyor.
- **Avatar bucket'ı listelemeye kapalı.** `avatarlar` bucket'ı public
  (herkese görünür profil fotoğrafları) olsa da, bucket içeriğini TOPLU
  listeleyip tüm kullanıcı ID'lerini görme izni kaldırıldı.

---

## Kapsam Dışı Bıraktığım Bir Nokta (dürüstçe belirtmek isterim)

Sitenin **herkese açık** blog yazıların (`_posts/*.md`) ve akademik proje
sayfaların hâlâ Git deposundaki Markdown dosyaları — bunları tarayıcıdan
doğrudan düzenleyebilmek (dosyayı repoya commit'leyip Jekyll'in yeniden
build etmesini tetiklemek) Supabase'in değil, **GitHub API + OAuth**
("headless CMS") işidir; örneğin [Decap CMS](https://decapcms.org) (eski
adıyla Netlify CMS) tam bu iş için var ve mevcut Jekyll yapını bozmadan
`/admin`'e benzer bir arayüz ekleyebilir. İstersen bunu ayrı bir adım
olarak da kurabiliriz — ama bu, Supabase'ten bağımsız, tamamen farklı bir
entegrasyon olduğu için bu bölümün kapsamı dışında tuttum, karıştırmak
istemedim.

---

## Yetki Hiyerarşisi ve Önemli Kurallar

**Hiyerarşi:** Site Sahibi > Yönetici > İçerik Sorumlusu > Editör > Özel Üye > Üye. Ayrıca salt-okunur **Demo** rolü vardır. Özel içerik ve R2 dosyaları **Üye hariç herkese** açıktır.

**Rol yönetimi**
- Rolü yalnızca `admin_set_user_role()` değiştirir. Yönetici, başkasını Yönetici yapamaz ve başka bir yöneticinin rolünü doğrudan değiştiremez (bunun yolu Admin Güvenliği sayfasındaki askıya alma/oylama akışıdır).
- Site Sahibi hesabı hiçbir yönetici tarafından değiştirilemez veya silinemez; silme yetkisi yalnızca Site Sahibi'ndedir. Site Sahibi başka birini Site Sahibi yapabilir ve kendi yetkisini düşürebilir (uyarı penceresiyle).
- Demo rolünü Üye Ayarları'ndan yalnızca Site Sahibi atar; yönetici demo üyeyi normal role çıkarabilir. Davet ederken demo rolünü yönetici de verebilir.

**Başkası adına yayın**
- Editör ve İçerik Sorumlusu, bir yönetici ya da Site Sahibi adına içerik gönderebilir.
- Yönetici adına gönderilen içeriği yalnızca o yönetici veya Site Sahibi onaylar/reddeder.
- Site Sahibi adına gönderilen içeriği Site Sahibi tek başına ya da yöneticilerin mutlak çoğunluğu onaylar.

**Üyelik kayıtlarını kapatma (yalnızca Site Sahibi)**
- `site_settings.kayitlar_acik` kapalıyken `handle_new_user` yeni hesap oluşturulmasını veritabanı seviyesinde engeller (e-posta ve Google dahil). Mevcut üyeler girmeye devam eder; kayıt sayfası uyarı ekranı gösterir. Geçerli davetle gelenler kapalıyken de hesap açabilir.

**Gizli içerik ve Supabase'te depolama**
- Blog/proje formunda "Yayında" kapalıysa içerik GitHub'a commit edilmez; yalnızca Supabase'teki `taslak_icerikler` tablosunda durur (RLS ile yalnızca yöneticiler; ön izleme `/onizleme/` sayfasında, tam eşleşen kodla). "Yayınla" içeriği GitHub'a taşır, "Yayından Kaldır" geri alır (ayrıntı: `01-site-rehberi.md`, Bölüm 10).
- **"GitHub yerine Supabase'te depola"** anahtarı açıksa içerik hiç commit edilmeden sitede (`icerik/supabase-yazi.html`) görünür. Arama motoru için `supabase/functions/sitemap-supabase` ve `feed-supabase` fonksiyonları kullanılır: migration `0055`'i çalıştır, iki fonksiyonu `supabase functions deploy` ile yayınla, `robots.txt`'teki ikinci sitemap adresini Search Console'a gönder. Sayfa tarayıcıda oluşturulduğu için statik sayfa kadar hızlı indekslenmeyebilir.

**Reklam (AdSense) — varsayılan kapalı**
- `_config.yml` → `adsense_client_id` boşsa reklam sistemi (çerez kategorisi dahil) tamamen devre dışıdır. `adsense_slot_icerik_alt` doluysa yazı sonuna manuel blok eklenir; boşsa yalnızca Otomatik Reklamlar çalışır.
- Reklam, ziyaretçi çerez panelinde **Reklam** kategorisini onaylamadan yüklenmez. `/panel/`, `/hesap/`, `/onizleme/` sayfalarında hiç yüklenmez.
- Yazı bazında kapatmak için panelde "Reklam" anahtarını kapat (front-matter `reklam: false`). Bu tercihin taslaklarda da korunması için migration `0033`'ü çalıştırmış ol.
