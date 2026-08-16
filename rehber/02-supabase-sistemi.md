[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · **🔐 Supabase Sistemi** · [🍴 Fork Kurulumu](./03-fork-kurulumu.md)

---

# 🔐 Supabase Kullanıcı Sistemi — Kurulum, Güvenlik ve Sorun Giderme

Bu bölüm, siteye eklenen **Supabase (PostgreSQL + Auth + Storage)** tabanlı
kullanıcı kayıt/giriş, rol yönetimi ve gizli içerik sistemini anlatıyor.
Eskiden ayrı bir `KURULUM-REHBERI-supabase.md` dosyasındaydı, artık
karışıklık olmasın diye buraya taşındı — tek doğruluk kaynağı burası.

Sistem şunları sağlıyor:

- Google OAuth + E-posta/Şifre ile kayıt-giriş, e-posta doğrulama, şifre sıfırlama
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
  js/auth-pages.js                         <- Giriş/Kayıt/Şifre/Hesap Onayla sayfaları mantığı
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

`https:` joker değeri tüm HTTPS kaynaklarına (Supabase API'si, `esm.sh`
üzerinden yüklenen Supabase JS SDK dahil) izin verdiği için **hiçbir
değişiklik yapmana gerek yok**.

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
- [ ] Kayıt formunda KVKK onay kutusunu işaretlemeden kayıt olmaya çalış —
      engellenmeli. İşaretleyip kayıt ol, `/panel/panel.html` → "KVKK Onayı"
      bölümünde onay tarihinin göründüğünü doğrula.
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

## 📝 Değişiklik Geçmişi (Changelog)

Bu bölüm, siteye/Supabase kullanıcı sistemine sonradan yapılan düzeltmelerin tarih sırasıyla özetidir — hangi sorun bildirildi, kök nedeni neydi, nasıl çözüldü ve (varsa) senin elle yapman gereken adım neydi. Eskiden kökte ayrı `DEGISIKLIKLER_*.md` dosyaları halinde duruyordu, artık tek doğruluk kaynağı burası — en yeni turu en üstte bulursun.

### 🗓️ 15.08.2026 — "Yayında değil" içerik artık GitHub'a değil, Supabase'e gidiyor

İstediğin değişiklik: blog/akademik proje taslakları "Yayında" kapalıyken
artık GitHub'a HİÇ commit edilmiyor, sadece Supabase'de duruyor (özel
linki bilen görebilir); "Yayınla" deyince Supabase'den GitHub'a taşınıp
Supabase'den siliniyor; "Yayından Kaldır" deyince tam tersi oluyor.

#### Değişen dosyalar
- `assets/js/github-yonetim/github-yonetim.js` (kaydetme/yayınlama/yayından kaldırma/silme/düzenleme akışlarının tamamı Supabase'i de kapsayacak şekilde yeniden yazıldı)
- `panel/github-yonetim.md` (dosya kendisi değişmedi, önceki turdaki "📁 Klasörler" sekmesiyle uyumlu çalışacak şekilde JS'teki değişiklikler test edildi)
- `rehber/01-site-rehberi.md` (Bölüm 9'a güncelleme notu, Bölüm 10'a "Supabase Taslak Sistemi" alt başlığı eklendi)

#### Eklenen dosyalar
- `supabase/migrations/0013_taslak_icerikler_supabase_taslak_sistemi.sql` ⚠️ **YENİ — Supabase SQL Editor'de çalıştırman gerekiyor.**
- `onizleme/index.md` — yeni Jekyll sayfası, `/onizleme/` adresinde (gizli ön izleme linklerinin gerçekte açıldığı yer)
- `assets/js/github-yonetim/onizleme.js` — `/onizleme/` sayfasının mantığı, Supabase'teki `taslak_onizleme_getir` RPC'sini çağırır

#### Ne değişti, neden

**Eski davranış:** "Yayında" kapatıldığında panel yine `_posts/`/`_projects/`
altına bir dosya commit ediyordu — `yayinda: false` + tahmin edilemez bir
`permalink` ile. Dosya GitHub deposunun (public bir repo) git geçmişinde
gerçekten duruyordu; "gizli" olması tamamen adresin paylaşılmamasına
dayanıyordu. İstediğin değişiklik tam olarak bunu ortadan kaldırmak.

**Yeni davranış:** `taslak_icerikler` adında yeni bir Supabase tablosu
(migration 0013) eklendi. RLS ile SADECE admin rolündeki hesaplar
okuyup/yazabiliyor. Anonim bir ziyaretçinin (ön izleme linkine sahip
olsa bile) tabloyu LİSTELEYEMEMESİ için ayrı bir `taslak_onizleme_getir(p_tur,
p_kod)` RPC'si eklendi — bu fonksiyon `SECURITY DEFINER` olduğu için
RLS'i by-pass eder ama SADECE tur+kod tam eşleşen TEK satırı, SADECE
görüntüleme için gereken alanlarla döndürür.

Yeni ön izleme linki formatı: `/onizleme/?tur=blog&kod=XXXXXXXX` (eskisi:
`/blog/on-izleme-XXXXXXXX/`). Daha önce paylaşılmış eski formatlı linkler
artık çalışmaz — ama bu linkler zaten sadece `deneme3.md` ve
`ornek-zamanlanmis-yazi.md` gibi depoda duran örnek/test dosyalarındaydı,
gerçek bir taslağın linki değildi. `assets/js/github-yonetim/github-yonetim.js`, eski
sistemden kalma (hâlâ `yayinda: false` ile GitHub'da duran) bir dosya
bulursa kartında "Supabase'e Taşı" butonu gösterir — bu butona basmak o
dosyayı da yeni sisteme (Supabase'e) taşır.

##### Yapman gereken
1. **Supabase Dashboard → SQL Editor**'e git, `supabase/migrations/0013_taslak_icerikler_supabase_taslak_sistemi.sql` dosyasının TAMAMINI yapıştırıp **Run**'a bas.
2. Geri kalan tüm dosyalar (JS/MD) statik olduğu için, siteyi her zamanki gibi yayınlaman (GitHub Pages / Cloudflare Pages push) yeterli — ekstra bir adım gerekmiyor.
3. İstersen `_posts/2026/2026-08-14-deneme3.md` ve `_posts/2026/2026-08-15-ornek-zamanlanmis-yazi.md` gibi eski sistemden kalma örnek/test dosyalarını `/panel/github-yonetim.html` → "Mevcut İçerikler" listesinden "Supabase'e Taşı" ile yeni sisteme taşıyabilir ya da elle silebilirsin — dokunmazsan da bozulan bir şey olmaz, sadece eski yöntemle "gizli" kalmaya devam ederler.

### 🗓️ 12.08.2026 (2 sorun)

Bu dosya, bildirdiğin 2 sorun için yapılan değişikliklerin özetidir.

#### Değişen dosyalar
- `assets/css/auth.css`
- `panel/admin.md`
- `panel/github-yonetim.md` (aynı hatayı taşıdığı için, istemesen de düzelttim — aşağıda 1. maddede açıklandı)
- `supabase/migrations/0004_mesajlasma_ve_temizlik.sql`

Yeni migration YOK — bu turda veritabanı şeması değişmedi, sadece mevcut
`0004` dosyasının kendisi düzeltildi (aşağıya bkz).

---

#### 1) "Panelim" / "Admin Paneli" karışık/iç içe geçmiş görünüyordu

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

#### 2) Migration hatası: `column "conversation_user_id" does not exist`

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

##### Yapman gereken
Sadece `assets/css/auth.css`, `panel/admin.md` ve `panel/github-yonetim.md`
dosyalarını yayınlaman (GitHub Pages / Cloudflare Pages push) yeterli —
CSS/HTML olduğu için ekstra bir adım gerekmiyor. `0004` SQL dosyasını
tekrar çalıştırmana GEREK YOK (veritabanın zaten güncel); dosya sadece
ileride biri bu dosyayı yeniden çalıştırırsa artık hata vermesin diye
düzeltildi.

### 🗓️ 11.08.2026 — 2. Tur (6 sorun)

Bu dosya, ikinci turda bildirdiğin 6 sorun için yapılan değişikliklerin özetidir.

#### En son değişen dosyalar (bu turda)
- `_layouts/default.html`
- `assets/css/auth.css`
- `assets/js/admin.js`
- `assets/js/auth/auth-guard.js`
- `assets/js/auth/auth-pages.js`
- `assets/js/github-yonetim/github-yonetim.js`
- `assets/js/auth/nav-auth.js`
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

#### Bu turda eklenen yeni dosyalar
- `supabase/migrations/0008_email_isim_senkron_ve_kvkk_temizlik.sql` (bir önceki turdan — henüz çalıştırmadıysan mutlaka çalıştır)
- `supabase/migrations/0009_admin_zorla_cikis_ve_bildirim.sql` ⚠️ **YENİ — Supabase SQL Editor'de çalıştırman gerekiyor.**

---

#### 1) Çıkış butonu → sadece `panel.html#` ekliyor, çıkış olmuyor
**Kök neden:** `panel.js`, `admin.js` ve `github-yonetim.js`'in `init()` fonksiyonları TEK bir sıralı `await` zinciriydi. Zincirdeki herhangi bir adım (ör. mesajlaşma widget'ı kurulumu) beklenmedik bir hata fırlatırsa, **o adımdan SONRAKİ her şey hiç çalışmıyordu.** `wireLogout()` en sonda çağrıldığı için çıkışa hiç bağlanmıyordu — buton görünüyordu ama tıklanınca sadece `href="#"`'in native tarayıcı davranışı (adres çubuğuna `#` eklenmesi) gerçekleşiyordu.
**Çözüm:** Üç dosyada da `init()`'i yeniden yapılandırdım — her bölüm artık kendi try/catch'i içinde, birbirinden bağımsız kuruluyor. `panel.js`'te ayrıca `wireLogout()`'u en başa aldım (kritik olduğu için en garantili yer).

#### 2) Panellerde "Yükleniyor..." takılı kalması
Aynı kök neden (yukarıdaki 1. madde) — bir bölüm patlayınca ondan sonraki TÜM bölümler (KVKK, Özel İçerikler, Mesajlar) sonsuza dek "Yükleniyor..." durumunda kalıyordu. Aynı düzeltmeyle çözüldü; artık bir bölüm hata verse bile diğerleri normal yükleniyor, hatalı bölüm konsola (F12 → Console) hangi bölüm olduğunu yazıyor.

#### 3) Sayfa kaymaları / iç içe geçme / mesajlaşma modern görünmüyor / buton bazı tarayıcılarda görünmüyor
**Kök neden (hepsinin ortak kaynağı):** `auth.css`, sayfaların Markdown **gövdesi içinde** (`</head>`'den SONRA, `<body>` içinde) `<link>` ile yükleniyordu — bu geçersiz HTML'dir ve bazı tarayıcılarda (ve tarayıcı uzantılarında) `<body>` içindeki `<link>` etiketleri ya hiç yüklenmiyor ya da farklı/geç önceklilikle yükleniyordu. Bu da tarayıcıya göre değişen görünüm sorunlarının (buton yazısı kayboluyor, mesajlaşma modern görünmüyor) asıl sebebiydi.
**Çözüm:** `auth.css`'i `_layouts/default.html`'in gerçek `<head>`'ine taşıdım; hangi sayfanın bunu yükleyeceğini front-matter'daki `auth_css: true` bayrağıyla kontrol ediyoruz (9 sayfa güncellendi: giriş, kayıt, şifre sayfaları, panel, admin, vb.).
**Ek düzeltme (sayfa kaymaları):** `.panel-section--wide` (mesajlaşma bölümünü genişleten) kuralı `100vw` tabanlı bir ortalama tekniği kullanıyordu — bu, dikey kaydırma çubuğunun kapladığı alan yüzünden yatay taşmaya ve "kayma" hissine yol açıyordu. `body { overflow-x: hidden }` eklendi ve teknik, viewport yerine ebeveyne göre hesaplayan daha güvenli bir versiyona çevrildi. `.panel-grid`'e eksik olan `grid-template-columns` ve taşma önleyici `min-width:0` kuralları da eklendi.

#### 4) Ad-Soyad "rol kısmında" görünmüyor / kullanıcı güncellese de sistemde değişmiyor
- Panelim'deki üst satıra (`e-posta · Rol: ... · Çıkış Yap`) Ad-Soyad eklendi — artık `Ad Soyad · e-posta · Rol: ... · Çıkış Yap` şeklinde görünüyor.
- Kaydet butonuna basınca bu üst satır artık **sayfa yenilenmeden anında** güncelleniyor (önceden sadece ilk açılışta dolduruluyordu, bu da "değişmiyor" izlenimi veriyordu — oysa veritabanı doğru güncelleniyordu, sadece ekran yansıtmıyordu).
- Kaydetme isteğine `.select().single()` eklendi: RLS bir sebeple satırı döndürmezse artık "kaydedildi" diye YANLIŞLIKLA bildirim gösterilmiyor, gerçek bir hata mesajı çıkıyor.
- **Admin panelindeki kullanıcı tablosuna gerçek zamanlı (Supabase Realtime) güncelleme eklendi** — bir kullanıcı kendi panelinden ismini değiştirdiğinde, admin paneli açıksa 600ms içinde otomatik tazeleniyor (F5 gerekmiyor).

#### 5) Admin e-posta değiştirince eski oturumlardan çıkış yapılmıyor / bildirim gitmiyor
Supabase'in "şu kullanıcıyı ID ile tüm cihazlardan çıkışa zorla" diye hazır bir admin fonksiyonu yok (`auth.admin.signOut()` kullanıcının kendi JWT'sini ister, admin'de bu yok). Yeni migration'da (`0009`) `admin_force_signout_user()` adında bir veritabanı fonksiyonu ekledim — bu, service_role yetkisiyle kullanıcının `auth.refresh_tokens` ve `auth.sessions` kayıtlarını iptal ediyor (mevcut access token en geç 1 saat içinde, refresh token'lar ise anında geçersiz olur). `admin-change-email` fonksiyonu artık e-postayı değiştirdikten hemen sonra bunu otomatik çağırıyor.

Bildirim maili için: ekstra bir SMTP kurulumu istemediğin için, Supabase'in kendi dahili mail sistemini (`resetPasswordForEmail`) kullanıyoruz — bu, "Reset Password" e-posta şablonu üzerinden **gerçekten** postalanıyor (Dashboard'dan şablon metnini "e-postan güncellendi" şeklinde özelleştirebilirsin). *(Not: İlk denemede `generateLink()` kullanmıştım ama bu fonksiyonun mail GÖNDERMEDİĞİNİ, sadece bir link ÜRETTİĞİNİ fark edip düzelttim — bu ayrıntıyı burada belirtiyorum çünkü şeffaf olmak istiyorum.)*

#### 6) Ek olarak bulduğum/düzelttiğim hatalar
- **Hesap silme sonrası yanlış hata mesajı:** Hem `panel.js` hem `admin.js`'te, hesap Edge Function tarafından başarıyla silindikten SONRA çağrılan `supabase.auth.signOut()` hata verirse, kod bunu "Hesap silinemedi" diye YANLIŞ gösteriyordu — oysa hesap gerçekten silinmişti. Ayrı try/catch'e alındı.
- **`nav-auth.js`'de memory leak:** Üstteki "Hesabım ▾" menüsü her açılıp kapandığında (ya da başka bir sekmede giriş/çıkış yapıldığında) `document`'a "dışarı tıklayınca kapat" ve "Escape ile kapat" için YENİ event listener'lar ekleniyordu, eskiler hiç temizlenmiyordu. Artık menü DOM'dan kalktığında bu dinleyiciler kendini temizliyor.
- **`ozel-icerik.js` ve `github-yonetim.js`:** Aynı "bir hata her şeyi durdurur" riskine karşı dayanıklı hale getirildi (bkz. madde 1-2).

---

#### Uygulama adımları (senin yapman gerekenler)
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

### 🗓️ 11.08.2026 — 1. Tur (5 sorun)

Bu dosya, bildirdiğin 5 sorun için yapılan değişikliklerin özetidir. Değişen/eklenen dosyalar:

#### Değişen dosyalar
- `assets/css/auth.css`
- `assets/js/admin.js`
- `assets/js/auth/auth-guard.js`
- `assets/js/auth/auth-pages.js`
- `assets/js/auth/nav-auth.js`
- `assets/js/panel.js`
- `hesap/kayit.md`
- `panel/panel.md`
- `supabase/functions/admin-change-email/index.ts`

#### Eklenen dosya
- `supabase/migrations/0008_email_isim_senkron_ve_kvkk_temizlik.sql` ⚠️ **Bunu Supabase Dashboard > SQL Editor'de çalıştırman gerekiyor.**

---

#### 1) Panelim ekranındaki "Çıkış Yap" çalışmıyordu
**Neden:** `supabase.auth.signOut()` bazı durumlarda (oturum zaten geçersiz/süresi dolmuş) hata fırlatıyordu; kodda try/catch olmadığı için hata sessizce oluşuyor ve yönlendirme (`window.location.href`) hiç çalışmıyordu.
**Çözüm:** `panel.js` ve `nav-auth.js`'deki çıkış fonksiyonlarına try/catch/finally eklendi — hata olsa bile kullanıcı artık anasayfaya yönlendiriliyor.

#### 2) "Yöneticiyle Mesajlaş" butonunun yazısı görünmüyordu
**Neden:** CSS özgüllük çakışması. `assets/style.css`'teki `a:visited { color: var(--accent) }` kuralı, `.btn-primary { color:#fff }` kuralından daha yüksek özgüllüğe sahipti (pseudo-class bir class'a eşdeğerdir). Link "ziyaret edilmiş" sayılınca metin rengi tekrar mavi (`--accent`) oluyor, mavi arka plan üstünde mavi yazı görünmez hale geliyordu.
**Çözüm:** `auth.css`'te `.btn-primary:visited` ve `.btn-secondary:visited` kuralları eklendi.

#### 3) Admin ile e-posta değiştirilince eski mail her yerde kalıyordu
**Neden:** `auth.users` tablosu için sadece **yeni kayıt (INSERT)** trigger'ı vardı; e-posta **güncellenince (UPDATE)** `public.profiles.email` kolonunu senkron eden hiçbir mekanizma yoktu. Admin panel, Supabase Table Editor ve kullanıcı paneli hepsi `profiles` tablosundan okuduğu için hepsi eski adresi göstermeye devam ediyordu. Ayrıca `admin-change-email` fonksiyonunun kodu ile yorumu çelişiyordu: yorumda "anında değişir" yazıyordu ama kod `email_confirm` parametresini göndermiyordu.
**Çözüm:**
- Yeni migration'da `on_auth_user_updated` trigger'ı eklendi — `auth.users.email` her değiştiğinde `profiles.email` otomatik senkronize olur.
- `admin-change-email` fonksiyonuna `email_confirm: true` eklendi (gerçekten anında, mail beklemeden değişir) ve ekstra güvence olarak `profiles.email`'i de doğrudan günceller.

#### 4) Ad-Soyad her yerde otomatik güncellenmiyordu / tek alan
**Neden:** `full_name` tek parça bir metin alanıydı, ayrı Ad/Soyad yoktu.
**Çözüm:**
- Migration'da `first_name` ve `last_name` ayrı sütunlar olarak eklendi. `full_name` artık bu ikisinden **otomatik türeyen** (generated) bir alan — elle yazılamaz, her zaman güncel.
- Kayıt formu (`hesap/kayit.md`) ve Panelim profil formu (`panel/panel.md`) artık Ad ve Soyad'ı ayrı input olarak alıyor.
- Admin panelindeki kullanıcı tablosuna da Ad/Soyad için ayrı, doğrudan düzenlenebilir iki kutu eklendi (`admin.js`) — admin panelden değiştirsin ya da kullanıcı kendi panelinden değiştirsin, her ikisi de aynı `first_name`/`last_name` kolonlarını günceller, dolayısıyla her yerde anında tutarlıdır.
- `on_auth_user_updated` trigger'ı, Google hesabı ismi değişirse ve kullanıcı panelden hiç kendi ismini girmemişse bunu da senkronize eder (kullanıcı kendi ismini bir kez girdiyse üzerine yazılmaz).

#### 5) Google ile girişte KVKK onayı olmadan hesap oluşuyordu
**Neden:** "Google ile Giriş Yap" akışında KVKK kontrolü OAuth **başladıktan sonra** yapılıyordu (Google'ın kendi ekranında KVKK sorulamadığı için). Kontrol `kvkk_onay_verildi = false` bulursa kod sadece `signOut()` yapıyordu — hesabı (auth.users + profiles) hiç **silmiyordu**. Bu yüzden reddedilen/tamamlanmamış girişler veritabanında kalıcı olarak "user" rolüyle kalıyordu (ekran görüntülerindeki iki hesap gibi).
**Çözüm:**
- `auth-pages.js`'e `kvkkOnaysizHesabiSilVeCikis()` fonksiyonu eklendi — artık KVKK onayı olmayan bir girişte hesap, mevcut `delete-account` Edge Function'ı üzerinden **gerçekten siliniyor**, sadece çıkış yapılmıyor.
- Migration'da, **bugüne kadar** bu şekilde birikmiş, KVKK onayı olmayan ve 1 saatten eski hesaplar (admin rolündekiler hariç) tek seferlik temizlendi.

---

#### Uygulama adımları (senin yapman gerekenler)
1. **Supabase Dashboard > SQL Editor**'e git, `supabase/migrations/0008_email_isim_senkron_ve_kvkk_temizlik.sql` dosyasının tamamını yapıştırıp **Run**'a bas.
2. `supabase/functions/admin-change-email/index.ts` dosyasını yeniden deploy et:
   ```
   supabase functions deploy admin-change-email
   ```
3. Geri kalan tüm dosyalar (CSS/JS/HTML) statik olduğu için, siteyi her zamanki gibi yayınlaman (GitHub Pages / Cloudflare Pages push) yeterli — ekstra bir adım gerekmiyor.

**Not:** Migration çalıştığında konsolda `NOTICE: KVKK onayı verilmemiş N adet yetim hesap silindi.` gibi bir mesaj göreceksin — bu, ekran görüntülerindeki KVKK onayı olmayan hesapların temizlendiğini doğrular.

---

[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · **🔐 Supabase Sistemi** · [🍴 Fork Kurulumu](./03-fork-kurulumu.md)

---

