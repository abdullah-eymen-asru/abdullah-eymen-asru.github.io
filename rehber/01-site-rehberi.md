[⬅️ README'ye dön](../README.md)

**📖 Site Rehberi** · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · [🍴 Fork Kurulumu](./03-fork-kurulumu.md)

---

# 📖 Site Rehberi — Hangi Dosya Ne İşe Yarar, Neyi Nerede Değiştiririm?


Bu dosya, siteyi bir daha açtığında ("bunu nereye koymuştum?") hızlıca
yön bulman için var. Her bölüm bir dosyayı/özelliği anlatıyor: ne işe
yarıyor, hangi satırı değiştirirsen ne olur.

---

## 0. Klasör yapısı — sayfalar neden alt klasörlerde?

Kök dizinin GitHub'da (dosya listesinde, commit geçmişinde) karışık
görünmemesi için tek tek sayfalar (Jekyll'in "pages" dediği `.md`
dosyaları) konularına göre 4 klasöre ayrılmıştır:

| Klasör | İçerik | Örnek URL |
|---|---|---|
| `hesap/` | Giriş, kayıt, şifre sıfırlama akışı | `/hesap/giris.html` |
| `panel/` | Oturum açmış kullanıcı sayfaları (panel, admin, GitHub içerik yönetimi, özel içerik) | `/panel/panel.html` |
| `icerik/` | Herkese açık içerik listeleri (blog, akademik projeler, izlediklerim, okuduklarim) | `/icerik/blog.html` |
| `kurumsal/` | İletişim, gizlilik politikası | `/kurumsal/iletisim.html` |

**Önemli:** Bu, sadece bu sayfaların repo'daki **kaynak dosya konumu**.
Her sayfanın front-matter'ında (`permalink:` alanı yoksa Jekyll klasör
yapısından otomatik üretir, buradaki sayfalarda URL klasör adını
birebir yansıtır — örn. `panel/panel.md` → `/panel/panel.html`) URL'ler
klasör yapısıyla tutarlıdır. Bir sayfayı bulmak istediğinde: URL'in ilk
parçası (`/panel/...`, `/hesap/...` vb.) hangi klasörde olduğunu
doğrudan söyler.

`index.md`, `index-bakim.md`, `_config.yml`, `_headers`, `Gemfile`,
`README.md`, `robots.txt`, `feed.xml` gibi Jekyll'in kökte durmasını
beklediği ya da tüm siteyi ilgilendiren dosyalar kökte kalmaya devam
eder — sadece "tek bir sayfaya ait" `.md` dosyaları klasörlere ayrılmıştır.

**Bir sayfanın URL'ini değiştirmek istersen:** ilgili dosyanın
front-matter'ındaki `permalink:` satırını değiştirmen yeterli, dosyayı
taşımana gerek yok. Ama URL'i değiştirirsen, o sayfaya link veren tüm
yerleri (nav menüsü `_layouts/default.html`, `assets/js/auth/nav-auth.js`,
`auth-guard.js`, `auth-pages.js` içindeki Supabase redirect URL'leri,
ilgili diğer `.md` sayfalarındaki iç linkler) da elle güncellemen
gerekir — aksi halde kırık link veya (giriş/şifre sıfırlama söz konusuysa)
sessizce çalışmayan bir akış ile karşılaşırsın.

---

## 1. `_config.yml` — Sitenin ana ayar dosyası

Jekyll build'inde her sayfaya `site.XXX` olarak erişilebilen tüm genel
değerler burada. En sık dokunacağın dosya.

| Alan | Ne işe yarar |
|---|---|
| `title` | Site başlığı, sekme adı, header'daki logo yazısı |
| `description` | SEO açıklaması, sosyal medya paylaşım kartlarında görünür |
| `url` | Sitenin birincil adresi (Cloudflare Pages domainin) |
| `github_username` | GitHub kullanıcı adın |
| `kutuphane_repo` | İzlediklerim/okuduklarım verisinin tutulduğu ayrı repo |
| `izleme_projects_url` / `okuma_projects_url` | GitHub Projects panolarının linkleri |
| `substack_url` | Substack blog adresin |
| `substack_feed` | RSS feed adresin — **sadece referans amaçlı**, blog sayfasının kullandığı asıl adres `cloudflare worker/substack_feed_proxy_worker/worker.js` içindeki `FEED_URL` sabitinde (bkz. bölüm 5 ve `03-fork-kurulumu.md` Bölüm 6b) |
| `google_analytics_id` | Google Analytics ölçüm kimliği |
| `profile_image` | Profil fotoğrafın (`assets/`e yükleyip yolunu buraya yaz) |
| `cloudflare_worker_url` | İzleme/okuma verisini çeken Worker'ın adresi |
| `mirror_site_url` | Yedek/ikincil site adresin (GitHub Pages) |
| `giscus:` altındaki alanlar | Yorum sistemi (giscus.app'ten alınır) — `category` için "Announcements" tipi bir kategori seçmen önerilir, böylece yorum başlığını sadece sen/giscus botu açabilir |
| `social:` altındaki linkler | GitHub, LinkedIn, X/Twitter, Instagram, YouTube, n-sosyal, ORCID, Academia, ResearchGate, 1000Kitap, Play Store |
| `future` | `true` kalmalı — zamanlanmış/gizli yazıların çalışması buna bağlı, bkz. bölüm 9 |

## 2. `_config_cloudflare.yml` — Sadece Cloudflare build'ine özel ek ayarlar

Cloudflare Pages build komutunda `--config _config.yml,_config_cloudflare.yml`
ile birlikte okunur; buradaki anahtarlar `_config.yml`'deki aynı isimli
anahtarların üzerine yazar. Şu an sadece `google_analytics_id` burada —
Cloudflare build'i için ayrı bir Analytics ID istersen kullan, aynı ID'yi
kullanacaksan bu dosyaya dokunmana gerek yok.

## 3. `_headers` — Cloudflare Pages güvenlik header'ları

Kök dizinde duran bu dosya, Cloudflare Pages tarafından otomatik okunur
(bir ayar paneline eklemene gerek yok — dosyanın repo'da olması yeterli).
Her sayfaya `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `Strict-Transport-Security` header'larını ekler.
**Sadece Cloudflare Pages'te çalışır** — GitHub Pages özel HTTP header
ayarlamayı desteklemiyor, o yüzden mirror sitede bu korumalar yok.

Değiştirmek isteyebileceğin tek yer: `Permissions-Policy` satırındaki
`camera=(), microphone=(), geolocation=(), payment=()` — ileride bu
API'lerden birini gerçekten kullanacaksan (örn. bir harita gömersen ve
konum istersen), ilgili parantezin içine `(self)` yazman gerekir.

## 4. `kurumsal/iletisim.md` — İletişim formu

`src="FORM-EMBED-LINKINI-BURAYA-YAPISTIR"` satırındaki placeholder'ı,
Google Forms'tan aldığın gerçek embed linkiyle değiştir (Forms'ta
Gönder > `<>` ikonu > `src=` değerini kopyala).

## 5. `cloudflare-worker/worker.js` — İzlediklerim/Okuduklarım verisini çeken Worker

Bu dosya Cloudflare Dashboard'a **ayrıca** yapıştırılıp deploy edilmesi
gereken ayrı bir kod — repo'daki kopyası sadece kaynak/yedek, canlıya
otomatik yansımaz. Değiştirdiğinde Cloudflare Dashboard'da "Save and
Deploy" yapman gerekir.

| Ne | Nerede | Nasıl değiştirilir |
|---|---|---|
| GitHub kullanıcı adı | `GITHUB_LOGIN` sabiti (dosyanın başı) | Tırnak içindeki değeri kendi kullanıcı adınla değiştir |
| Proje numaraları | `PROJECTS` objesi içinde `number:` | GitHub Projects panosunun URL'indeki `/projects/N/` sayısı |
| **Sütun sırası** | `PROJECTS` objesi içinde her projenin `sutunSirasi:` dizisi | Panoda sütunları sürükleyip yer değiştirdiğinde site OTOMATİK güncellenmez (GitHub API view-sırasını döndürmüyor) — panodaki güncel sırayı, sütun adlarını BİREBİR yazımla (büyük/küçük harf dahil), soldan sağa bu diziye elle yaz. Listede unuttuğun bir alan otomatik sona eklenir, kaybolmaz. `sutunSirasi: []` bırakırsan GitHub'daki field oluşturma sırası kullanılır. |
| Gizlenen "yerleşik" sütunlar | `YERLESIK_ALANLAR` seti | GitHub'ın otomatik eklediği sistem alanları (Assignees, Labels, Reviewers, Created, Updated, vb.) burada listeleniyor ve tabloya hiç girmiyor. GitHub ileride yeni bir sistem alanı eklerse ve sitede gereksiz bir sütun görürsen, o alanın adını (BİREBİR yazımla) bu sete ekle. |
| `GITHUB_TOKEN` | **Kodun içinde YOK** | Cloudflare Dashboard > Settings > Variables and Secrets kısmından secret olarak eklenir. Asla dosyaya yazma. |

## 5.1 `cloudflare worker/izleme_okuma_yonetim_worker/worker.js` — İzleme/Okuma panosuna YAZMA Worker'ı

Yukarıdaki (§5) Worker sadece **okur** (herkese açık, siteyi besler). Bu
Worker ise **yazar**: `/panel/izleme-okuma-yonetim.html` sayfasından
gönderilen formu alıp `kutuphane_repo`'da yeni bir Issue açar, ilgili
Projects panosuna ekler ve panodaki sütunları doldurur. Bu yüzden ayrı bir
Cloudflare Worker olarak deploy edilmesi ve **ayrı bir secret seti**
kullanması gerekiyor — okuma Worker'ıyla aynı PAT'ı paylaşmak, en az
ayrıcalık ilkesini bozar (okuma Worker'ı asla yazma yapabilme ihtimaline
sahip olmamalı).

| Ortam Değişkeni/Secret | Nereden alınır |
|---|---|
| `GITHUB_TOKEN` | GitHub'da `kutuphane_repo` için **Issues: Read and write** + **Projects: Read and write** izinli bir Fine-grained PAT (ya da Classic PAT ile `repo` + `project` scope'u). Cloudflare Dashboard > Settings > Variables and Secrets kısmına **Secret** olarak eklenir. |
| `SUPABASE_URL` | Supabase projenin URL'i (diğer Worker'larla aynı) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard > Settings > API > `service_role` anahtarı (**Secret** olarak) |

Deploy ettikten sonra Cloudflare'den aldığın adresi
`assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim.js` dosyasının
başındaki `IZLEME_OKUMA_WORKER_URL` sabitine yapıştırman gerekir
(r2_storage_worker / github_icerik_yonetim_worker ile aynı desen).

**Erişim:** Bu sayfa ve Worker **SADECE `owner` (Site Sahibi) rolüne**
açıktır — `editor`/`manager`/`admin` dahi giremez, çünkü bu pano site
sahibinin kişisel izleme/okuma kaydıdır, bir editöre devredilebilecek bir
"site içeriği" değildir. Kendi rolünü Supabase'te `profiles` tablosundan
`owner` olarak ayarlaman gerekir (bkz. `supabase/site-sahibi-atama.sql`).

**Label'lar:** Worker, issue açarken repoya otomatik olarak `izleme` /
`okuma` etiketini ekler (yoksa kendisi oluşturur) — sen zaten bu isimlerle
elle etiket oluşturmuşsan onu bozmadan kullanır.

**Sayfanın iki bölümü:**
- **Yeni Kayıt Ekle** — başlık + açıklama (issue body) + panodaki dinamik
  alanları doldurup yeni bir issue açar.
- **Mevcut Kayıtlar** — panodaki tüm kayıtları listeler; başlık, açıklama
  ve alan değerleri içinde arama yapılabilir (arama tamamen tarayıcıda,
  ilk yüklemeden sonra anlık çalışır). Bir kayda tıklayınca başlığını,
  açıklamasını ve tüm alan değerlerini düzenleyip **Güncelle** ile GitHub'a
  geri yazabilirsin.

## 5.2 `cloudflare worker/substack_feed_proxy_worker/worker.js` — Substack RSS feed proxy'si

Substack'in RSS feed'i tarayıcıdan doğrudan çekilemiyor (CORS izni
vermiyor); bu Worker feed'i sunucu tarafında çekip CORS başlığı ekleyerek
geri döndürüyor. Daha önce bunun yerine ücretsiz, herkese açık bir üçüncü
parti proxy (`api.allorigins.win`) kullanılıyordu — o servisin uptime
garantisi olmadığı ve zaman zaman tamamen kesildiği için (Substack
yazılarının hiç yüklenmemesine yol açan hata) kendi Worker'ımızla
değiştirildi.

Genel bir CORS proxy'si DEĞİLDİR — yalnızca dosyanın başındaki `FEED_URL`
sabitinde tanımlı, sabit tek bir adresi çeker; rastgele bir URL parametresi
kabul etmez. Secret gerekmez. Kurulum adımları için `03-fork-kurulumu.md`
Bölüm 6b'ye bak.

## 6. `robots.txt`

`Sitemap:` satırındaki adres, `_config.yml`'deki `url` ile aynı domaini
göstermeli.

## 7. `_includes/hakkimda-icerik.md` ve `_includes/hakkimda-kutusu.md`

Anasayfada görünen "hakkımda" metni ve kutusu — biyografini, unvanını,
tanıtım yazını buraya serbest metin olarak yaz.

## 8. İçerik ekleme — blog yazıları ve akademik projeler

- **Blog yazısı:** `_posts/YIL/` klasörüne `YIL-AY-GUN-baslik.md` formatında
  yeni bir dosya ekle (örn. `_posts/2026/2026-09-01-yeni-yazi.md`). `icerik/blog.md`
  sayfasına hiç dokunmana gerek yok, otomatik listelenir.
  **Neden yıl alt klasörü:** Jekyll için `_posts/` koleksiyonundaki dosyanın
  hangi ALT KLASÖRDE durduğunun hiçbir önemi yok — permalink her zaman
  dosya ADINDAKİ (`YYYY-AY-GUN-slug.md`) tarih ve slug'dan üretilir. Yani
  `_posts/2026/2026-09-01-yeni-yazi.md` ile eskiden olduğu gibi düz
  `_posts/2026-09-01-yeni-yazi.md` **birebir aynı URL'i** üretir — bu
  sadece yazı sayısı arttıkça `_posts/` klasörünün tek bir uzun liste
  olmasını önlemek için bir organizasyon kolaylığı. Panel
  (`github-yonetim.js`) yeni yazıları VARSAYILAN olarak ilgili yıl
  klasörüne yazar; klasör yoksa GitHub API onu ilk dosyayla birlikte
  kendiliğinden oluşturur. Alt klasörleme öncesinden kalma, hâlâ
  `_posts/` kökünde duran eski dosyalar da bozulmadan listelenmeye ve
  çalışmaya devam eder — geriye dönük bir taşıma/migrasyon **zorunlu
  değildir**, istersen zamanla elle ilgili yıl klasörüne taşıyabilirsin.
  **Klasörü kendin de seçebilirsin:** panelin "İçerik Ekle / Düzenle"
  formunda, blog türü seçiliyken görünen "Klasör" alanı sayesinde
  otomatik yıl davranışını bırakıp dosyayı mevcut bir klasöre (örn. farklı
  bir yıl, ya da konuya göre `_posts/seyahat/`) kaydedebilir, ya da aynı
  formdan "➕ Yeni klasör oluştur…" seçeneğiyle anında yeni bir klasör
  belirleyebilirsin. "Otomatik" seçili kalırsa hiçbir şey değişmez, eski
  davranış aynen sürer. Klasörleri ayrıca "📁 Klasörler" sekmesinden de
  oluşturabilir, yeniden adlandırabilir (içindeki tüm yazılar otomatik
  taşınır) veya BOŞ bir klasörü silebilirsin — bkz. Bölüm 10a.
- **Akademik proje:** `_projects/` de blog yazıları gibi alt klasörlenir —
  aynı "Klasör" seçici ve aynı "Otomatik" (tarihin yılına göre, örn.
  `_projects/2026/`) davranışı proje formunda da vardır ve `_posts/` ile
  birebir simetriktir. Panel, örneğin `_projects/2026/yeni-proje.md`
  şeklinde bir dosya oluşturur. `_projects` koleksiyonunun permalink'i
  `_config.yml`'de `/projects/:name/` olarak tanımlıdır — yani URL
  SADECE dosya adından (`:name`) üretilir, hangi alt klasörde durduğu
  hiçbir etkisi yoktur; tıpkı blog yazılarında olduğu gibi. Kullanılabilecek
  front-matter alanları için `_projects/2025-ornek-proje.md` dosyasındaki
  örneğe bak (`title`, `date`, `venue`, `status`, `summary`, `link`,
  `link_label`). Ayrıca "dosya adına yıl öneki ekle" seçeneği (örn.
  `2026-proje-adi.md`) klasörlemeden TAMAMEN bağımsızdır — ikisi birlikte
  de, ayrı ayrı da kullanılabilir.

## 9. Zamanlanmış ve gizli yazılar/projeler

> **📌 Güncelleme:** `/panel/github-yonetim.html` paneli artık "Yayında"
> anahtarı kapalıyken içeriği bu bölümde anlatıldığı gibi `yayinda: false`
> + tahmin edilemez bir `permalink` ile GitHub'a HİÇ commit ETMİYOR —
> içerik bunun yerine sadece Supabase'teki `taslak_icerikler` tablosunda
> duruyor, GitHub'a hiç dokunulmuyor (bkz. Bölüm 10'daki "Supabase Taslak
> Sistemi" alt başlığı ve `rehber/02-supabase-sistemi.md`). Aşağıdaki
> `yayinda: false` + `permalink` yöntemi hâlâ ÇALIŞIR (Jekyll seviyesinde
> hiçbir şey kaldırılmadı) ve **sadece** ileri tarihli otomatik yayınlama
> senaryosu için (`yayinda: true` + gelecek `date`) hâlâ birebir
> kullanılıyor — ama panel artık kalıcı/süresiz gizli içerik için bu
> yöntemi ÜRETMİYOR, çünkü dosya reponun herkese açık git geçmişinde
> durmaya devam ediyordu (sadece adresi paylaşılmadığı için "gizli"
> sayılıyordu). Dosyayı elle (GitHub arayüzünden veya Git ile) düzenleyen
> biri isterse aşağıdaki yöntemi yine de kullanabilir, ama artık önerilen
> yol değil.

Bir yazıyı ya da akademik projeyi GitHub'a hemen ekleyip, sitede **istediğin
tarihe kadar veya sen izin verene kadar** görünmemesini sağlayabilirsin.

### Nasıl çalışır?

**"yayinda" ve "date" artık birbirine bağlı çalışıyor.** Bir yazı/proje
sitede görünmek için **iki şartı BİRDEN** sağlamalı:

1. `yayinda: false` YAZILMAMIŞ olmalı (alan yoksa veya `true` ise sorun yok).
2. `date` alanındaki tarih **gelmiş veya geçmiş** olmalı (gelecekteyse gösterilmez).

Yani:

- `yayinda: true` + `date` **ileri bir tarih** → tarih gelene kadar
  **gösterilmez**, tarih geldiği an (bir sonraki build'de) otomatik görünür.
- `yayinda: true` + `date` **bugün veya geçmiş** → hemen görünür.
- `yayinda: false` + `date` **geçmiş bir tarih olsa bile** → yine de
  **gösterilmez**, sen elle `yayinda: true` yapmadan asla görünmez.
- `yayinda: false` her zaman `yayinda: true`'dan **önceliklidir** —
  yani `date` ne olursa olsun `yayinda: false` varsa sayfa gizlidir.

Front-matter'a şu iki alanı ekle:

```yaml
---
title: "Yazı Başlığı"
date: 2026-09-01
yayinda: true
sitemap: false
permalink: /blog/on-izleme-RASTGELE-BIR-DIZI/
---
```

- **`sitemap: false`**, gizli/zamanlanmış her yazıyla HER ZAMAN birlikte
  yazılmalı (`yayinda: false` olsun ya da ileri tarihli olsun fark etmez).
  Bu, `jekyll-sitemap` eklentisinin kendi tanıdığı resmi bir alan — sadece
  bunu görürse sayfayı `sitemap.xml`'den çıkarıyor, bizim uydurduğumuz
  `yayinda`/`date` mantığını tanımıyor. Yazmazsan sayfa blog listesinde
  görünmez ama sitemap'te görünmeye devam eder.
- **Görünürlük şartları sağlanmadığı sürece** yazı: blog listesinde
  (`icerik/blog.md`), akademik projeler listesinde (`icerik/akademik-projeler.md`) ve
  RSS feed'inde (`feed.xml`) **görünmez**. `sitemap: false` de site
  haritasından (sitemap.xml) çıkarır. Arama motorlarına ayrıca `noindex`
  sinyali gönderilir (sayfa ziyaret edilse bile indekslenmez) — bu artık
  hem `yayinda: false` hem de "date henüz gelmedi" durumunda otomatik
  devreye giriyor.
- **Sayfanın kendisi yine de var olur** — `permalink` alanında yazdığın
  adresi bilen biri doğrudan girip okuyabilir. Bu senin "manuel paylaşım"
  yöntemin: linki kimseyle paylaşmazsan kimse bulamaz; paylaştığın anda o
  kişi (ve linkin gittiği herkes) okuyabilir.
- **`permalink` MUTLAKA tahmin edilemez, rastgele bir dizi içermeli** —
  `/blog/on-izleme-x7k2p9qz/` gibi. `/blog/yeni-yazi/` gibi tahmin
  edilebilir bir adres KULLANMA, güvenlik tamamen bu adresin gizli
  kalmasına dayanıyor. Rastgele bir dizi üretmek için:
  - Tarayıcının adres çubuğuna `javascript:alert(crypto.randomUUID())`
    yazıp Enter'a basabilirsin (bazı tarayıcılar `javascript:` yapıştırmayı
    engeller, o zaman DevTools > Console'a `crypto.randomUUID()` yaz).
  - Ya da terminalde: `openssl rand -hex 8`
- **`sitemap: false`, görünürlük şartlarından TAMAMEN bağımsız çalışır.**
  Yani front-matter'a elle `sitemap: false` yazmazsan, `yayinda`/`date`
  ne olursa olsun sayfa sitemap.xml'e girer. Zamanlanmış/gizli her yazıda
  bunu yazmayı unutma — `noindex` yine indekslenmesini engeller, ama
  URL'in kendisi sitemap üzerinden "keşfedilebilir" hale gelir.
- **`permalink` alanını silersen** Jekyll dosya adından otomatik bir adres
  üretir (örn. `/blog/2026/09/01/yazi-basligi.html`) — bu tahmin
  edilebilir bir adres olduğu için SADECE normal, açık yazılarda
  `permalink`'i silmelisin. Gizli/zamanlanmış bir yazıda `permalink`'i
  silmek, gizlilik amacını tamamen ortadan kaldırır.
- **Erken yayınlamak istersen** (tarih gelmeden görünsün istersen):
  `date`'i geçmişe çek ya da bugüne eşitle.
- **Bir yazıyı süresiz gizli tutmak istersen:** `yayinda: false` yaz,
  `date`'i hiç düşünme — `yayinda: false` her zaman kazanır.
- **"Belirli bir tarihte otomatik yayınlansın" istersen:** `date:`
  alanını istediğin tarihe ayarlaman ve `yayinda: true` (ya da alanı hiç
  yazmaman) **artık tek başına yeterli** — ama bunun gerçekten
  "otomatik" olması için Cloudflare Pages'in o tarihte YENİ BİR BUILD
  alması gerekiyor, çünkü statik site build zamanındaki tarihe göre
  üretiliyor. Bunun için repo'ya bir GitHub Actions workflow'u eklendi:
  `.github/workflows/zamanlanmis-yayin.yml`. Bu workflow her gün otomatik
  çalışıp Cloudflare Pages'te yeni bir build tetikliyor. **Kurulumu
  (bir kereye mahsus):**
  1. Cloudflare Pages projenin ayarlarından **Deploy Hooks** (Dağıtım
     Kancaları) bölümüne git, yeni bir **Deploy Hook URL** oluştur.
  2. GitHub reponda **Settings → Secrets and variables → Actions →
     New repository secret** ile `CLOUDFLARE_DEPLOY_HOOK_URL` adında bir
     secret oluştur, değerine az önce kopyaladığın URL'i yapıştır.
  3. Bu kadar — workflow her gün otomatik çalışacak. İstersen GitHub'da
     **Actions** sekmesinden **"Run workflow"** ile elle de tetikleyebilirsin
     (örneğin tarihi tam geçtiği an hemen yayınlanmasını istiyorsan).
  4. Cron saatini değiştirmek istersen workflow dosyasındaki `cron:`
     satırını düzenle (yorum satırında açıklama var).
- Örnek bir taslak dosya için `_posts/2026/2026-08-15-ornek-zamanlanmis-yazi.md`
  dosyasına bak (yıl alt klasörü içinde — bkz. Bölüm 8) — aynı desen
  `_projects/` için de birebir çalışır (örnek alanlar
  `_projects/2025-ornek-proje.md` içinde yorum satırı olarak var).

### Nerede tanımlı (teknik detay, dokunmana gerek yok ama bilgi için)

- `_config.yml` → `future: true` — sayfanın gelecek tarihli olsa da
  build edilmesini sağlıyor (linkin çalışabilmesi için şart).
- `icerik/blog.md`, `icerik/akademik-projeler.md`, `feed.xml` → listeleme
  döngülerinde `where_exp: "p", "p.yayinda != false" | where_exp: "p", "p.date <= site.time"`
  filtre zinciri — `yayinda` ve `date` şartlarını art arda iki ayrı
  `where_exp` ile kontrol ediyor (GitHub Pages'in kullandığı Liquid
  sürümü, tek bir `where_exp` içine `and` ile yazılmış birleşik
  ifadeleri her zaman doğru parse edemiyor; iki ayrı filtre zincirlemek
  hem GitHub Pages hem Cloudflare/yerel Jekyll'de güvenilir çalışıyor).
- `sitemap.xml` → `jekyll-sitemap` eklentisi tarafından otomatik
  üretiliyor, front-matter'daki resmi `sitemap: false` alanına kendisi
  bakıyor (bizim `yayinda`/`date` mantığımızdan habersiz, o yüzden ayrı
  yazılması gerekiyor).
- `feed.xml` dosyasının kendisi kökte elle yazılmış durumda — Jekyll'in
  otomatik `jekyll-feed` eklentisi BİLEREK kapatıldı (`_config.yml` ve
  `Gemfile`'den çıkarıldı) çünkü o eklentinin kendi "published: false"
  alanı sayfayı build'den tamamen siliyor, bu da gizli linki kırıyordu.
- `_layouts/default.html` → `page.yayinda == false` VEYA `page.date`
  henüz gelmemişse `<meta name="robots" content="noindex, nofollow">`
  ekliyor.
- `_layouts/post.html`, `_layouts/project.html` → aynı iki durumda
  (gizli ya da henüz zamanı gelmemiş) sayfanın üstünde uygun bir uyarı
  gösteriyor.
- `.github/workflows/zamanlanmis-yayin.yml` → günlük otomatik Cloudflare
  Pages build tetikleyicisi (yukarıdaki kurulum adımlarına bak).

## 10. `panel/github-yonetim.md` — GitHub Pages için tarayıcı içi içerik yönetim paneli (mini CMS)

Bölüm 8 ve 9'da anlatılan işi (yeni `_posts/`/`_projects/` dosyası
oluşturma, `yayinda`/`sitemap`/`permalink` alanlarını elle yazma) artık
elle dosya oluşturup GitHub'a push etmeden, doğrudan tarayıcıdan
yapabileceğin bir panel var: **`/panel/github-yonetim.html`**. Netlify/Decap CMS
gibi 3. parti bir servise ihtiyaç duymaz — doğrudan GitHub REST API'sine
(`contents` endpoint'i) istek atıp commit oluşturur, tamamen GitHub
Pages'in kendisiyle çalışır.

**Bu panel, sitenin Supabase tabanlı `/panel/admin.html` panelinden
kullanıcı/rol/özel-içerik yönetimi açısından TAMAMEN BAĞIMSIZDIR** — ama
artık "yayında değil" (taslak) blog yazıları ve akademik projeler için
AYNI Supabase projesini kullanıyor (bkz. aşağıdaki "Supabase Taslak
Sistemi" alt başlığı). `/panel/admin.html` Supabase'teki üye/rol/özel
içerik sistemini yönetir; `/panel/github-yonetim.html` ise bu deponun
statik Jekyll içeriğini (blog yazıları, akademik projeler, profil
fotoğrafı) yönetir. Erişim kontrolü ortak: bu sayfaya erişim de aynı
`requireAuth({ role: 'admin' })` mekanizmasıyla korunur (bkz.
`assets/js/auth/auth-guard.js`), yani sadece Supabase'te `role: 'admin'` olan
hesaplar görebilir — taslak tablosunun RLS politikası bunu veritabanı
seviyesinde ayrıca zorunlu kılar. Header'daki **"Hesabım ▾"** menüsünde,
adminsen "Admin Paneli" linkinin hemen altında **"GitHub İçerik
Yönetimi"** olarak görünür (bkz. `assets/js/auth/nav-auth.js`).

### Paketteki dosyalar

```
panel/github-yonetim.md                          <- Jekyll sayfası (_layouts/default.html'i kullanır, admin-only)
assets/js/github-yonetim/github-yonetim.js       <- Panelin tüm mantığı
assets/css/github-yonetim.css                    <- Bu sayfaya özel ek stiller (auth.css'in üzerine eklenir)
onizleme/index.md                                <- Jekyll sayfası: /onizleme/ — gizli ön izleme linklerinin açıldığı yer
assets/js/github-yonetim/onizleme.js             <- /onizleme/ sayfasının mantığı (Supabase RPC'sini okur)
supabase/migrations/0013_...sql                  <- `taslak_icerikler` tablosu + RLS + `taslak_onizleme_getir` RPC'si
```

### Supabase Taslak Sistemi — "Yayında değil" içerik artık GitHub'a hiç gitmiyor

Panelin en önemli mimari kararı: **bir içerik, her zaman ya GitHub'da
(yayında) ya da Supabase'de (gizli) durur — iki yerde birden asla
durmaz.**

- **"Yayında" anahtarı KAPALIYKEN kaydedersen:** içerik GitHub'a hiç
  commit edilmez. Bunun yerine Supabase'teki `taslak_icerikler` tablosuna
  (başlık, tarih, gövde, proje alanları, yayınlanınca gideceği dosya yolu
  ve gizli ön izleme kodu ile birlikte) yazılır. Bu tablo RLS ile
  korunur: sadece admin rolündeki Supabase hesapları okuyup/yazabilir —
  ön izleme linkine sahip anonim bir ziyaretçi bile tabloyu LİSTELEYEMEZ,
  sadece aşağıda anlatılan RPC üzerinden tur+kod tam eşleşen TEK satırı
  görebilir.
- **Gizli ön izleme linki artık `/onizleme/?tur=<blog|proje>&kod=<kod>`
  formatındadır** (eski `/blog/on-izleme-XXXX/` formatı YERİNE — panel
  artık bu yeni formatta linkler üretir). `/onizleme/index.md` sayfası,
  `assets/js/github-yonetim/onizleme.js` aracılığıyla URL'deki tur+kod'u Supabase'teki
  `taslak_onizleme_getir(p_tur, p_kod)` RPC'sine sorar; bu RPC
  `SECURITY DEFINER` olduğu için RLS'i by-pass eder ama SADECE tam
  eşleşen tek satırı ve sadece görüntüleme için gereken alanları
  döndürür — tabloyu listelemeye izin vermez. Giriş yapmamış bir
  ziyaretçi de (tıpkı eski sistemde olduğu gibi) bu linki açabilir.
- **"Yayınla" butonuna basınca (formdan "Yayında"yı açıp kaydetmek ya da
  listedeki "Yayınla" butonuna basmak):** taslağın içeriği front-matter'a
  dönüştürülüp hedef yola (`taslak_icerikler.dosya_yolu` — taslak
  kaydedilirken seçilen klasör dahil) GitHub'a commit edilir, ardından
  Supabase'teki taslak satırı silinir.
- **"Yayından Kaldır" butonuna basınca (o an GitHub'da yayında olan bir
  içerik için):** GitHub'daki dosyanın front-matter'ı + gövdesi okunup
  Supabase'e taslak olarak yazılır (aynı gizli kod korunur — bkz.
  aşağıdaki not), ardından GitHub'daki dosya silinir.
- **Ön izleme kodu, yayında olsa bile front-matter'da gizli bir
  `onizleme_kod` alanında saklanmaya devam eder** (görünmez, sayfa
  render'ında kullanılmaz) — tıpkı eski sistemdeki gibi. Böylece bir
  yazı önce gizli paylaşılıp linki birine gönderildikten sonra yayına
  alınır, bir süre sonra tekrar "Yayından Kaldır" ile gizlenirse **daha
  önce paylaşılan aynı link** geri döner.
- **Eski sistemden kalma, hâlâ GitHub'da `yayinda: false` olarak duran
  bir dosya bulunursa** (bkz. Bölüm 9'daki güncelleme notu), kartında
  "Yeniden Yayınla" yerine **"Supabase'e Taşı"** butonu görünür — bu da
  aynı "GitHub'dan Supabase'e taşı" işlemini yapar, böylece o içerik de
  artık reponun herkese açık git geçmişinde durmaz.
- Panelin "Mevcut İçerikler" listesinde Supabase'teki taslaklar **"Gizli"**
  rozetinin yanında ayrıca bir **"Supabase"** rozetiyle işaretlenir, GitHub
  dosyaları için bu rozet görünmez.

### Neler yapabilirsin

- **Blog yazısı / Akademik proje ekle veya düzenle** — içerik türünü
  seçtiğinde form alanları otomatik değişir (proje seçilince `venue`,
  `status`, `summary`, `link`, `link_label` alanları da görünür). Dosya
  adı (slug) boş bırakılırsa başlıktan otomatik üretilir (Türkçe
  karakterler sadeleştirilir).
- **"Yayında" anahtarını kapatırsan** (modern bir toggle switch; klasik
  onay kutusu değil) içerik GitHub'a HİÇ commit edilmez — panel onu
  Supabase'teki `taslak_icerikler` tablosuna yazar ve 8 karakterlik
  rastgele bir kodla (`crypto.getRandomValues` ile üretilir, tahmin
  edilemez) gizli bir ön izleme linki oluşturur
  (`/onizleme/?tur=blog&kod=XXXXXXXX` ya da `?tur=proje&kod=XXXXXXXX`) —
  bkz. yukarıdaki "Supabase Taslak Sistemi" alt başlığı.
  **Bu link tek seferlik değildir ve düzenlenebilir:** anahtarı kapatır
  kapatmaz, taslağı hiç kaydetmeden önce bile ekranda görünür — kodu
  olduğu gibi kullanabilir, kutuya kendi kodunu elle yazabilir veya
  "🎲 Yenile" butonuyla yeni bir rastgele kod üretebilirsin. Kaydettikten
  sonra da ekranda kalır, anahtarı kapatıp açtığında anında
  görünür/gizlenir, "Mevcut İçerikler" listesinden aynı taslağı tekrar
  "Düzenle"ye açtığında da aynı link otomatik olarak yeniden gösterilir.
  Link, sen bilerek değiştirmediğin sürece her düzenlemede **aynı
  kalır**, böylece daha önce birine gönderdiğin bir ön izleme linki
  içeriği güncellesen bile kırılmaz. Panel, aynı türde (blog/proje)
  başka bir içeriğin (GitHub'da ya da Supabase'de) zaten kullandığı bir
  kodu tekrar kaydetmene izin vermez (çakışma kontrolü) — böyle bir
  durumda hata mesajıyla uyarır. `/onizleme/` sayfasında da içeriği
  görüntülerken "henüz yayında değil" uyarısı görünür, böylece linke
  sahip olan biri durumundan haberdar olur.
- **Yayınlama / yayından kaldırma — kartlar üzerinden tek tıkla:**
  "Mevcut İçerikler" listesindeki her kartta, Supabase'teki taslaklar
  için **"Yayınla"** (GitHub'a commit eder, taslak satırı silinir), o an
  GitHub'da yayında olan içerikler için **"Yayından Kaldır"** (Supabase'e
  taşır, GitHub dosyasını siler) butonu var. Formu açıp toggle'ı çevirip
  tekrar kaydetmene gerek kalmadan tek tıkla (bir onay penceresinden
  sonra) işlemi tamamlar. **Önemli — link yayın durumundan bağımsız
  hatırlanır:** kod, içerik GitHub'da "Yayında" olsa bile front-matter'da
  gizli bir `onizleme_kod` alanında saklanmaya devam eder (görünmez,
  sayfa render'ında kullanılmaz). Yani bir yazıyı önce gizli paylaşıp
  linkini birine gönderdikten sonra yayına alıp, bir süre sonra tekrar
  "Yayından Kaldır" ile gizlersen, **daha önce paylaştığın aynı link**
  geri döner — yeni bir kod üretilmez, eski link kırılmaz. Kod sadece
  formu açıp "🎲 Yenile" ile bilerek değiştirirsen farklılaşır. Gizli
  veya daha önce gizlenmiş bir içeriğin kartında ayrıca **"🔗 Linki
  Kopyala"** butonu görünür — formu hiç açmadan ön izleme linkini
  doğrudan panoya kopyalayabilirsin.
- **Genişletilmiş Markdown editör araç çubuğu** — metin alanının üstünde,
  gruplanmış butonlarla şu araçlar var:
  - **Biçimlendirme:** kalın, italik, üstü çizili, satır içi kod.
  - **Başlıklar:** H2, H3, H4 (`## `, `### `, `#### `) — hepsi metnin
    kendi satırına, önceki/sonraki içerikten boş satırla ayrılarak eklenir.
  - **Listeler:** madde işaretli liste, numaralı liste, yapılacaklar
    listesi (`- [ ] `) — çok satırlı bir seçim yapılırsa HER satıra ayrı
    ayrı önek eklenir.
  - **Bloklar:** alıntı (`> `), kod bloğu (dil adını isteğe bağlı sorar,
    örn. `js`/`python`/`bash` — boş bırakılabilir), yatay çizgi (`---`),
    2 sütunluk doldurulmaya hazır tablo şablonu.
  - **Bağlantı ve görsel:** bağlantı, seçili metni link haline getirir.
    Görsel butonu SADECE dış bir URL'e göre `![açıklama](url)` üretir —
    panel GitHub'a görsel dosyası YÜKLEMEZ, görselin başka bir yerde
    (örn. bir CDN, resim barındırma servisi ya da başka bir repo) zaten
    yayında olması ve URL'inin elde olması gerekir. Alt metin (açıklama)
    ayrıca ve isteğe bağlı olarak sorulur — erişilebilirlik ve SEO için
    doldurulması önerilir, boş bırakılabilir.
  - Genel davranış: bir metin seçiliyken buton tıklanırsa seçili metin
    ilgili biçimle sarmalanır/önekli hale gelir; hiçbir şey seçili değilse
    açıklayıcı bir yer tutucu metin eklenir ve o metin otomatik olarak
    seçili bırakılır, böylece hemen üzerine yazabilirsin.
- **Mevcut İçerikler** sekmesi — `_posts/` ve `_projects/` klasörlerindeki
  tüm dosyaları listeler (yayında/gizli durumunu rozetle gösterir),
  "Düzenle" ile formu doldurup güncelleyebilir, "Sil" ile GitHub'dan
  kalıcı olarak silebilirsin. İçerik sayısı arttıkça listede kaybolmamak
  için üstte bir **arama kutusu** (başlık, dosya yolu ve özet içinde arar,
  eşleşen kısmı vurgular) ve iki grup **filtre sekmesi** var: içerik
  türüne göre (Tümü / Blog / Projeler) ve yayın durumuna göre (Tümü /
  Yayında / Gizli) — ikisi birlikte kullanılabilir, sonuç yoksa bunu
  ayrıca belirten bir mesaj gösterilir.
- **Profil Fotoğrafı Yönetimi** sekmesi — `assets/profil.jpg` dosyasının
  var olup olmadığını GitHub API üzerinden kontrol edip önizlemesini
  gösterir; yeni bir görsel seçip "Yükle/Değiştir" ile değiştirebilir,
  "Profil Fotoğrafını Sil" ile tamamen kaldırabilirsin.

### GitHub bağlantısı ve token güvenliği

**Mimari değişti — artık PAT tarayıcına hiç girmiyor.** Panel GitHub'a
doğrudan değil, bir Cloudflare Worker (`cloudflare worker/github_icerik_worker/`)
üzerinden konuşur:

- Worker, GitHub'a yazma izinli PAT'ı **kendi Cloudflare secret'ı** olarak
  tutar — hiçbir zaman tarayıcıya, localStorage'a ya da bellek dahi olsa
  panelin JS'ine gelmez.
- Panel, kimlik kanıtı olarak (PAT yerine) senin zaten sahip olduğun
  **Supabase oturum token'ını** Worker'a gönderir. Worker bu token'ı
  doğrulayıp Supabase'teki rolünü okur ve HEM kimlik HEM rol HEM DE hangi
  dosya yoluna yazılmak istendiğini kontrol eder: `_posts/`/`_projects/`
  → editor/manager/admin, `assets/`/`_config.yml` → sadece admin, başka her
  şey reddedilir (bkz. Worker dosyasının başındaki mimari notu).
- Bu sayede panel artık GERÇEK bir yetki sınırı: bir editor/manager, PAT'a
  hiçbir zaman erişemediği için panelin dışından da GitHub'a doğrudan commit
  atamaz — eskiden burada yazan "kullanıcıya PAT verirsen panel sadece bir
  kolaylık katmanıdır" uyarısı artık geçerli değil.
- **Branch** (opsiyonel) hâlâ panelde girilebilir — gizli bir bilgi
  olmadığı için kolaylık amacıyla tarayıcının `localStorage`'ında
  hatırlanır; boş bırakırsan reponun varsayılan branch'i kullanılır.
- "Bağlantıyı Doğrula" butonu artık elle bir şey yapıştırmanı GEREKTİRMEZ
  — sayfa açılır açılmaz otomatik olarak dener; sadece sorun yaşarsan
  (Worker deploy edilmemiş, ağ sorunu vb.) butonla tekrar deneyip hatayı
  görebilirsin.
- Worker'ı KENDİN deploy edip aşağıdaki ortam değişkenlerini/secret'larını
  Cloudflare Dashboard'dan girmen gerekir (bkz. Worker dosyasının başındaki
  liste): `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_PAT` (fine-grained, SADECE
  bu repo için `Contents: Read and write` izniyle — tüm hesaba erişen
  "classic" token kullanmaktan çok daha güvenli), `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`. Deploy ettikten sonra
  `assets/js/github-yonetim/github-yonetim.js`'teki `GITHUB_PROXY_WORKER_URL` sabitini
  kendi Worker adresinle güncellemen gerekir (r2_storage_worker ile aynı
  "BURAYI DOLDUR" konvansiyonu). "Bağlantıyı Doğrula" mesajı, token'ın
  gerçekten yazma iznine sahip olup olmadığını (`permissions.push`) da
  ayrıca kontrol edip gösterir.

### Teknik detay (dokunmana gerek yok ama bilgi için)

- İçerik, GitHub'ın `contents` API'siyle (`PUT`/`DELETE
  /repos/{owner}/{repo}/contents/{path}`) base64 kodlanmış olarak
  gönderilir; Türkçe karakterler için `encodeURIComponent` +
  `btoa`/`atob` tabanlı bir UTF-8 güvenli base64 dönüşümü kullanılır.
  Profil fotoğrafı gibi ikili (binary) dosyalar için `FileReader.
  readAsDataURL` ile üretilen base64 doğrudan kullanılır.
- Var olan bir dosyayı güncellerken GitHub API'nin zorunlu kıldığı `sha`
  parametresi otomatik olarak önce bir `GET` isteğiyle alınır. Düzenleme
  sırasında dosya adını/tarihini değiştirirsen (dosya yolu değişirse)
  panel önce yeni yola yazar, sonra eski dosyayı siler (yeniden
  adlandırma simülasyonu) — GitHub API'de doğrudan bir "rename" uç
  noktası yoktur.
- "Mevcut İçerikler" listesi front-matter'ı panelin kendi ürettiği sınırlı
  alan setine göre basit bir regex ile okur; elle çok farklı bir YAML
  yapısı yazılmış dosyalarda (örn. çok satırlı değerler) güvenilir
  çalışmayabilir — bu durumda dosyayı GitHub üzerinden elle düzenlemen
  daha güvenlidir.
- Bu panel de, tıpkı Bölüm 9'daki gibi, sitenin görünürlük mantığına
  (`yayinda`/`date`/`sitemap`) aynen uyar — ürettiği dosyalar mevcut
  `icerik/blog.md`, `icerik/akademik-projeler.md`, `feed.xml` ve `sitemap.xml` ile
  sorunsuz çalışır.

### 10a. Klasör yönetimi — "📁 Klasörler" sekmesi

Hem `_posts/` (blog yazıları) hem `_projects/` (akademik projeler)
altındaki alt klasörleri (yıl bazlı ya da tamamen serbest isimli)
doğrudan panelden yönetebilirsin, GitHub'a elle gitmene gerek kalmadan —
her iki koleksiyon da BİREBİR aynı mekanizmayı kullanır.

- **Yeni içerik eklerken klasör seçimi:** "İçerik Ekle / Düzenle"
  formunda, hem blog hem proje türünde görünen **"Klasör"** açılır listesi
  üç türlü kullanılabilir:
  1. **Otomatik** (varsayılan) — eskisi gibi tarihin yılına göre
     (`_posts/<yıl>/` ya da `_projects/<yıl>/`) otomatik hesaplanır,
     hiçbir şey yapman gerekmez.
  2. **Mevcut bir klasör seçme** — dropdown, seçili içerik türüne göre
     GitHub'daki gerçek `_posts/` ya da `_projects/` alt klasörlerini
     (bağlantı doğrulanınca, içerik türü değiştirilince ve "Klasörler"
     sekmesi her güncellendiğinde) otomatik listeler; istediğini seçip
     dosyayı doğrudan oraya kaydedebilirsin (örn. farklı bir yıla ya da
     konu bazlı bir klasöre, `_posts/seyahat/` ya da
     `_projects/konferanslar/` gibi).
  3. **"➕ Yeni klasör oluştur…"** — dropdown'dan bu seçilince beliren
     metin kutusuna yeni klasör adını yazman yeterli; kaydettiğinde
     klasör otomatik oluşturulur (ayrıca önceden "Klasörler" sekmesinden
     de oluşturabilirsin).
  Bir yazıyı/projeyi düzenlemeye açtığında, dosyanın GERÇEKTE hangi
  klasörde olduğu bu seçiciye otomatik yansır — "Otomatik" davranışın
  üreteceği klasörle (tarihin yılı) aynıysa "Otomatik" seçili kalır,
  farklıysa o klasör seçili gösterilir; böylece kaydettiğinde dosya
  yanlışlıkla başka bir klasöre taşınmaz. İçerik türünü (Blog/Proje)
  değiştirdiğinde dropdown, o türün kendi koleksiyonundaki klasörlerle
  otomatik olarak yeniden doldurulur.
- **"📁 Klasörler" sekmesi — koleksiyon sekmesi:** sekmenin üstünde
  "📰 Blog (_posts/)" / "🎓 Projeler (_projects/)" seçimi vardır; hangisi
  seçiliyse aşağıdaki liste ve "Klasör Oluştur" işlemi O koleksiyonu
  hedefler. İki koleksiyonun klasörleri birbirinden tamamen bağımsızdır
  (örn. `_posts/2027/` oluşturman `_projects/2027/`'yi etkilemez, ayrı
  ayrı oluşturman gerekir).
- **Klasör oluşturma:** "Yeni klasör adı" kutusuna istediğin adı (örn.
  `2027`, `seyahat`, `konferanslar`) yazıp "➕ Klasör Oluştur"a basman
  yeterli. GitHub'da "gerçek" boş klasör kavramı olmadığından (bir klasör
  ancak içinde en az bir dosya varsa var olur), oluşturma işlemi o
  klasörün altına görünmez, sitede hiçbir şekilde kullanılmayan küçük bir
  `.gitkeep` dosyası ekler — Jekyll nokta ile başlayan dosyaları
  derlemeye almadığı için bu dosya sitede ASLA görünmez, sadece klasörün
  GitHub'da var olmasını sağlar.
- **Yeniden adlandırma:** her klasör kartındaki "Yeniden Adlandır"
  butonu, klasördeki TÜM dosyaları (yazılar/projeler + varsa `.gitkeep`)
  yeni klasör adının altına taşır (kopyala + eskisini sil şeklinde —
  GitHub Contents API'de doğrudan bir "rename" yoktur). İçeriklerin
  permalink'i (URL'i) hiçbir şekilde ETKİLENMEZ — blogda tarih+slug'dan,
  projede `_config.yml`'deki `/projects/:name/` şemasına göre dosya
  adından üretilir, ikisi de klasörden bağımsızdır — sadece depo
  içindeki konumları değişir. İşlem sırasında bir ağ hatası olursa
  (nadir) klasörde hem eski hem yeni dosyalar kalmış olabilir; bu
  durumda panel hata mesajında listeyi yenileyip GitHub'dan elle kontrol
  etmeni önerir.
- **Silme:** sadece **BOŞ** klasörler silinebilir (içinde `.gitkeep`
  dışında dosya yoksa) — dolu bir klasörün "Sil" butonu otomatik olarak
  devre dışı bırakılır ve üzerine gelince neden devre dışı olduğunu
  açıklayan bir ipucu gösterir. Önce içindeki dosyaları başka bir klasöre
  taşımalısın (Yeniden Adlandır ile) ya da tek tek silmelisin.

---

## 11. `assets/data/schema.json` ve `llms.txt` — Kişisel/SEO ve LLM verisi

Bu iki dosya, diğerlerinden farklı olarak **kod değil, saf kişisel veri**
içeriyor — bana (Abdullah Eymen Asru) ait isim, sosyal medya/akademik
profil linkleri ve site açıklaması. Fork'ladıysan **ikisini de kendi
bilgilerinle değiştirmen gerekir**, yoksa kendi sitende benim adım/
linklerim görünmeye devam eder. Fork kurulum adımlarının tam listesi için
bkz. [🍴 Fork Kurulumu](./03-fork-kurulumu.md) sekmesindeki "2. Zorunlu
Değişiklikler — `assets/data/schema.json` ve `llms.txt`" bölümü.

| Dosya | Ne işe yarar | Nerede kullanılıyor |
|---|---|---|
| `assets/data/schema.json` | [Schema.org](https://schema.org) `Person` tipinde JSON-LD verisi — Google/Yandex gibi arama motorlarının seni bir "kişi" olarak tanıyıp zengin sonuç (rich result) / bilgi paneli göstermesini sağlar. `name`, `url` ve `sameAs` (sosyal medya, akademik profil, ORCID, uygulama mağazası vb. linklerin listesi) alanlarını içerir. | `_layouts/default.html` içinde `<head>` bölümünde `fetch()` ile çekilip `application/ld+json` script'i olarak sayfaya enjekte edilir (dosya adını/yolunu değiştirme, sadece içeriğini güncelle). |
| `llms.txt` | Site içeriğinin büyük dil modelleri (ChatGPT, Claude vb.) tarafından daha kolay özetlenmesi/indekslenmesi için yazılmış serbest metin özet — kimsin, site ne anlatıyor, ana sayfalar hangileri. Yeni bir standart olan [llms.txt](https://llmstxt.org) formatını takip eder. | `_config.yml` içindeki `include:` listesinde (`- llms.txt`) yer aldığı için Jekyll, normalde gizli/nokta ile başlamayan dosyalar dışında kalan bu dosyayı olduğu gibi site köküne kopyalar; koddan değil sadece bu satırdan referans alır. |

Değiştirmen gerekenler:
- **`schema.json`** → `name` alanına kendi adını, `url` alanına kendi site
  adresini, `sameAs` dizisine sahip olduğun sosyal medya/akademik/GitHub
  profillerinin linklerini yaz; kullanmadığın satırları sil, olmayan bir
  platform için satır uydurma.
- **`llms.txt`** → Başlıktaki adı, biyografi paragrafını ve "Ana Sayfalar
  ve Bağlantılar" ile "İsteğe Bağlı Ek Kaynaklar" altındaki tüm linkleri
  kendi domainine ve kendi sayfalarına göre güncelle; "Bölüm 4 — Silme"ye
  göre kaldırdığın bir sayfa varsa (örn. akademik projeler) buradaki
  linki de sil.

---

# 🎨 Tema Anahtarı (Koyu/Açık Mod)

Header'daki kayan switch — ☀️/🌙 ikonları sabit iki uçta, ortadaki topuz
aktif temaya göre kayıyor, yanında "Açık mod"/"Koyu mod" yazan bir etiket
var.

| Ne | Nerede |
|---|---|
| Yapı (HTML) | `_layouts/default.html` içinde `#theme-toggle` butonu |
| Davranış (JS) | Aynı dosyanın altındaki `<script>` bloğu — `data-theme` özniteliğini değiştirip `localStorage`'a kaydediyor |
| Görünüm (CSS) | `assets/style.css` içinde `.theme-toggle`, `.theme-toggle-track`, `.theme-toggle-thumb`, `.theme-toggle-icon`, `.theme-toggle-label` sınıfları |
| Mobil davranış | 640px altında metin etiketi gizleniyor, sadece anahtar+ikonlar kalıyor (bkz. `style.css`'teki `@media` bloğu) |
| Giscus (yorumlar) senkronizasyonu | `_layouts/default.html`'deki aynı script bloğunda bir `MutationObserver` — `data-theme` her değiştiğinde, o an DOM'da bir giscus yorum kutusu varsa ona `postMessage` ile "temanı değiştir" mesajı gönderiyor. Giscus'un iframe'i geç yüklendiği (`data-loading="lazy"`, kullanıcı yorumlara kaydırana kadar açılmıyor) için bunu tek seferlik değil, sürekli izleyerek yapıyoruz. |

---

# 💬 Yorumlar (Giscus)

| Dosya | Ne işe yarar |
|---|---|
| `_includes/comments.html` | Giscus widget'ını yükleyen kod. `site.giscus.*` ayarları `_config.yml`'den geliyor (bkz. bölüm 1). |
| `assets/style.css` içinde `#giscus-container` / `iframe.giscus-frame` | Yorum kutusunun tam genişlik kullanmasını sağlayan kurallar. Kutu daralmış/küçülmüş görünürse önce burayı kontrol et. |
| Tema senkronizasyonu | Yukarıdaki "Tema Anahtarı" bölümüne bak — giscus'un koyu/açık modu sitenin temasıyla senkron kalması bu mekanizmaya bağlı. |

Giscus'un kendi ayarları (repo, kategori, tema rengi vb.) [giscus.app](https://giscus.app)
üzerinden alınıp `_config.yml`'e yapıştırılıyor — orta bir değişiklik
yapmak istersen (örn. tepki emojilerini kapatmak) giscus.app'te yeni
ayarı oluşturup `_includes/comments.html` içindeki ilgili
`data-*` satırını güncellemen yeterli.

---

# 🗂️ İzlediklerim / Okuduklarım Tablosu

| Dosya | Ne işe yarar |
|---|---|
| `assets/js/koleksiyon-tablo.js` | GitHub Projects verisini Worker'dan çekip tabloyu (arama, tür filtresi, sayfalama dahil) oluşturan ortak kod. Hem `icerik/izlediklerim.md` hem `icerik/okuduklarim.md` bunu kullanıyor. |
| `icerik/izlediklerim.md`, `icerik/okuduklarim.md` | Sayfanın kendisi — `koleksiyonTablosuOlustur({...})` çağrısındaki `dataUrl`, `containerId` gibi parametreler hangi projeye (`?project=izleme` / `?project=okuma`) bağlanacağını belirliyor. |
| Sütun sırası/gizlenen sütunlar | Bkz. yukarıdaki bölüm 5 (`cloudflare-worker/worker.js`) — tablonun kendisi değil, worker'ın döndürdüğü veri bu sırayı belirliyor. |

---

# 👤 Header'daki "Hesabım" Menüsü

| Dosya | Ne işe yarar |
|---|---|
| `_layouts/default.html` içinde `#auth-nav` | Nav'daki tek kapsayıcı — JS yüklenmeden önce görünen statik "Giriş Yap" linkini içerir (progressive enhancement / no-JS yedeği). |
| `assets/js/auth/nav-auth.js` | Sayfa açılışında oturumu kontrol edip `#auth-nav`'ın içeriğini dolduran script. Çıkış yapmışken tek bir "Giriş Yap" linki, giriş yapmışken "Hesabım ▾" açılır menüsü (Panelim, adminse Admin Paneli ve GitHub İçerik Yönetimi, Çıkış Yap) gösterir. Başka bir sekmede oturum açılıp kapandığında `onAuthStateChange` ile kendini günceller. |
| `assets/style.css` içinde `.auth-nav*` sınıfları | Açılır menünün görünümü — mevcut `nav a` stiliyle aynı renk değişkenlerini kullanır, açık/koyu temayla otomatik uyumludur. |

Bu menü, sitenin Supabase kullanıcı sistemine bağlıdır — bkz. aşağıdaki
"🔐 Supabase Kullanıcı Sistemi" bölümü. O sistemi tamamen kaldırırsan
(bkz. "Bölüm 4 — Silme" altındaki "Supabase kullanıcı sistemini kaldırmak
istersen"), bu menüyü de kaldırman gerekir.

---

# 🔔 Admin Güvenlik Denetimi — Bildirim Worker'ı

`panel/admin-guvenlik.md` sayfası, adminlerin birbirini denetleyip (askıya
alma/oy kullanma/kalıcı düşürme gibi) karşılıklı kontrol ettiği bir sistemin
panelidir (bkz. `supabase/migrations/0021_admin_karsilikli_denetim_owner_rolu.sql`).
Bu vakalarda bir şey olduğunda (askıya alındı, oy kullanıldı, kalıcı
düşürüldü, iptal edildi, süresi doldu) veritabanı bunu **anlık olarak** sana
haber vermek ister — bunu yapan parça `cloudflare worker/admin_guvenlik_bildirim_worker/worker.js`.

**Nasıl çalışıyor:**

1. Migration 0021'deki `_denetim_bildirim_gonder()` fonksiyonu, ilgili bir
   olay olduğunda `pg_net` ile `guvenlik_bildirim_ayarlari` tablosundaki
   `webhook_url`'e async bir HTTP POST atar (yanıt beklenmez, bu yüzden
   webhook kapalı/yavaş olsa bile askıya alma/oylama işlemi asla gecikmez).
2. Bu POST isteğini karşılayan, deploy ettiğin `admin_guvenlik_bildirim_worker`
   Worker'ıdır — gelen JSON'u okunabilir bir mesaja çevirip Telegram ve/veya
   SMS (Twilio) ile iletir. Gerçek sırlar (bot token'ı, Twilio anahtarları)
   sadece Worker'ın Cloudflare ortam değişkenlerinde durur — veritabanı bu
   sırları hiç görmez (`r2_storage_worker` / `github_icerik_yonetim_worker`
   ile aynı desen, bkz. bölüm 10).

**Kurulum (özet — ayrıntı için worker dosyasının başındaki yorum):**

| Adım | Ne yapılır |
|---|---|
| 1 | Cloudflare Dashboard'da yeni bir Worker oluştur, `worker.js` içeriğini yapıştır, deploy et. |
| 2 | Worker'ın Settings → Variables and Secrets kısmına `GIZLI_YOL` (tahmin edilmesi zor rastgele bir segment) ve `WEBHOOK_SHARED_SECRET` (rastgele, uzun bir sır — ör. `openssl rand -hex 32`), ikisi de **Secret** olarak; ayrıca en az `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (SMS istersen Twilio değişkenlerini de) gir. |
| 3 | Migration `0034_guvenlik_bildirim_paylasilan_sir.sql`'i uyguladıktan sonra, Supabase SQL Editor'de Worker adresin + `/GIZLI_YOL` şeklindeki tam URL'i VE 2. adımdaki `WEBHOOK_SHARED_SECRET` ile AYNI değeri kaydet: `update public.guvenlik_bildirim_ayarlari set webhook_url = '<WORKER_URL>', webhook_secret = '<WEBHOOK_SHARED_SECRET İLE AYNI DEĞER>', aktif = true where id = 1;` |
| 4 | Bir denetim vakası tetikleyip Telegram'a bildirim gelip gelmediğini kontrol et; gelmezse Worker'ın Cloudflare "Logs" sekmesine bak. |

`GIZLI_YOL`, URL'i tahmin edilmesi zor kılan bir katman ama TEK BAŞINA
kriptografik bir doğrulama değil — sızarsa (tarayıcı geçmişi, Analytics
ekranı, kazara paylaşım) o adresi bilen herkes sahte bildirim tetikleyebilir.
Bu yüzden asıl doğrulama artık `WEBHOOK_SHARED_SECRET`: `_denetim_bildirim_gonder()`
fonksiyonu her istekte bunu `X-Webhook-Secret` header'ı olarak gönderir,
Worker da bunu sabit zamanlı (timing-safe) karşılaştırarak doğrular —
eşleşmezse istek `GIZLI_YOL` doğru olsa bile 401 ile reddedilir. Her iki
değeri de (GIZLI_YOL ve WEBHOOK_SHARED_SECRET) koda/repo'ya asla yazma,
sadece Cloudflare'in Variables/Secrets kısmında tut. `WEBHOOK_SHARED_SECRET`
ayarlanmadan da worker eski (sadece GIZLI_YOL) davranışıyla çalışmaya devam
eder — ama production'da MUTLAKA ayarlanmalı.

Telegram VEYA SMS'ten en az biri yapılandırılmalı; ikisi de boşsa Worker
isteği 200 ile kabul eder ama hiçbir yere bildirim göndermez (loglar).

---

# 🔒 Güvenlik Notları (bilmen faydalı olur)

- **CSP (`_layouts/default.html`, `<meta http-equiv="Content-Security-Policy">`):**
  sayfanın hangi domain'lerden script/frame/bağlantı yükleyebileceğini
  sınırlıyor. Yeni bir üçüncü parti servis (örn. yeni bir embed) eklersen
  ve site "kırık" görünürse, önce burada o servisin domain'inin
  `connect-src`/`frame-src`/`script-src`'e eklenmesi gerekip gerekmediğine
  bak.
- **`guvenliLink` fonksiyonu** (`assets/js/koleksiyon-tablo.js` ve
  `icerik/blog.md` içinde, aynı isimle iki ayrı yerde) — GitHub/RSS'ten gelen
  linklerin `http(s)://` ile başladığını ve içinde boşluk/kontrol
  karakteri olmadığını doğruluyor, öyle değilse linki `#`'e çeviriyor.
- **`escapeHtml` fonksiyonu** — tabloya/listeye basılan her metin
  (başlıklar, alan adları) HTML'e yazılmadan önce buradan geçiyor, bu
  yüzden GitHub tarafında biri kötü niyetli bir field adı/değeri girse
  bile sitede çalışan koda dönüşemiyor.
- **Substack RSS'i** (`icerik/blog.md`) üçüncü parti bir proxy'den
  (`api.allorigins.win`) geçiyor çünkü tarayıcılar farklı bir domain'den
  ham RSS çekmeye (CORS) izin vermiyor. Bu servis kontrolün dışında —
  ileride kendi Worker'ın üzerinden proxy'lemek istersen (daha güvenli
  ama kurulumu daha uzun), ayrı bir adım olarak yapılabilir.

---

[⬅️ README'ye dön](../README.md)

**📖 Site Rehberi** · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · [🍴 Fork Kurulumu](./03-fork-kurulumu.md)

---

