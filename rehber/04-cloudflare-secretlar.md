[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · [🍴 Fork Kurulumu](./03-fork-kurulumu.md) · **☁️ Cloudflare Secret & Ayarlar**

---

# ☁️ Cloudflare Rehberi — Worker Secret'ları, Binding'ler ve Pages Ayarları

Bu rehber tek bir soruya cevap verir: **"Cloudflare'de hangi Worker'a hangi
değişkeni, hangi değerle girmem gerekiyor ve o değeri nereden bulacağım?"**

Her Worker için ayrı bir bölüm var. İstediğin Worker'ın bölümüne atlayıp
tabloyu yukarıdan aşağıya doldurman yeterli. Kullanmayacağın bir özelliğin
Worker'ını hiç kurmak zorunda değilsin (bkz. [🍴 Fork Kurulumu → Bölüm 4](./03-fork-kurulumu.md)).

> ⚠️ **Bu rehberdeki hiçbir değer gerçek değildir.** `<...>` içindeki her şeyi
> kendi değerinle değiştirirsin. Gerçek anahtarları ASLA repoya, `.md`/`.js`
> dosyasına, ekran görüntüsüne ya da sohbete yapıştırma.

---

## İçindekiler

0. [Önce şu 5 kavramı bil](#0-önce-şu-5-kavramı-bil)
1. [Tek bakışta: hangi Worker'a ne girilecek?](#1-tek-bakışta-hangi-workera-ne-girilecek)
2. [Değer sözlüğü: hangi değer nereden bulunur?](#2-değer-sözlüğü-hangi-değer-nereden-bulunur)
3. [Cloudflare panelinde değişken / secret / binding nasıl eklenir?](#3-cloudflare-panelinde-değişken--secret--binding-nasıl-eklenir)
4. [Worker bazlı ayrıntılı kurulum](#4-worker-bazlı-ayrıntılı-kurulum)
5. [Cloudflare Pages ayarları (build, LANG, Kasa/Erişim Kalkanı değişkenleri, deploy hook)](#5-cloudflare-pages-ayarları)
6. [GitHub Actions secret'ları](#6-github-actions-secretları)
7. [Güvenlik kontrol listesi](#7-güvenlik-kontrol-listesi)
8. [Sık karşılaşılan hatalar](#8-sık-karşılaşılan-hatalar)

---

## 0. Önce şu 5 kavramı bil

| Kavram | Ne demek? |
|---|---|
| **Variable (Text)** | Düz yazı olarak saklanan, panelde herkesin görebildiği ayar. Gizli olmayan değerler için (ör. `SUPABASE_URL`, `GITHUB_OWNER`). |
| **Secret** | Kaydedildikten sonra bir daha **gösterilmeyen**, şifreli saklanan değer. Parola/token/anahtar niteliğindeki HER ŞEY için bunu seç. Panelde `Value encrypted` yazar. |
| **Binding** | Worker'a bir Cloudflare kaynağını (burada R2 kovasını) kod içinde kullanabileceği bir **isimle** bağlamak. Değişken değildir; ayrı bir bölümdedir. |
| **Worker adı** | Worker'ı oluştururken verdiğin isim. Adresi belirler: `https://<worker-adı>.<hesap-alt-alanın>.workers.dev` |
| **Deploy** | Kodu ya da ayarı değiştirdikten sonra **Deploy**'a basmadıkça değişiklik canlıya geçmez. Değişken eklemek de yeni bir deploy tetikler; sayfada "Deploy" ya da "Save and deploy" düğmesi çıkarsa bas. |

**Altın kural:** Bir değer birine yetki veriyorsa (token, key, secret, şifre)
→ **Secret**. Sadece bir adres/ad/numara ise → Variable olabilir.
Emin değilsen Secret seç; Secret'ın zararı yok.

---

## 1. Tek bakışta: hangi Worker'a ne girilecek?

Aşağıdaki tablo sadece **ne gireceğini** özetler. Değerin nereden bulunacağı
Bölüm 2'de, adım adım kurulum Bölüm 4'te.

Önerilen Cloudflare adları, repodaki istemci kodunun (`.js`) şu an beklediği
adreslerle uyumludur. Farklı bir ad verirsen Bölüm 4'te gösterilen `.js`
dosyasındaki adresi de güncellemen gerekir.

| # | Repo klasörü (`cloudflare worker/…`) | Önerilen Worker adı | Variable (Text) | Secret | R2 Binding |
|---|---|---|---|---|---|
| 4.1 | `izleme_okuma_worker` | `izleme-okuma-api` | — | `GITHUB_TOKEN` | — |
| 4.2 | `izleme_okuma_yonetim_worker` | `izleme-okuma-yonetim-worker` | `SUPABASE_URL` | `GITHUB_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` | — |
| 4.3 | `github_icerik_yonetim_worker` | `github-icerik-yonetim` | `GITHUB_OWNER`, `GITHUB_REPO`, `SUPABASE_URL` | `GITHUB_PAT`, `SUPABASE_SERVICE_ROLE_KEY` | — |
| 4.4 | `r2_imza_worker` | `r2-imza-worker` | `ACCOUNT_ID`, `BUCKET_NAME`, `SUPABASE_URL` | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `MY_R2_BUCKET` |
| 4.5 | `r2_arsiv_worker` | `r2-arsiv-worker` | `ACCOUNT_ID`, `BUCKET_NAME`, `SUPABASE_URL` *(+ isteğe bağlı `MAX_DOSYA_BAYT`, `R2_SINIF_A_LIMIT`, `R2_SINIF_B_LIMIT`)* | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2EE_KASA_SECRET` | `MY_R2_BUCKET` |
| 4.6 | `r2_not_ek_worker` | `r2-not-ek-worker` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` *(+ isteğe bağlı `KOTA_BAYT`)* | — *(bilerek yok)* | `NOT_EK_BUCKET` |
| 4.7 | `admin_guvenlik_bildirim_worker` | `admin-guvenlik-bildirim-worker` | `TELEGRAM_CHAT_ID` | `GIZLI_YOL`, `WEBHOOK_SHARED_SECRET`, `TELEGRAM_BOT_TOKEN` *(+ isteğe bağlı `TWILIO_*`)* | — |
| 4.8 | `substack_feed_proxy_worker` | `substack-feed-proxy-worker` | — | — | — *(hiçbir şey girilmez)* |
| 4.9 | `akademik_kutuphane_worker` | `akademik-kutuphane-worker` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` *(+ yalnızca çok büyük dosya imzası için: `ACCOUNT_ID`, `BUCKET_NAME`)* | — *(bilerek `service_role` yok)* *(+ yalnızca çok büyük dosya imzası için: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)* | `AKADEMIK_BUCKET` |

> 💡 **"Variable mı Secret mı?" tablodaki sütunlar bir öneridir.** Kod ikisini de
> aynı şekilde okur (`env.ADI`). Önemli olan, gizli değerlerin **Secret**
> olması; yanlışlıkla Variable girilmişse değeri silip aynı adla Secret olarak
> yeniden eklemen yeterli.

---

## 2. Değer sözlüğü: hangi değer nereden bulunur?

Her satır: **değerin adı → ne olduğu → tam olarak nereden alınacağı → Variable mı Secret mı.**

### 2.1 Cloudflare'den gelenler

| Değer | Nedir? | Nereden bulunur? | Tip |
|---|---|---|---|
| `ACCOUNT_ID` | Cloudflare hesabının 32 haneli kimliği | [dash.cloudflare.com](https://dash.cloudflare.com) → sol menüden **Storage & databases → R2 object storage → Overview**; sağdaki **Account details** kutusunda "Account ID". (Alternatif: **Workers & Pages → Overview** sayfasının sağ tarafı.) Yanındaki kopyala simgesine bas. | Variable |
| `BUCKET_NAME` | R2 kovasının adı | **R2 object storage → Overview → Buckets** listesindeki kova adı. Tam olarak (küçük harf, tire) kopyala. | Variable |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | R2'ye imzalı (presigned) bağlantı üretmek için API anahtar çifti | **R2 object storage → Overview → Manage API tokens** (sağ üst "API" bölümü) → **Create API token** → izin: **Object Read & Write** → "Specify bucket(s)" ile **sadece kendi kovanı** seç → **Create API Token**. Çıkan ekranda **Access Key ID** ve **Secret Access Key** görünür. ⚠️ Secret Access Key **sadece bu ekranda, bir kez** gösterilir — hemen kopyala. (Aynı ekrandaki "Token value" ve "jurisdiction URL" bu projede kullanılmaz.) | İkisi de **Secret** |
| `MY_R2_BUCKET` / `NOT_EK_BUCKET` | Bunlar **değişken değil, binding adıdır** | Bölüm 3.2'de anlatıldığı gibi Worker → Settings → Bindings'ten eklenir. | Binding |

### 2.2 Supabase'ten gelenler

Hepsi: [supabase.com/dashboard](https://supabase.com/dashboard) → projeni seç →
sol altta **Project Settings (⚙️) → API** (yeni arayüzde **API Keys** sekmesi de
olabilir; Supabase menü adlarını zaman zaman değiştirir, "API" ya da "API Keys"
geçen sayfayı ara).

| Değer | Nedir? | Sayfada nerede? | Tip |
|---|---|---|---|
| `SUPABASE_URL` | Projenin adresi: `https://<proje-ref>.supabase.co` | **Project URL** kutusu (ya da **Data API → URL**). Sonda `/` ya da `/rest/v1` OLMADAN. Bu değer ile `assets/js/core/supabase-client.js` içindeki `SUPABASE_URL` **aynı** olmalı. | Variable |
| `SUPABASE_ANON_KEY` | "Herkese açık" anahtar. Tarayıcıya zaten gömülü olduğu için gizli değil. | **Project API keys → `anon` `public`** (uzun, `eyJ...` ile başlayan değer). `assets/js/core/supabase-client.js` içindeki `SUPABASE_ANON_KEY` ile **aynı**. | Variable (Secret yapman da sorun olmaz) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Çok güçlü** anahtar: Row Level Security'yi tamamen atlar. | **Project API keys → `service_role` `secret`** → "Reveal" → kopyala. Yeni arayüzde bazen **"Legacy API keys"** sekmesinde durur. | **Secret** (⚠️ asla Variable değil) |

> 🛑 `service_role` anahtarı sızarsa saldırgan veritabanındaki **her şeyi**
> okuyup silebilir. Sadece Worker/Actions secret alanlarına gir. Yanlışlıkla
> paylaştıysan Supabase'te **API Keys → Reset/Roll** ile hemen yenile, sonra
> Worker'lardaki değeri de güncelle.

### 2.3 GitHub'dan gelenler

| Değer | Nedir? | Nereden/Nasıl alınır? | Tip |
|---|---|---|---|
| `GITHUB_OWNER` | GitHub kullanıcı adın | GitHub profil adresindeki ad (`github.com/<BURASI>`) | Variable |
| `GITHUB_REPO` | Site reposunun adı | Repo adresindeki ad, ör. `kullaniciadin.github.io` | Variable |
| `GITHUB_PAT` *(içerik yönetimi)* | Siteye yazı/proje commit'leyebilen anahtar | GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. **Resource owner:** kendin · **Repository access:** *Only select repositories* → sadece site reposu · **Repository permissions → Contents: Read and write** · Oluştur, token'ı hemen kopyala (bir kez gösterilir). | **Secret** |
| `GITHUB_TOKEN` *(izleme/okuma OKUMA Worker'ı)* | Projects panosunu **okur** | GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**. Sadece **`read:project`** izni yeterlidir (Worker kodunun yorumu "project" izni der; `read:project` çalışmazsa `project`'i işaretle). Pano özel bir repodaki issue'ları gösteriyorsa `repo`'yu da ekle. Süre: istediğin kadar (süresi dolunca yenile). | **Secret** |
| `GITHUB_TOKEN` *(izleme/okuma YÖNETİM Worker'ı)* | Panoya kayıt **yazar**, issue açar | Aynı yerden **ayrı bir** Classic token: **`repo`** + **`project`** (yazma dahil). Kişisel hesabın Projects panolarına Fine-grained token genelde erişemediği için Classic önerilir. | **Secret** |

> 🔐 **İki `GITHUB_TOKEN`'ı AYNI token yapma.** Okuma Worker'ı herkese açık;
> yazma yetkisi olmamalı (en az ayrıcalık). İki Worker'da adı aynı
> (`GITHUB_TOKEN`) ama **değerleri iki farklı token** olacak.

### 2.4 Kendin üreteceğin değerler (rastgele sırlar)

Bunları bir yerden "bulmazsın", **kendin üretirsin**. Üretmenin en kolay yolu
bir terminal (Mac/Linux: Terminal, Windows: PowerShell veya WSL):

| Değer | Ne işe yarar? | Nasıl üretilir? | Dikkat |
|---|---|---|---|
| `WEBHOOK_SHARED_SECRET` | Supabase'in Worker'a gönderdiği isteği doğrular | `openssl rand -hex 32` → 64 karakterlik bir yazı çıkar | **Aynı değer** Supabase'e de yazılacak (Bölüm 4.7, adım 4). Secret. |
| `GIZLI_YOL` | Worker adresinin sonuna eklenen tahmin edilemez parça | `openssl rand -hex 12` → ör. `a1b2c3...` (sadece harf/rakam/tire; `/` koyma) | Secret. Adresin sonuna `/` ile eklenir. |
| `GK_COOKIE_SECRET` | Kasa / Erişim Kalkanı uç katmanının yetkili-geçiş cookie'sini **imzalar** (Cloudflare **Pages** projesinde durur, Worker'da değil) | `openssl rand -base64 48` (en az 32 karakter) | Değiştirirsen tüm cookie'ler anında iptal olur (acil durdurma); veri kaybı yok. Secret. Bkz. Bölüm 5.2-B |
| `E2EE_KASA_SECRET` | Dosya şifreleme anahtarlarının **ana tohumu** | `openssl rand -base64 32` → 44 karakterlik base64 yazı | 🛑 **Kaybedersen/değiştirirsen, daha önce şifrelenmiş dosyalar açılamaz hale gelir.** Bir parola yöneticisine yedekle. Secret. |

Terminalin yoksa: bir parola yöneticisinin "güçlü parola üret" özelliğini
(uzunluk 40+, harf+rakam) kullanabilirsin. `E2EE_KASA_SECRET` için **base64**
beklendiğinden onu mutlaka `openssl rand -base64 32` ile üret.

### 2.5 Telegram ve Twilio (bildirimler)

| Değer | Nereden alınır? | Tip |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram'da **@BotFather**'a yaz → `/newbot` → bir ad ve `...bot` ile biten kullanıcı adı ver → sana `123456789:AA...` biçiminde token verir. | **Secret** |
| `TELEGRAM_CHAT_ID` | Mesajın gideceği sohbetin numarası. **Önce kendi botuna Telegram'dan bir kez `/start` yaz.** Sonra tarayıcıda `https://api.telegram.org/bot<TOKEN>/getUpdates` adresini aç (token'ı kendi tokenınla değiştir) → çıktıda `"chat":{"id":123456789,...}` içindeki sayı. (Alternatif: @userinfobot'a yazınca id'ni söyler.) | Variable |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_TO_NUMBER` | **İsteğe bağlı (SMS).** [console.twilio.com](https://console.twilio.com) ana sayfasındaki *Account SID* ve *Auth Token*; *From* = Twilio'dan aldığın numara, *To* = SMS'in gideceği kendi numaran (`+90...` biçiminde). Kullanmayacaksan dört satırı da **hiç ekleme**. | `TWILIO_AUTH_TOKEN` **Secret**; diğerleri Variable olabilir |

> ✅ Telegram **ya da** SMS'ten en az biri yapılandırılmalı. İkisi de boşsa
> Worker isteği kabul eder ama kimseye bildirim göndermez.

### 2.6 İsteğe bağlı ayar değişkenleri (hiç eklemezsen varsayılan çalışır)

| Değişken | Hangi Worker | Varsayılan | Anlamı |
|---|---|---|---|
| `MAX_DOSYA_BAYT` | `r2-arsiv-worker` | `209715200` (200 MB) | Tek dosya üst sınırı (bayt) |
| `R2_SINIF_A_LIMIT` | `r2-arsiv-worker` | `800000` (~0,8 MB) | A sınıfı (küçük) dosya limiti (bayt) |
| `R2_SINIF_B_LIMIT` | `r2-arsiv-worker` | `8000000` (~8 MB) | B sınıfı dosya limiti (bayt) |
| `KOTA_BAYT` | `r2-not-ek-worker` | `524288000` (500 MB) | Kullanıcı başına toplam not eki kotası (bayt) |
| `GK_COOKIE_DAKIKA` | Pages projesi (Kasa uç katmanı) | `15` | Yetkili-geçiş cookie ömrü, dakika (1–120) |
| `GK_AYAR_TTL_SN` | Pages projesi (Kasa uç katmanı) | `30` | `site_ayarlari` önbellek süresi, saniye (5–300) |
| `GK_HATA_KILIT` | Pages projesi (Kasa uç katmanı) | boş (açık kal) | `1` ise: ayarlar okunamazsa **ve** bilinen son ayar yoksa siteyi kilitle |

Hepsi **Variable (Text)**, değer sadece rakam (nokta/virgül/birim yok). `GK_*` değişkenleri Worker'a değil **Cloudflare Pages projesine** girilir (Bölüm 5.2-B).

---

## 3. Cloudflare panelinde değişken / secret / binding nasıl eklenir?

### 3.1 Variable ya da Secret ekleme

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**.
2. Listeden Worker'ına tıkla.
3. Üst sekmelerden **Settings**'e geç.
4. **Variables and secrets** bölümünde sağ üstteki **+ Add** (ya da **Add variable**) düğmesine bas.
5. **Type** seç:
   - Gizli değer → **Secret**
   - Gizli olmayan → **Text** (panelde "Variable" olarak listelenir)
6. **Variable name** kutusuna adı **birebir** yaz (büyük harf, alt çizgi; boşluk yok).
7. **Value** kutusuna değeri yapıştır. ⚠️ Başında/sonunda boşluk veya satır sonu kalmasın.
8. **Deploy** / **Save and deploy** düğmesine bas.

> Secret kaydedildikten sonra değeri bir daha göremezsin. Yanlış girdiysen
> kalem simgesiyle yeni değeri yazarak **üzerine yazarsın**.

### 3.2 R2 binding ekleme (sadece R2 kullanan Worker'larda)

1. Worker → **Settings → Bindings** → **+ Add**.
2. Tür olarak **R2 bucket** seç.
3. **Variable name:** bölümüne binding adını yaz (Worker'a göre `MY_R2_BUCKET`, `NOT_EK_BUCKET` **veya** `AKADEMIK_BUCKET` — Bölüm 1 tablosunda hangisi olduğu yazıyor; harfi harfine).
4. **R2 bucket:** listesinden kovanı seç.
5. **Deploy**.

---

## 4. Worker bazlı ayrıntılı kurulum

**Her Worker için ortak başlangıç (bir kez):**

1. **Workers & Pages → Create application → Create Worker** (ya da "Start with Hello World").
2. Bölüm 1'deki **önerilen adı** ver → **Deploy**.
3. **Edit code** → varsayılan kodu tamamen sil → ilgili `worker.js` dosyasının **tamamını** yapıştır → **Deploy**.
4. Aşağıdaki Worker bölümündeki tabloyu **Settings → Variables and secrets**'a gir.
5. Gerekiyorsa **Bindings**'i ekle.
6. Worker'ın adresini (`https://<ad>.<hesap>.workers.dev`) kopyala; istemcideki `.js`/`.md` dosyasında belirtilen sabite yapıştır, commit'le.

**Fork edenler için ortak not:** Worker kodlarının başında senin hesabına göre
değiştirmen gereken birkaç sabit var (kendi GitHub kullanıcı adın, site
adreslerin). Her bölümün sonundaki **"Kod içinde değiştirilecekler"**
kutusuna bak. Site adreslerini (`IZINLI_ORIGINLER` / `ALLOWED_ORIGINS`
listeleri) değiştirmeyi unutursan, tarayıcı Worker'a erişirken **CORS /
"İzin verilmeyen kaynak"** hatası alırsın.

---

### 4.1 `izleme-okuma-api` — İzlediklerim / Okuduklarım (OKUMA)

**Ne yapar?** GitHub Projects panolarını okuyup `izlediklerim`/`okuduklarim` sayfasını besler. Herkese açık, sadece okur.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| **Secret** | `GITHUB_TOKEN` | Classic token, **sadece okuma** (`read:project`) | Bölüm 2.3 → "OKUMA Worker'ı" |

- **Binding:** yok.
- **Adres nereye yazılır?** `_config.yml` → `cloudflare_worker_url:`
- **Kod içinde değiştirilecekler:** `GITHUB_LOGIN` (kendi kullanıcı adın), `PROJECTS` içindeki proje numaraları (`number: 2` / `3` — kendi panolarının numarası).
- **Test:** Adresin sonuna `?project=izleme` ekleyip tarayıcıda aç; JSON gelmeli.

---

### 4.2 `izleme-okuma-yonetim-worker` — İzleme/Okuma panosuna YAZMA

**Ne yapar?** `/panel/izleme-okuma-yonetim.html` sayfasından yeni kayıt ekler/günceller. **Sadece `owner` rolü** kullanabilir.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| **Secret** | `GITHUB_TOKEN` | Classic token: `repo` + `project` | Bölüm 2.3 → "YÖNETİM Worker'ı" (okuma Worker'ından **farklı** token) |
| Variable *(ya da Secret)* | `SUPABASE_URL` | `https://<proje-ref>.supabase.co` | Bölüm 2.2 |
| **Secret** | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` anahtarı | Bölüm 2.2 |

- **Binding:** yok.
- **Adres nereye yazılır?** `assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js` → `IZLEME_OKUMA_WORKER_URL`
- **Kod içinde değiştirilecekler:** `GITHUB_LOGIN`, `REPO_OWNER`, `REPO_NAME` (izleme/okuma kayıtlarının issue olarak tutulduğu repo), izinli origin listesi.
- **Önkoşul:** Supabase `profiles` tablosunda kendi rolün `owner` olmalı (bkz. `supabase/site-sahibi-atama.sql`).

---

### 4.3 `github-icerik-yonetim` — GitHub İçerik Yönetimi (mini CMS)

**Ne yapar?** Panelden blog yazısı/proje ekleyip repoya commit'ler. GitHub anahtarı tarayıcıya hiç girmez; sadece bu Worker'da durur.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| Variable | `GITHUB_OWNER` | GitHub kullanıcı adın | Bölüm 2.3 |
| Variable | `GITHUB_REPO` | Site reposunun adı | Bölüm 2.3 |
| **Secret** | `GITHUB_PAT` | Fine-grained token (Contents: Read and write, sadece site reposu) | Bölüm 2.3 |
| Variable *(ya da Secret)* | `SUPABASE_URL` | `https://<proje-ref>.supabase.co` | Bölüm 2.2 |
| **Secret** | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` anahtarı | Bölüm 2.2 |

- **Binding:** yok.
- **Adres nereye yazılır?** `assets/js/github-yonetim/github-yonetim.js` → `GITHUB_PROXY_WORKER_URL`
- **Kod içinde değiştirilecekler:** izinli origin listesi (`github.io` ve `pages.dev` adresleri).
- **Test:** `/panel/github-yonetim.html`'e `owner/admin/editor/manager` hesabıyla gir; "Bağlantı doğrulandı" mesajını görmelisin.

---

### 4.4 `r2-imza-worker` — Özel dosya paylaşımı (imzalı indirme linki)

**Ne yapar?** Özel içeriklerdeki dosyalar için süreli, imzalı indirme bağlantısı üretir; kullanıcının o dosyaya erişim izni olup olmadığını da kontrol eder.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| Variable | `ACCOUNT_ID` | Cloudflare hesap ID | Bölüm 2.1 |
| Variable | `BUCKET_NAME` | Özel dosyaların kovasının adı | Bölüm 2.1 |
| **Secret** | `R2_ACCESS_KEY_ID` | R2 API token'ının Access Key ID'si | Bölüm 2.1 |
| **Secret** | `R2_SECRET_ACCESS_KEY` | R2 API token'ının Secret Access Key'i | Bölüm 2.1 |
| Variable | `SUPABASE_URL` | `https://<proje-ref>.supabase.co` | Bölüm 2.2 |
| **Secret** | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` anahtarı | Bölüm 2.2 |

- **Binding:** `MY_R2_BUCKET` → özel dosyalar kovası.
- **Adres nereye yazılır?** `assets/js/dosya-paylasim.js` → `WORKER_URL`
- **Kod içinde değiştirilecekler:** izinli origin listesi.

---

### 4.5 `r2-arsiv-worker` — Dosya Arşivi / Kasa (uçtan uca şifreli)

**Ne yapar?** R2 dosya yöneticisinin "kontrol düzlemi": yükleme/indirme izni, kota, silme. Dosya baytları bu Worker'dan geçmez; tarayıcı doğrudan R2'ye imzalı adresle yükler.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| Variable | `ACCOUNT_ID` | Cloudflare hesap ID | Bölüm 2.1 |
| Variable | `BUCKET_NAME` | Arşiv kovasının adı (4.4 ile **aynı kova** olabilir) | Bölüm 2.1 |
| **Secret** | `R2_ACCESS_KEY_ID` | R2 Access Key ID | Bölüm 2.1 |
| **Secret** | `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key | Bölüm 2.1 |
| Variable | `SUPABASE_URL` | `https://<proje-ref>.supabase.co` | Bölüm 2.2 |
| **Secret** | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` anahtarı | Bölüm 2.2 |
| **Secret** | `E2EE_KASA_SECRET` | `openssl rand -base64 32` çıktısı | Bölüm 2.4 — 🛑 **yedekle, değiştirme** |
| Variable *(isteğe bağlı)* | `MAX_DOSYA_BAYT`, `R2_SINIF_A_LIMIT`, `R2_SINIF_B_LIMIT` | Sadece rakam | Bölüm 2.6 |

- **Binding:** `MY_R2_BUCKET` → arşiv kovası.
- **Adres nereye yazılır?** `assets/js/r2-arsiv/e2ee.js` → `ARSIV_WORKER_URL`
- **R2 kovasında CORS (zorunlu):** Tarayıcı dosyayı Worker'dan geçirmeden **doğrudan R2'ye** yükler/indirir; bu yüzden kovada CORS kuralı olmazsa yükleme "R2'ye ulaşılamadı (ağ ya da bucket CORS ayarı)" hatasıyla düşer.

  **Nereye girilir?** Cloudflare → **R2 object storage** → kovanı seç (ör. `abdullah-eymen-asru-site-ozel-dosyalar`) → **Settings** → **CORS Policy** → **Add CORS policy** → **JSON** sekmesine aşağıdakini yapıştır → **Save**:

  ```json
  [
    {
      "AllowedOrigins": [
        "https://abdullah-eymen-asru.github.io",
        "https://abdullah-eymen-asru.pages.dev"
      ],
      "AllowedMethods": [
        "GET",
        "PUT"
      ],
      "AllowedHeaders": [
        "Content-Type"
      ],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  **Neden bu ayarlar?**
  - `PUT` → yükleme, `GET` → indirme/önizleme. `HEAD` gerekmez: yükleme sonrası boyut doğrulamasını Worker, R2 binding'i üzerinden kendisi yapar (tarayıcı yapmaz).
  - `AllowedHeaders: Content-Type` → tarayıcının imzalı `PUT` isteğinde gönderdiği tek header bu. `*` yazmaya gerek yok; daha dar olan daha güvenlidir.
  - `MaxAgeSeconds: 3600` → tarayıcı CORS ön kontrolünü 1 saat önbelleğe alır, her yüklemede tekrar sormaz.
  - `AllowedOrigins` → sadece kendi site adreslerin; sonunda `/` olmadan, `https://` ile. **Fork edenler:** bu iki adresi kendi `github.io` ve `pages.dev` adresinle değiştir.
  - Bu kural **kova bazlıdır**: 4.4'teki `r2-imza-worker` ile 4.5'teki `r2-arsiv-worker` aynı kovayı kullanıyorsa tek kural ikisine de yeter. Not ekleri için ayrı bir kova (`NOT_EK_BUCKET`) kullanıyorsan ona CORS **gerekmez**; o kovaya tarayıcı doğrudan değil, Worker üzerinden erişir.
  - Kuralı kaydettikten sonra yürürlüğe girmesi birkaç saniye sürebilir; hata devam ediyorsa tarayıcı önbelleğini temizleyip sayfayı sert yenile (Cmd/Ctrl+Shift+R).
- **Kod içinde değiştirilecekler:** `IZINLI_ORIGINLER` listesi.

---

### 4.6 `r2-not-ek-worker` — Not Defteri ekleri ("Fikir & Araştırma Tezgâhı")

**Ne yapar?** Notlara eklenen görsel/PDF'lerin **şifreli** halini saklar. Her kullanıcı sadece kendi klasörüne erişir.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| Variable | `SUPABASE_URL` | `https://<proje-ref>.supabase.co` | Bölüm 2.2 |
| Variable | `SUPABASE_ANON_KEY` | `anon public` anahtarı | Bölüm 2.2 |
| Variable *(isteğe bağlı)* | `KOTA_BAYT` | Sadece rakam (varsayılan 500 MB) | Bölüm 2.6 |

- **Binding:** `NOT_EK_BUCKET` → **ayrı, yeni bir kova** öneriyoruz (not ekleri diğer dosyalardan ayrı dursun). Adı serbest (ör. `notlar-ekler`).
- **Adres nereye yazılır?** `assets/js/notlar/notlar.js` → `EK_WORKER_URL`
- **Dikkat:** Bu Worker'da **`service_role` YOK ve olmamalı** — kasıtlı tasarım: Worker kullanıcının kendi oturumuyla çalışır; ele geçirilse bile tüm veritabanı açılmaz. Buraya `SUPABASE_SERVICE_ROLE_KEY` ekleme.
- **Kod içinde değiştirilecekler:** `IZINLI_ORIGINLER` listesi.

---

### 4.7 `admin-guvenlik-bildirim-worker` — Admin denetim bildirimleri (Telegram/SMS)

**Ne yapar?** Bir admin askıya alındığında/oylama olduğunda Supabase bu Worker'a istek atar; Worker de sana Telegram (ve istersen SMS) gönderir.

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| **Secret** | `GIZLI_YOL` | Rastgele kısa yazı | Bölüm 2.4 |
| **Secret** | `WEBHOOK_SHARED_SECRET` | `openssl rand -hex 32` çıktısı | Bölüm 2.4 |
| **Secret** | `TELEGRAM_BOT_TOKEN` | BotFather'ın verdiği token | Bölüm 2.5 |
| Variable | `TELEGRAM_CHAT_ID` | Sohbet numaran | Bölüm 2.5 |
| *(isteğe bağlı)* | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_TO_NUMBER` | Twilio bilgilerin | Bölüm 2.5 |

- **Binding:** yok.
- **Supabase tarafı (4. adım — atlanırsa bildirim gelmez):** Supabase → **SQL Editor** → aşağıdakini kendi değerlerinle doldurup çalıştır. (Migration `0034` uygulanmış olmalı.)

  ```sql
  update public.guvenlik_bildirim_ayarlari
  set webhook_url    = 'https://<worker-adı>.<hesap>.workers.dev/<GIZLI_YOL değeri>',
      webhook_secret = '<WEBHOOK_SHARED_SECRET ile AYNI değer>',
      aktif          = true
  where id = 1;
  ```

  `webhook_url`'nin sonunda **`/` + GIZLI_YOL** olmalı. `webhook_secret` Worker'daki
  `WEBHOOK_SHARED_SECRET` ile **harfi harfine aynı** olmalı; biri farklıysa Worker 401 döner.
- **Test:** Bir denetim vakası tetikle; Telegram'a mesaj gelmiyorsa Worker → **Observability / Logs** sekmesine bak.

---

### 4.8 `substack-feed-proxy-worker` — Substack yazıları

**Ne yapar?** Substack RSS'ini CORS izniyle sayfaya iletir. Herkese açık bilgi olduğundan **hiçbir değişken/secret/binding gerekmez.**

- **Kod içinde değiştirilecekler:** `FEED_URL` (kendi Substack feed adresin: `https://<adın>.substack.com/feed`) ve `ALLOWED_ORIGINS`.
- **Adres nereye yazılır?** `icerik/blog.md` → `SUBSTACK_FEED_PROXY_WORKER_URL`
- Substack kullanmıyorsan bu Worker'ı hiç kurma (bkz. Fork Kurulumu → Bölüm 4).

---

### 4.9 `akademik-kutuphane-worker` — Akademik Kütüphane (PDF okuma / açıklamalı PDF'i R2'ye geri yazma)

**Ne yapar?** Akademik Kütüphane'deki PDF'lerin R2'deki güvenli kapısıdır (Supabase **migration 0072** ile birlikte kurulur):

- `GET /pdf/<kaynak_id>` — PDF'i okur (**Range** destekli: büyük PDF'ler parça parça açılır).
- `PUT /pdf/<kaynak_id>` — ilk yükleme **ve** vurgu/not eklenmiş PDF'in R2'deki dosyanın **üzerine yazılması**. Üzerine yazmadan önce bir önceki sürüm otomatik yedeklenir (okuyucudaki ↶ düğmesi geri yükler).
- `DELETE /pdf/<kaynak_id>`, `POST /pdf/<kaynak_id>/onceki-surum`, `POST …/yukleme-imzasi`, `POST …/yukleme-tamam` (çok büyük dosya yolu).
- `GET /meta?url=…` — makale bağlantısından künye önerisi (sunucuda `citation_*` meta etiketlerini okur; tarayıcı başka sitelerin HTML'ini CORS yüzünden okuyamaz).

**Dosya yolu:** `akademik-kutuphane/users/<user_id>/<dosya_adi>.pdf` (ön ek sabittir, kova adı serbest). **Boyut ya da kullanıcı kotası sınırı uygulanmaz** (bilinçli istek).

| Tip | Ad | Değer | Nereden? |
|---|---|---|---|
| Variable | `SUPABASE_URL` | `https://<proje-ref>.supabase.co` | Bölüm 2.2 |
| Variable | `SUPABASE_ANON_KEY` | `anon public` anahtarı | Bölüm 2.2 |
| Variable *(isteğe bağlı — çok büyük dosyalar)* | `ACCOUNT_ID` | Cloudflare hesap ID | Bölüm 2.1 |
| Variable *(isteğe bağlı — çok büyük dosyalar)* | `BUCKET_NAME` | `AKADEMIK_BUCKET`'ın bağlı olduğu kovanın **gerçek adı** | Bölüm 2.1 |
| **Secret** *(isteğe bağlı — çok büyük dosyalar)* | `R2_ACCESS_KEY_ID` | R2 Access Key ID | Bölüm 2.1 |
| **Secret** *(isteğe bağlı — çok büyük dosyalar)* | `R2_SECRET_ACCESS_KEY` | R2 Secret Access Key | Bölüm 2.1 |

**Kurulum adımları (sırayla):**

1. **Supabase:** `supabase/migrations/0072_akademik_kutuphane.sql` dosyasını SQL Editor'de **tek seferde** çalıştır. (Önceki 0001–0071 uygulanmış olmalı.)
2. **R2 kovası:** Cloudflare → **R2 object storage** → **Create bucket** → ad: `akademik-kutuphane` (öneri; **ayrı bir kova** kullan ki arşiv/not dosyalarıyla karışmasın). Kovaya kota ya da boyut sınırı **koyma**.
3. **Worker:** Bölüm 4'teki ortak başlangıçla `akademik-kutuphane-worker` oluştur, `cloudflare worker/akademik_kutuphane_worker/worker.js` içeriğini yapıştır, **Deploy**.
4. **Variables:** yukarıdaki tablodan `SUPABASE_URL` ve `SUPABASE_ANON_KEY`'i gir. **Deploy.**
5. **Binding:** Worker → **Settings → Bindings → + Add → R2 bucket** → *Variable name:* `AKADEMIK_BUCKET` (harfi harfine) → kova: `akademik-kutuphane` → **Deploy**.
6. **Adresi istemciye yaz:** Worker adresini (`https://akademik-kutuphane-worker.<hesap>.workers.dev`) `assets/js/akademik/ortak.js` → `AKADEMIK_WORKER_URL` sabitine yaz (varsayılan değer `aeymena` hesabına göredir), commit'le.
7. **Panelde aç/kapat:** Panel → **Yetki Ayarları** → matristeki **Akademik Kütüphane** satırı. Hangi rollerin (Üye, Özel Üye, Yazar, İçerik Sorumlusu, Yönetici) kütüphaneyi görebileceğini buradan belirlersin; **owner her zaman erişir**. (Yeni bir kalkan/izin sistemi yoktur; mevcut `ozellik_erisimleri` matrisi kullanılır.)
8. **Doğrula:** tarayıcıda `https://akademik-kutuphane-worker.<hesap>.workers.dev/saglik` → `{"ok":true,"buyuk_dosya_imzasi":false}` görmelisin (imza secret'larını girdiysen `true`).

**Neden `service_role` YOK?** `r2-not-ek-worker` ile aynı tasarım: Worker kullanıcının **kendi JWT'si** ve `anon` anahtarla Supabase'e sorar; böylece satır görünürlüğünü (sahibi / `ekip` / `herkese_acik` / owner incelemesi) **RLS** belirler. Worker ele geçirilse bile veritabanının tamamı açılmaz. Buraya `SUPABASE_SERVICE_ROLE_KEY` **ekleme**.

**Boyut sınırı hakkında (önemli, dürüst not):** Kodda hiçbir boyut/kota sınırı yoktur. Tek fiziksel sınır Cloudflare'in Worker'a **istek gövdesi** üst sınırıdır (Free/Pro ≈ 100 MB, Business ≈ 200 MB, Enterprise ≈ 500 MB). İstemci, **90 MB'ın üstündeki** PDF'leri otomatik olarak `…/yukleme-imzasi` yoluna yönlendirir: Worker JWT'yi doğrular ve **süreli (1 saat) imzalı R2 adresi** verir, tarayıcı dosyayı **doğrudan R2'ye** yazar (sınır yok). Bu yol için tablodaki **isteğe bağlı** dört değişken/secret'ı gir **ve** R2 kovasına CORS ekle (aşağıda). Girmezsen 90 MB'a kadar her şey çalışır; daha büyük dosyada okuyucu "imza yapılandırılmamış" hatası verir. Bu yolda önceki-sürüm yedeği alınmaz.

**R2 kovasında CORS (yalnızca büyük dosya imzası kullanacaksan):** kovayı seç → **Settings → CORS Policy → Add CORS policy → JSON**:

```json
[
  {
    "AllowedOrigins": [
      "https://abdullah-eymen-asru.github.io",
      "https://abdullah-eymen-asru.pages.dev"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

(Normal okuma/yazma Worker üzerinden olduğu için `GET` gerekmez. R2 API token'ının izni **bu kovayı** da kapsamalı: *Object Read & Write*.)

**Okuyucu motoru (PDF.js) için ek ayar yok — ama bilmen gerekenler:**

- PDF.js ve pdf-lib koda gömülmez; resmi paketler **jsDelivr** (yedek: unpkg) üzerinden **sürüm sabitli** yüklenir. Sürümü panelde **Akademik Kütüphane → Tüm Kullanıcıların Kaynakları → ⚙️ Okuyucu motoru** kartından (yalnızca owner) **Dene → Sabitle** veya **Okuyucu Motorunu Güncelle (en yeni)** ile değiştirirsin; sürüm Supabase'teki `akademik_okuyucu_ayarlari` tablosunda durur ve tüm kullanıcılara birden uygulanır.
- **CSP:** Pages/Cloudflare tarafında yeni secret gerekmez ama sitenin CSP'sine `worker-src 'self' blob:` eklendi (`_layouts/default.html` **ve** `_headers`). Bu olmadan PDF.js çalışır ama ana iş parçacığında (yavaş) çalışır. Özel bir CSP yazdıysan o satırı kendi politikana da ekle; jsDelivr/unpkg zaten `https:` kapsamında.
- **R2 kota/sınır koyma:** Cloudflare panelinde kovaya ayrıca bir boyut/kota kuralı tanımlama; sınırsız tasarım bunu varsayar.

- **Kod içinde değiştirilecekler:** `IZINLI_ORIGINLER` listesi (worker.js) ve `AKADEMIK_WORKER_URL` (`assets/js/akademik/ortak.js`).

---

## 5. Cloudflare Pages ayarları

Siteyi Cloudflare Pages'e bağladığında (**Workers & Pages → Create → Pages → Connect to Git**) ayarlar iki yerde durur: **Build** ve **Variables and secrets**. Pages ayarlarına sonradan:
**Workers & Pages → proje adın → Settings**'ten ulaşırsın.

### 5.1 Build ayarları (Settings → Build)

| Ayar | Girilecek değer |
|---|---|
| **Git repository** | Site reposu (`kullaniciadin/kullaniciadin.github.io`) |
| **Build command** | `bundle install && bundle exec jekyll build --config _config.yml,_config_cloudflare.yml` |
| **Build output** (directory) | `_site` |
| **Root directory** | **Boş bırak** (repo kökü) |
| **Build comments** | Enabled (isteğe bağlı; PR'lara build durumu yorumu ekler) |
| **Production branch** | `main` |
| **Automatic deployments** | Enabled (`main`'e her push'ta otomatik yayın) |
| **Build watch paths** | Include paths: `*` (her dosya değişimi build tetikler) |
| **Build cache** | Enabled (build'i hızlandırır; garip bir hata alırsan **Clear Cache** deneyebilirsin) |
| **Build system version** | **Version 3** |

> `_config_cloudflare.yml` dosyası, `_config.yml`'in üzerine **sadece Cloudflare'e özel** değerleri (Analytics ID) yazar. İki dosya virgülle, **boşluksuz** ve bu sırayla yazılmalı.

### 5.2 Variables and secrets (Settings → Variables and secrets)

Pages projesine **iki ayrı grup** değişken girilir: (A) build kodlaması için
üç Text değişkeni, (B) Kasa / Erişim Kalkanı uç katmanı için altı değişken.
Hepsi aynı yerde durur: **Workers & Pages → proje adın → Settings →
Variables and secrets**.

> 📌 **Production ve Preview ayrı ortamlardır.** Aşağıdaki değişkenleri **hem
> Production hem Preview** için gir; yalnızca birine eklersen diğer ortamda
> değişken yokmuş gibi davranılır.

#### A) Build kodlaması (her kurulumda gerekli)

Jekyll build'i Türkçe karakterli dosyalarda "invalid byte sequence" /
"US-ASCII" gibi kodlama hataları verebilir. Bunu önlemek için **üç Text
değişkeni** ekle (Type: **Text**):

| Type | Name | Value |
|---|---|---|
| Text | `LANG` | `C.UTF-8` |
| Text | `LANGUAGE` | `C.UTF-8` |
| Text | `LC_ALL` | `C.UTF-8` |

- Bunlar **gizli değil**, kodlama ayarıdır; Secret yapma, Text olsun.

#### B) Kasa / Erişim Kalkanı uç katmanı (`functions/_middleware.js`)

`pages.dev` adresindeki kilidi (Panel → Yetki Ayarları → Erişim Kalkanı)
**sunucu tarafında** da uygulayan Pages Functions katmanını kuruyorsan şu
değişkenleri gir. Kurmayacaksan bu bölümü atla; yalnızca tarayıcıda çalışan
`gatekeeper.js` perdesi kullanılır.

| Ad | Tür | Değer |
|---|---|---|
| `SUPABASE_URL` | Text | `https://<proje-ref>.supabase.co` (Bölüm 2.2) |
| `SUPABASE_ANON_KEY` | Text | Supabase → Project Settings → API → **anon public** (gizli değil; `service_role` **ASLA**) |
| `GK_COOKIE_SECRET` | **Secret** | En az 32 karakter rastgele. Üretmek için: `openssl rand -base64 48` (Bölüm 2.4) |
| `GK_COOKIE_DAKIKA` | Text, opsiyonel | Cookie ömrü, varsayılan `15` (1–120) |
| `GK_AYAR_TTL_SN` | Text, opsiyonel | `site_ayarlari` önbellek süresi (sn), varsayılan `30` (5–300) |
| `GK_HATA_KILIT` | Text, opsiyonel | `1` yaparsan: ayarlar okunamazsa **ve** bilinen son ayar yoksa siteyi kilitle. Varsayılan: açık kal (`gatekeeper.js` ile aynı ilke) |

**Önemli notlar**

- **`GK_COOKIE_SECRET` neden gerekli?** Cookie'nin sahte üretilememesi için
  imzalanması şart. Değerini değiştirmek **tüm cookie'leri anında iptal eder**
  (acil durdurma olarak da kullanılabilir). Yetkili kullanıcılar için kilit
  sayfası işlemi sessizce tekrarlar; yani değiştirmek veri kaybettirmez.
- **Anahtar türleri:** `SUPABASE_ANON_KEY` olarak yalnızca **anon public**
  anahtarını gir. `service_role` anahtarı bu projeye hiçbir koşulda yazılmaz.
  Parola/imza niteliğindeki `GK_COOKIE_SECRET` mutlaka **Secret** olmalı.
- **Yetkili geçiş nasıl çalışır?** Oturum tarayıcının `localStorage`'ında
  durur, sayfa isteğiyle sunucuya gitmez. Bu yüzden kilit sayfası
  (`/_gk/el-sikisma.js`) sitenin kendi `supabase-client.js`'iyle oturumu alır,
  JWT'yi `POST /_gk/oturum`'a gönderir; uç katman JWT'yi Supabase'in
  `gk_bypass_var_mi()` RPC'siyle doğrular (**yetki kararı veritabanında
  kalır**: owner / askıda olmayan admin / izinli roller). Olumluysa
  `HttpOnly; Secure; SameSite=Lax; Path=/` (`__Host-gk`), HMAC imzalı,
  varsayılan **15 dk** ömürlü cookie verilir; sonrasında cookie yerelde
  doğrulanır. Süre dolunca kilit sayfası aynı işlemi sessizce tekrarlar.
- **Rotaya bağlı varlıklar:** `/assets/cv/*` → `/cv`, `/feed.xml` ve
  `/rss.xml` → `/blog`. Alan adı komple kilitliyken bunlar ve diğer tüm
  görsel/pdf/feed dosyaları da **403** döner. Listeyi `_middleware.js`
  içindeki `VARLIK_ROTALARI` ve `ACIK_VARLIK_*` sabitlerinden düzenlersin.
- **Dosya yeri:** `functions/_middleware.js` → repo **kökündeki** `functions/`
  klasörüne (Cloudflare Git entegrasyonu bu klasörü otomatik bulur; Jekyll
  build komutunu değiştirmene gerek yok). İstersen `tests/edge-kasa.test.mjs`
  → `tests/`. Kurulumun tüm adımları paketteki `KURULUM-KASA.md` dosyasında.

#### Genel notlar

- Değişken ekledikten/değiştirdikten sonra **yeni bir deploy** gerekir; mevcut
  yayın eski değerlerle çalışmaya devam eder.
- **Bindings** bölümüne yukarıdaki değişkenler için bir şey eklemene gerek
  yok; `KURULUM-KASA.md` ayrıca bir binding isterse orayı izle.
- Pages'te **`service_role` ya da başka bir yetkili anahtar girmezsin.**
  Build'e gömülen her şey zaten herkese açıktır. Pages'e giren tek gerçek
  sır `GK_COOKIE_SECRET`'tır ve yalnızca sunucu tarafı uç katman tarafından
  okunur, siteye gömülmez; diğer gizli değerler yalnızca Worker'larda ya da
  GitHub Actions secret'larında durur.

### 5.3 Deploy Hook (zamanlanmış yazılar için)

Gelecek tarihli yazıların zamanı gelince otomatik yayınlanması için:

1. Pages projesi → **Settings → Build → Deploy hooks → +** (Add).
2. **Name:** `Deploy Hook URL` (ya da istediğin ad) · **Branch:** `main` → **Save**.
3. Çıkan `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/...` adresini kopyala (kopyala simgesi var).
4. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret** → **Name:** `CLOUDFLARE_DEPLOY_HOOK_URL` · **Secret:** kopyaladığın adres.

> Bu adresi bilen herkes sitenin yeniden build'ini tetikleyebilir. Public bir yere yazma. Sızarsa hook'u silip yenisini oluştur.

### 5.4 GitHub Pages (yedek adres) kullanıyorsan

GitHub reposu → **Settings → Pages → Build and deployment → Source: GitHub Actions**. (Proje kendi `github-pages-deploy.yml` workflow'u ile Ruby 3.3 üzerinde build alır.) Bu, Cloudflare ayarlarından bağımsızdır.

---

## 6. GitHub Actions secret'ları

Konum: GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**.
Bunlar Cloudflare'de değil GitHub'da durur; ama "hangi secret nerede?" sorusu karışmasın diye burada özetlendi.

| Secret adı | Hangi workflow? | Değer ne? |
|---|---|---|
| `CLOUDFLARE_DEPLOY_HOOK_URL` | `zamanlanmis-yayin.yml` | Bölüm 5.3'teki Deploy Hook adresi |
| `SUPABASE_URL` | `supabase-ping.yml` | `https://<proje-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase-ping.yml` | Bölüm 2.2'deki `service_role` anahtarı |
| `ADMIN_DENETIM_FUNCTION_URL` | `admin-denetim-zaman-asimi.yml` | İlgili Supabase Edge Function'ın adresi (`https://<proje-ref>.supabase.co/functions/v1/<fonksiyon-adı>`) |
| `ADMIN_DENETIM_CRON_SECRET` | `admin-denetim-zaman-asimi.yml` | Kendi ürettiğin rastgele sır; Edge Function'ın secret'ıyla **aynı** olmalı |
| `MESAJ_KALICI_SILME_FUNCTION_URL` | `mesajlasma-kalici-silme.yml` | İlgili Edge Function adresi |
| `MESAJ_KALICI_SILME_CRON_SECRET` | `mesajlasma-kalici-silme.yml` | Kendi ürettiğin rastgele sır; Edge Function'daki ile **aynı** |

Her workflow dosyasının en üstündeki yorum satırlarında kendi kurulum adımları da yazıyor; ayrıntı için oraya bak.

---

## 7. Güvenlik kontrol listesi

Kurulumdan sonra tek tek işaretle:

- [ ] Parola/token/key niteliğindeki her değer **Secret** (panelde `Value encrypted`). Özellikle: `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SHARED_SECRET`, `GIZLI_YOL`, `GITHUB_*`, `R2_*`, `SUPABASE_SERVICE_ROLE_KEY`, `E2EE_KASA_SECRET`, `TWILIO_AUTH_TOKEN`, `GK_COOKIE_SECRET` (Pages).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` hiçbir `.js`/`.md`/`.yml` dosyasında ve hiçbir commit'te yok.
- [ ] `r2-not-ek-worker`'da `service_role` yok.
- [ ] `akademik-kutuphane-worker`'da `service_role` yok; `AKADEMIK_BUCKET` ayrı bir kovaya bağlı; (büyük dosya imzası kullanıyorsan) R2 token'ı yalnızca ilgili kovalara izinli ve kovada `PUT`'a izinli CORS kuralı var.
- [ ] Kasa uç katmanını kurduysan: Pages'te `SUPABASE_ANON_KEY` olarak **anon public** var (`service_role` değil) ve `GK_COOKIE_SECRET` en az 32 karakterli bir **Secret**; değişkenler hem Production hem Preview'a girildi.
- [ ] İki `GITHUB_TOKEN` (okuma/yazma) **farklı** token'lar; okuma olan yazma yetkisi taşımıyor.
- [ ] R2 API token'ı **sadece kendi kovalarına** izinli.
- [ ] `E2EE_KASA_SECRET` bir parola yöneticisinde yedekli.
- [ ] Her Worker'ın `IZINLI_ORIGINLER` / `ALLOWED_ORIGINS` listesinde **sadece kendi site adreslerin** var.
- [ ] Ekran görüntüsü paylaşırken (destek, sohbet, forum) Variable değerlerini (token, chat id, gizli yol, hesap id) karart. Variable olarak girilmiş gizli bir değer görüntüde okunabilir; böyle bir değeri paylaştıysan **yenile** ve Secret olarak yeniden gir.
- [ ] Süresi dolan GitHub token'larının yenileme tarihini takvimine yazdın.

---

## 8. Sık karşılaşılan hatalar

| Belirti | Büyük ihtimalle sebep | Çözüm |
|---|---|---|
| Panelde "İzin verilmeyen kaynak" / tarayıcı konsolunda CORS hatası | Site adresin Worker'ın origin listesinde yok | Worker kodundaki `IZINLI_ORIGINLER`/`ALLOWED_ORIGINS`'e adresini ekle (sonunda `/` olmadan, `https://` ile), **Deploy** |
| Worker `401` / `403` döner | Supabase oturumu geçersiz, rol yetersiz, ya da secret yanlış | Çıkış-giriş yap; rolünü kontrol et; `SUPABASE_URL` ve anahtarın **aynı projeye** ait olduğunu doğrula |
| `... is not configured` / `... ayarlanmamış` benzeri mesaj | Bir değişken eksik ya da adı yanlış yazılmış | Bölüm 1 tablosuyla karşılaştır; büyük/küçük harf ve alt çizgi birebir olmalı; Deploy etmeyi unutma |
| Değişkeni ekledim ama etkisi yok | Deploy edilmedi veya yanlış ortama (Production/Preview) eklendi | Settings'te **Production** sekmesinde olduğundan emin ol, Deploy et |
| Dosya yüklerken "R2'ye ulaşılamadı (ağ ya da bucket CORS ayarı)" | R2 kovasında CORS kuralı yok ya da `AllowedOrigins`'te site adresin eksik | Bölüm 4.5'teki CORS policy JSON'unu kovaya ekle; adreslerin birebir doğru olduğunu kontrol et |
| Dosya imzalı link alınamıyor | `R2_ACCESS_KEY_ID`/`SECRET` yanlış ya da token'ın izni kovana yetmiyor | Yeni R2 API token oluştur, **Object Read & Write** + doğru kova |
| Daha önce yüklenen şifreli dosyalar açılmıyor | `E2EE_KASA_SECRET` değişmiş | Eski değeri geri gir (yedekten). Eski değer kayıpsa o dosyalar kurtarılamaz |
| Telegram mesajı gelmiyor | `webhook_url` sonunda `/GIZLI_YOL` yok, `webhook_secret` farklı, bota `/start` yazılmamış, ya da `aktif = false` | Bölüm 4.7 SQL'ini tekrar çalıştır; Worker → Logs'a bak |
| Pages build'i "invalid byte sequence in US-ASCII" veya benzeri kodlama hatasıyla düşüyor | `LANG`/`LANGUAGE`/`LC_ALL` yok | Bölüm 5.2'deki üç Text değişkenini ekle, yeniden deploy et |
| Pages build'i `bundle: command not found` / gem hatası | Build command'da `bundle install` yok | Bölüm 5.1'deki komutu **aynen** kullan |
| Build komutu değişikliği etkisiz | Build cache eski | Settings → Build → Build cache → **Clear Cache**, sonra yeniden deploy |
| Kasa kuruldu ama yetkili kullanıcılar (owner/admin) da kilit ekranında kalıyor | `GK_COOKIE_SECRET` eksik ya da 32 karakterden kısa; `SUPABASE_URL` / `SUPABASE_ANON_KEY` o ortama (Production/Preview) girilmemiş | Bölüm 5.2-B tablosunu kontrol et, hem Production hem Preview'a gir, yeniden deploy et |
| Alan adı kilitliyken `/feed.xml`, `/rss.xml`, CV ve görseller `403` dönüyor | Beklenen davranış: rotaya bağlı varlıklar kilitli rotayla birlikte kapanır | Açmak istediğin dosya için `_middleware.js` içindeki `VARLIK_ROTALARI` / `ACIK_VARLIK_*` sabitlerini düzenle (Bölüm 5.2-B) |
| Akademik Kütüphane sekmesi hiç görünmüyor | Migration 0072 uygulanmadı ya da owner Yetki Ayarları'nda rolün için **Akademik Kütüphane**'yi kapattı | 0072'yi çalıştır; Yetki Ayarları matrisinde ilgili rolü aç |
| PDF açılmıyor: "Worker yapılandırması eksik (… AKADEMIK_BUCKET)" | R2 binding adı farklı yazılmış ya da eklenmemiş | Bölüm 4.9 adım 5: binding adı **`AKADEMIK_BUCKET`** olmalı, Deploy |
| PDF açılmıyor, konsolda CORS hatası | `IZINLI_ORIGINLER`'de site adresin yok ya da `AKADEMIK_WORKER_URL` yanlış | `worker.js` listesini ve `ortak.js` adresini düzelt |
| PDF açılıyor ama sayfalar çok yavaş yükleniyor | CSP'de `worker-src 'self' blob:` yok → PDF.js ana iş parçacığında çalışıyor | `_layouts/default.html` ve `_headers` CSP'sine `worker-src 'self' blob:;` ekle |
| "Okuyucu motoru yüklenemedi" | jsDelivr/unpkg engelli ya da seçilen PDF.js sürümü bozuk | Owner: ⚙️ Okuyucu motoru kartından bilinen iyi bir sürümü (varsayılan 5.6.205) sabitle |
| Kaydederken "imza yapılandırılmamış" (501) | PDF 90 MB'ın üstünde ve büyük dosya imzası secret'ları girilmemiş | Bölüm 4.9: `ACCOUNT_ID`, `BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` + kova CORS'u |
| Kaydederken 409 "PDF başka bir sekmede güncellenmiş" | Aynı PDF iki yerde düzenlenip biri kaydedildi | Okuyucuyu kapatıp yeniden aç, değişikliklerini tekrar uygula |
| Zamanlanmış yazı yayına çıkmıyor | `CLOUDFLARE_DEPLOY_HOOK_URL` GitHub'da yok ya da hook silinmiş | Bölüm 5.3 |

---

[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · [🍴 Fork Kurulumu](./03-fork-kurulumu.md) · **☁️ Cloudflare Secret & Ayarlar**

---
