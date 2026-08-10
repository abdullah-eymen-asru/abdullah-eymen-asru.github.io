![Jekyll](https://img.shields.io/badge/Jekyll-4.4-CC0000?style=flat&logo=jekyll&logoColor=white)
![Ruby](https://img.shields.io/badge/Ruby-CC342D?style=flat&logo=ruby&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=flat&logo=github&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-F38020?style=flat&logo=cloudflare&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?style=flat&logo=githubactions&logoColor=white)
![AI](https://img.shields.io/badge/Kod-Yapay%20Zeka%20ile%20Üretilmiştir-8A2BE2)

> 🤖 **Not:** Bu projenin kodu büyük ölçüde **yapay zeka** yardımıyla üretilmiş/geliştirilmiştir. Mimari kararlar ve yapılandırma insan gözetiminde yapılsa da, kaynak kodun tamamını kullanmadan/gözden geçirmeden production ortamına almanız önerilmez.

> 📌 Aşağıdaki üç bölüm katlanabilir/genişletilebilir — başlığa tıklayarak açıp kapatabilirsin.

<details>
<summary><h1>📖 Site Rehberi — Hangi Dosya Ne İşe Yarar, Neyi Nerede Değiştiririm? (tıkla, aç/kapat)</h1></summary>

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
yerleri (nav menüsü `_layouts/default.html`, `assets/js/nav-auth.js`,
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
| `substack_url` / `substack_feed` | Substack blog adresin ve RSS feed'i |
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

## 6. `robots.txt`

`Sitemap:` satırındaki adres, `_config.yml`'deki `url` ile aynı domaini
göstermeli.

## 7. `_includes/hakkimda-icerik.md` ve `_includes/hakkimda-kutusu.md`

Anasayfada görünen "hakkımda" metni ve kutusu — biyografini, unvanını,
tanıtım yazını buraya serbest metin olarak yaz.

## 8. İçerik ekleme — blog yazıları ve akademik projeler

- **Blog yazısı:** `_posts/` klasörüne `YIL-AY-GUN-baslik.md` formatında
  yeni bir dosya ekle (örn. `_posts/2026-09-01-yeni-yazi.md`). `icerik/blog.md`
  sayfasına hiç dokunmana gerek yok, otomatik listelenir.
- **Akademik proje:** `_projects/` klasörüne aynı mantıkla yeni bir `.md`
  dosyası ekle (örn. `_projects/2026-yeni-proje.md`). Kullanılabilecek
  front-matter alanları için `_projects/2025-ornek-proje.md` dosyasındaki
  örneğe bak (`title`, `date`, `venue`, `status`, `summary`, `link`,
  `link_label`).

## 9. Zamanlanmış ve gizli yazılar/projeler

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
- Örnek bir taslak dosya için `_posts/2026-08-15-ornek-zamanlanmis-yazi.md`
  dosyasına bak — aynı desen `_projects/` için de birebir çalışır (örnek
  alanlar `_projects/2025-ornek-proje.md` içinde yorum satırı olarak var).

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

**Bu panel, sitenin Supabase tabanlı `/panel/admin.html` panelinden TAMAMEN
BAĞIMSIZDIR.** `/panel/admin.html` Supabase'teki üye/rol/özel içerik sistemini
yönetir; `/panel/github-yonetim.html` ise bu deponun kendi statik Jekyll
içeriğini (blog yazıları, akademik projeler, profil fotoğrafı) yönetir.
Aralarındaki tek ortak nokta: bu sayfaya erişim de aynı
`requireAuth({ role: 'admin' })` mekanizmasıyla korunur (bkz.
`assets/js/auth-guard.js`), yani sadece Supabase'te `role: 'admin'` olan
hesaplar görebilir. Header'daki **"Hesabım ▾"** menüsünde, adminsen
"Admin Paneli" linkinin hemen altında **"GitHub İçerik Yönetimi"** olarak
görünür (bkz. `assets/js/nav-auth.js`).

### Paketteki dosyalar

```
panel/github-yonetim.md              <- Jekyll sayfası (_layouts/default.html'i kullanır, admin-only)
assets/js/github-yonetim.js    <- Panelin tüm mantığı
assets/css/github-yonetim.css  <- Bu sayfaya özel ek stiller (auth.css'in üzerine eklenir)
```

### Neler yapabilirsin

- **Blog yazısı / Akademik proje ekle veya düzenle** — içerik türünü
  seçtiğinde form alanları otomatik değişir (proje seçilince `venue`,
  `status`, `summary`, `link`, `link_label` alanları da görünür). Dosya
  adı (slug) boş bırakılırsa başlıktan otomatik üretilir (Türkçe
  karakterler sadeleştirilir).
- **"Yayında" anahtarını kapatırsan** (modern bir toggle switch; klasik
  onay kutusu değil) panel otomatik olarak `yayinda: false`,
  `sitemap: false` yazar ve 8 karakterlik rastgele bir kodla
  (`crypto.getRandomValues` ile üretilir, tahmin edilemez) gizli bir ön
  izleme linki oluşturur (`/blog/on-izleme-XXXXXXXX/` veya
  `/projects/on-izleme-XXXXXXXX/`) — bkz. yukarıdaki Bölüm 9'daki mantığın
  aynısı, sadece elle yazmak yerine panel yazıyor.
  **Bu link tek seferlik değildir ve düzenlenebilir:** anahtarı kapatır
  kapatmaz, dosyayı hiç kaydetmeden önce bile ekranda görünür — kodu
  olduğu gibi kullanabilir, kutuya kendi kodunu elle yazabilir (örn.
  `/blog/on-izleme-taslak-v2/`) veya "🎲 Yenile" butonuyla yeni bir
  rastgele kod üretebilirsin. Kaydettikten sonra da ekranda kalır,
  anahtarı kapatıp açtığında anında görünür/gizlenir, "Mevcut İçerikler"
  listesinden aynı yazıyı tekrar "Düzenle"ye açtığında da aynı link
  otomatik olarak yeniden gösterilir — panel bunu dosyanın `permalink`
  alanından okur. Link, sen bilerek değiştirmediğin sürece her
  düzenlemede **aynı kalır**, böylece daha önce birine gönderdiğin bir ön
  izleme linki içeriği güncellesen bile kırılmaz. Panel, aynı türde
  (blog/proje) başka bir içeriğin zaten kullandığı bir kodu tekrar
  kaydetmene izin vermez (çakışma kontrolü) — böyle bir durumda hata
  mesajıyla uyarır. Yazının/projenin kendi sayfasında da (görüntülerken)
  "henüz yayında değil" uyarısı görünür (bkz. `_layouts/post.html` /
  `_layouts/project.html`), böylece linke sahip olan biri içeriği
  görüntülerken durumundan haberdar olur.
- **Hafif bir Markdown editörü** — kalın, italik, başlık ve bağlantı
  eklemek için metin alanının üstünde küçük araç çubuğu butonları var.
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

Panelin üstündeki "GitHub Bağlantısı" sekmesinden şunları girmen gerekir:

- **GitHub Kullanıcı Adı** ve **Repository Adı** — gizli bilgi olmadığı
  için kolaylık amacıyla tarayıcının `localStorage`'ında hatırlanır.
- **Branch** (opsiyonel) — boş bırakırsan reponun varsayılan branch'i
  kullanılır.
- **GitHub Personal Access Token (PAT)** — **SADECE sekme açıkken
  tarayıcı belleğinde tutulur, hiçbir yerde (localStorage dahil)
  kalıcı olarak saklanmaz.** Sayfayı yenilediğinde veya sekmeyi
  kapattığında token kaybolur, bir sonraki girişte yeniden yapıştırman
  gerekir. Bu bilinçli bir tercih: localStorage'a yazmak daha
  kullanışlı olurdu ama bir XSS açığında token'ın kalıcı olarak
  sızdırılması riskini taşır.
- **Fine-grained bir token oluştur** ve **sadece bu repo** için
  `Contents: Read and write` iznini ver — tüm hesaba erişen "classic"
  bir token kullanmaktan çok daha güvenlidir.
  ([token oluşturma sayfası](https://github.com/settings/personal-access-tokens/new))
- "Bağlantıyı Doğrula" butonu, token'ın gerçekten yazma iznine sahip
  olup olmadığını (`permissions.push`) kontrol eder ve sonucu gösterir.

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
| `assets/js/nav-auth.js` | Sayfa açılışında oturumu kontrol edip `#auth-nav`'ın içeriğini dolduran script. Çıkış yapmışken tek bir "Giriş Yap" linki, giriş yapmışken "Hesabım ▾" açılır menüsü (Panelim, adminse Admin Paneli ve GitHub İçerik Yönetimi, Çıkış Yap) gösterir. Başka bir sekmede oturum açılıp kapandığında `onAuthStateChange` ile kendini günceller. |
| `assets/style.css` içinde `.auth-nav*` sınıfları | Açılır menünün görünümü — mevcut `nav a` stiliyle aynı renk değişkenlerini kullanır, açık/koyu temayla otomatik uyumludur. |

Bu menü, sitenin Supabase kullanıcı sistemine bağlıdır — bkz. aşağıdaki
"🔐 Supabase Kullanıcı Sistemi" bölümü. O sistemi tamamen kaldırırsan
(bkz. "Bölüm 3 — Silme" altındaki "Supabase kullanıcı sistemini kaldırmak
istersen"), bu menüyü de kaldırman gerekir.

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

</details>

<details>
<summary><h1>🔐 Supabase Kullanıcı Sistemi — Kurulum, Güvenlik ve Sorun Giderme (tıkla, aç/kapat)</h1></summary>

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
  functions/delete-account/index.ts        <- Adım 5: Edge Function (hesap silme — artık admin başkasını da silebiliyor)
  functions/admin-change-email/index.ts    <- Adım 5c: Edge Function (admin, bir üyenin e-postasını TEK onaylı — sadece yeni adrese — değiştirir)
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

Hayır, gerek yok. Mevcut projendeki anahtarlar zaten `assets/js/supabase-client.js`
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
3. **Anahtarlar güncel projeyle eşleşiyor mu?** `assets/js/supabase-client.js`
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
2. `assets/js/supabase-client.js` içindeki iki değeri doldur (Dashboard →
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
   otomatik — ayrıca link eklemene gerek yok, `assets/js/nav-auth.js`
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
kilitleyebilir. Bu fonksiyon, admin panelinden çağrılan **tek onaylı**
yedek yoldur: sadece **yeni** adrese bir onay maili/kodu gider, eski
adrese hiçbir şey gitmez ve eski adrese erişim gerekmez. Bunu
`auth.admin.updateUserById()` (service_role) ile yapıyoruz — bu API,
client-side `updateUser()`'ın tabi olduğu "Secure email change" kuralına
tabi DEĞİLDİR.

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
formdan yeni adresi girip **"Onay Maili Gönder"**e basılır. Kullanıcı
mailindeki linke tıklayınca (veya `/hesap/hesap-onayla.html`'deki gibi bir
kod akışıyla — bkz. aşağıdaki not) e-postası güncellenmiş olur.

**Not (kod ile onaylama):** Bu fonksiyon `email_confirm` parametresini
BİLİNÇLİ OLARAK göndermez, bu da Supabase'in normal "Confirm signup"
davranışına benzer şekilde yeni adrese hem bir link HEM de bir kod
gönderdiği anlamına gelir. Kullanıcı linke tıklayamıyorsa, aynı kodu
`supabase.auth.verifyOtp({ email: yeniAdres, token: kod, type:
"email_change" })` ile doğrulayabilir — panelin kendi "E-posta Değiştir"
bölümündeki "kod ile onayla" formları bu tip için zaten hazır; admin
tarafından başlatılan bu tek-onaylı değişiklik için de kullanıcı aynı kod
kutusunu (yeni adres için olanı) kullanabilir.

### "admin-change-email 'Load failed' / CORS Hatası Alıyorum"

Admin panelinde "Onay Maili Gönder"e basınca kırmızı kutuda **"E-posta
değiştirilemedi: Load failed"** (Safari) veya **"...: Failed to fetch"**
(Chrome/Edge) görüyorsan, bu istek Edge Function'a **hiç ulaşmadan**
tarayıcı tarafından engellendiği/başarısız olduğu anlamına gelir — yani
hata fonksiyonun İÇİNDE değil, fonksiyona ULAŞMADAN ÖNCE oluyor. Sırayla
kontrol et:

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

---

## Adım 5b — İki Faktörlü Doğrulama (2FA / TOTP)

Panelim sayfasındaki "İki Faktörlü Doğrulama" bölümü, Supabase Auth'un
**yerleşik** TOTP MFA desteğini kullanır (`supabase.auth.mfa.*` — ekstra
bir tablo veya paket kurmana gerek yok). Varsayılan olarak Supabase
projelerinde bu özellik zaten açıktır; kapalıysa Dashboard →
**Authentication → Providers** sayfasının altındaki **"Multi-Factor
Authentication"** bölümünden **"Authenticator App (TOTP)"** seçeneğini aç.
Üyeler kendi isteğiyle etkinleştirir/kaldırır, zorunlu değildir.

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

- Metin ve gösterme/gizleme mantığı **tek bir yerde**, `assets/js/supabase-client.js`
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
- `assets/js/auth-pages.js` → `initGirisPage()`: linkle gelindiğinde URL
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

</details>

<details>
<summary><h1>🍴 Bu Projeyi Fork Edenler İçin Kurulum Rehberi (tıkla, aç/kapat)</h1></summary>

Bu site tamamen bana (Abdullah Eymen Asru) özel kişisel bilgiler, hesaplar ve
API anahtarları içeriyor. Fork'ladıysan **canlıya almadan önce** aşağıdaki
adımları sırayla uygulaman gerekiyor.

### 1. Zorunlu Değişiklikler — `_config.yml`

Bu dosyadaki `# ---- BURAYI DOLDUR ----` ile başlayan blok içindeki
**her satırı kendine göre değiştir**:

| Alan | Ne yapmalısın |
|---|---|
| `title`, `description` | Kendi adın/site açıklaman |
| `url` | Kendi Cloudflare Pages adresin (örn. `https://kullaniciadin.pages.dev`) |
| `github_username` | Kendi GitHub kullanıcı adın |
| `kutuphane_repo` | Kendi izleme/okuma verisini tutacağın repo (bu özelliği kullanmayacaksan bkz. "Bölüm 3 — Silme") |
| `izleme_projects_url` / `okuma_projects_url` | Kendi GitHub Projects panolarının linki |
| `substack_url` / `substack_feed` | Kendi Substack adresin (kullanmıyorsan bkz. "Bölüm 3") |
| `google_analytics_id` | Kendi Google Analytics Measurement ID'in (G-XXXXXXX) |
| `profile_image` | `assets/` klasörüne kendi fotoğrafını yükleyip yolunu yaz |
| `cloudflare_worker_url` | Kendi Cloudflare Worker adresin (kullanmıyorsan bkz. "Bölüm 3") |
| `mirror_site_url` | Kendi GitHub Pages yedek adresin (`kullaniciadin.github.io`) |
| `giscus:` bloğu | [giscus.app](https://giscus.app) adresine git, KENDİ repo'nu bağlayıp `repo`, `repo_id`, `category`, `category_id` değerlerini oradan kopyala |
| `social:` altındaki tüm linkler | Kendi sosyal medya/akademik profil linklerin — kullanmadığın satırları sil |

### 2. Zorunlu Değişiklikler — `_config_cloudflare.yml`

Buradaki `google_analytics_id`'yi de kendi Analytics ID'in ile değiştir
(veya `_config.yml`'dekiyle aynısını kullanacaksan bu dosyayı tamamen silebilirsin).

### 3. Kullanmak İstemediğin Özellikleri Silme

Aşağıdaki her blok bağımsızdır — sadece istemediğini sil, geri kalanına dokunma.

**Yorum sistemini (giscus) kaldırmak istersen:**
- `_includes/comments.html` dosyasını sil
- `_layouts/post.html` içinde `{% include comments.html %}` satırını bul ve sil
- `_config.yml` içindeki `giscus:` bloğunu sil

**İletişim formunu kaldırmak istersen:**
- `kurumsal/iletisim.md` dosyasını sil
- `_layouts/default.html` içindeki menüde iletişim linkine giden satırı bul ve sil

**İzlediklerim/Okuduklarım (Cloudflare Worker) özelliğini kaldırmak istersen:**
- `icerik/izlediklerim.md` ve `icerik/okuduklarim.md` dosyalarını sil
- `_config.yml` içinden `kutuphane_repo`, `izleme_projects_url`, `okuma_projects_url`, `cloudflare_worker_url` satırlarını sil
- `_layouts/default.html` içindeki menüden bu sayfalara giden linkleri sil

**Akademik projeler / Substack blog bağlantısını kaldırmak istersen:**
- `icerik/akademik-projeler.md` dosyasını sil (ya da içeriğini kendi projelerinle doldur)
- `substack_url` / `substack_feed` satırlarını `_config.yml`'den sil
- `_layouts/default.html` menüsündeki ilgili linki sil

**Zamanlanmış/gizli yazı otomasyonunu (GitHub Actions) kaldırmak istersen:**
- `.github/workflows/zamanlanmis-yayin.yml` dosyasını sil
- GitHub repo ayarlarından eklediysen `CLOUDFLARE_DEPLOY_HOOK_URL` secret'ını da silebilirsin
- Not: Bunu silersen, gelecek tarihli/gizli yazılar sadece SEN elle bir push yaptığında görünür hale gelir, otomatik gelmez

**Cloudflare Pages'i hiç kullanmayıp sadece GitHub Pages'te barındıracaksan:**
- `_config_cloudflare.yml` dosyasını sil
- `_headers` dosyasını sil (bu dosya sadece Cloudflare Pages'te işe yarar, GitHub Pages'te zaten görmezden gelinir ama gereksizse silebilirsin)
- `.github/workflows/zamanlanmis-yayin.yml` dosyasını sil (Cloudflare'e özel)
- `_config.yml` içindeki `mirror_site_url` satırını sil, `url` alanına GitHub Pages adresini yaz

**Android uygulama bağlantısını (App Links) kullanmıyorsan:**
- `.well-known/assetlinks.json` dosyasını sil
- `_config.yml` içindeki `include: - .well-known` satırını silebilirsin

**Supabase kullanıcı sistemini (kayıt/giriş/panel/admin) kaldırmak istersen:**
- `hesap/giris.md`, `hesap/kayit.md`, `hesap/sifremi-unuttum.md`, `hesap/sifre-guncelle.md`,
  `hesap/hesap-onayla.md`, `panel/panel.md`, `panel/admin.md`, `panel/ozel-icerik.md` dosyalarını sil
- `assets/js/supabase-client.js`, `auth-guard.js`, `auth-pages.js`,
  `panel.js`, `admin.js`, `ozel-icerik.js`, `nav-auth.js` ve
  `assets/css/auth.css` dosyalarını sil
- `supabase/` klasörünü (migrations + functions) tamamen sil
- `_layouts/default.html` içindeki `#auth-nav` bloğunu ve onu başlatan
  `<script type="module">...initAuthNav()...</script>` satırını sil
- `assets/style.css` içindeki `.auth-nav*` sınıflarını sil
- Supabase Dashboard'dan projeyi de silmek istersen **Project Settings →
  General → Delete Project** üzerinden yapabilirsin (bu, koddan bağımsız,
  ayrı bir adım)

### 4. Secret / Gizli Anahtarlar — Nerede, Nasıl Tanımlanır

Bu projede kod içine **asla düz yazılmaması gereken** tek secret,
Cloudflare Pages'i otomatik build tetikleyen deploy hook URL'idir.
(Google Analytics ID ve giscus ayarları secret değildir, herkese açık
görünebilir bilgilerdir, bu yüzden `_config.yml` içinde düz yazılıdır.)

| Secret adı | Nerede kullanılır | Nasıl oluşturulur | Nereye eklenir |
|---|---|---|---|
| `CLOUDFLARE_DEPLOY_HOOK_URL` | `.github/workflows/zamanlanmis-yayin.yml` | Cloudflare Pages projeni aç → **Settings → Builds & deployments → Deploy Hooks** → yeni bir hook oluştur, verdiği URL'i kopyala | GitHub repo'nda **Settings → Secrets and variables → Actions → New repository secret** → isim: `CLOUDFLARE_DEPLOY_HOOK_URL`, değer: kopyaladığın URL |

Bu projede kullanılan diğer üçüncü parti servisler (Google Analytics,
giscus, Google Forms) API anahtarı değil, herkese açık/genel amaçlı ID'ler
kullanır; bunları `_config.yml` veya ilgili `.md` dosyasına doğrudan
yazman güvenlidir, GitHub Secrets'a eklemene gerek yoktur.

### 5. Yayına Alma Sırası (Özet)

1. Yukarıdaki `_config.yml` ve `_config_cloudflare.yml` alanlarını doldur
2. İstemediğin özellikleri "Bölüm 3"e göre sil
3. Cloudflare Pages'te yeni bir proje oluştur, bu repo'yu bağla
   - Build command: `bundle exec jekyll build --config _config.yml,_config_cloudflare.yml`
   - Build output directory: `_site`
4. Zamanlanmış yayın özelliğini kullanacaksan `CLOUDFLARE_DEPLOY_HOOK_URL` secret'ını ekle (Bölüm 4)
5. GitHub Pages'i de yedek olarak kullanacaksan repo **Settings → Pages** üzerinden aktif et

</details>
