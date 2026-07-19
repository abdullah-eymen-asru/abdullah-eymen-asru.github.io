# Site Yapılandırma Rehberi — Neyi Nerede Değiştireceksin?

Bu dosya, kendi bilgilerinle (isim, GitHub kullanıcı adı, sosyal medya
linkleri, worker adresi vb.) doldurman gereken **tüm** yerleri tek bir
listede topluyor. Kurulumun kendisi için `KURULUM-REHBERI.md` dosyasına,
izleme/okuma reposu için `KUTUPHANE-REPO-README.md` dosyasına bak — bu
dosya sadece "hangi alan hangi dosyada" sorusuna cevap.

## 1. `_config.yml` — Ana ayarlar (en çok değiştireceğin dosya)

| Alan | Ne işe yarar |
|---|---|
| `title` | Site başlığı, sekme adı ve header'daki logo yazısı |
| `description` | SEO açıklaması, sosyal medya paylaşım kartlarında görünür |
| `url` | Sitenin birincil (Google'ın indeksleyeceği) adresi — Cloudflare Pages domainin |
| `github_username` | GitHub kullanıcı adın |
| `kutuphane_repo` | İzlediklerim/okuduklarım verisinin tutulduğu ayrı repo (`kullanici/repo-adi` formatında) |
| `izleme_projects_url` / `okuma_projects_url` | GitHub Projects panolarının linkleri |
| `substack_url` / `substack_feed` | Blogunun Substack adresi ve RSS feed'i |
| `google_analytics_id` | Google Analytics ölçüm kimliği (GitHub Pages build'i için) |
| `profile_image` | Profil fotoğrafın (`assets/` klasörüne yükleyip yolunu buraya yaz) |
| `cloudflare_worker_url` | İzleme/okuma verisini çeken Cloudflare Worker'ının adresi |
| `mirror_site_url` | Yedek/ikincil site adresin (GitHub Pages) |
| `giscus:` altındaki 3 alan | Yorum sistemi (giscus.app üzerinden alınır) — **güvenlik notu:** `category` için GitHub'ın önerdiği gibi "Announcements" tipinde bir kategori seç, böylece yeni tartışma (discussion) başlığını sadece sen/giscus botu oluşturabilir, ziyaretçiler oluşturamaz |
| `social:` altındaki tüm linkler | GitHub, LinkedIn, X/Twitter, Instagram, YouTube, n-sosyal, ORCID, Academia, ResearchGate, 1000Kitap, Play Store |

## 2. `_config_cloudflare.yml` — Sadece Cloudflare build'ine özel

| Alan | Ne işe yarar |
|---|---|
| `google_analytics_id` | Cloudflare Pages build'i için AYRI bir Analytics ID (varsa) |

> Not: Bu dosyadaki anahtarlar, build sırasında `_config.yml`'in üzerine
> yazılır. Sadece `_config.yml`'den farklı olması gereken değerleri buraya
> koy (örn. farklı bir Analytics ID kullanıyorsan).

## 3. `iletisim.md` — İletişim formu

| Ne | Nerede |
|---|---|
| Google Forms embed linki | `src="FORM-EMBED-LINKINI-BURAYA-YAPISTIR"` satırındaki placeholder'ı, Google Forms'tan aldığın gerçek embed linkiyle değiştir (Gönder > `<>` ikonu > `src=` değeri) |

## 4. `cloudflare-worker/worker.js` — Worker tarafı

| Alan | Ne işe yarar |
|---|---|
| `GITHUB_LOGIN` | GitHub kullanıcı adın (worker'ın hangi hesaba ait Projects verisini çekeceğini belirler) |
| `PROJECTS` içindeki `number` değerleri | İzleme ve okuma GitHub Projects panolarının proje numaraları |
| `PROJECTS` içindeki `sutunSirasi` dizileri | Sitede sütunların hangi sırayla görüneceği — panoda sütunları sürükleyip yer değiştirdiğinde, aynı sırayı burada da elle güncellemen gerekir (bkz. aşağıdaki "Sütun sırası" bölümü) |
| `GITHUB_TOKEN` | **Kodun içinde değil**, Cloudflare Dashboard > Settings > Variables and Secrets kısmından secret olarak eklenir. Asla dosyaya yazma. |

## 5. `robots.txt`

| Alan | Ne işe yarar |
|---|---|
| `Sitemap:` satırındaki adres | `_config.yml`'deki `url` ile aynı domaini göstermeli |

## 6. Sütun sırası — `cloudflare-worker/worker.js` içindeki `sutunSirasi`

GitHub Projects panosunda bir view'daki sütunları sürükleyip yer
değiştirmek, sitedeki sırayı **otomatik değiştirmez** (bkz. değişiklik
günlüğündeki teknik açıklama). Panodaki sırayla site arasında birebir
eşleşme istiyorsan, sütunları panoda düzenledikten sonra bu diziyi elle
güncellemen gerekir:

```js
const PROJECTS = {
  izleme: { number: 2, sutunSirasi: ["Durum", "New field 7", "Tür", "Puan", "Sezon/Bölüm", "Başlama Tarihi", "Bitiş Tarihi"] },
  okuma: { number: 3, sutunSirasi: [] },
};
```

- Sütun adlarını, panoda göründükleri **BİREBİR yazımla** (büyük/küçük
  harf dahil), soldan sağa istediğin sırayla yaz.
- `okuma` projesi için şu an `sutunSirasi: []` (boş) — bu, eski davranışı
  (GitHub'daki field oluşturma sırası) kullanmaya devam ettiği anlamına
  gelir. İstersen aynı şekilde doldurabilirsin.
- Listede unuttuğun ya da sonradan panoya eklediğin bir field varsa, o
  otomatik olarak listenin sonuna eklenir — hiçbir veri kaybolmaz.
- Bu dosyayı düzenledikten sonra Cloudflare Dashboard'da Worker'ı yeniden
  deploy etmen (Save and Deploy) gerekir.

## 7. `_includes/hakkimda-icerik.md` ve `_includes/hakkimda-kutusu.md`

Anasayfada görünen "hakkımda" metni ve kutusu — kendi biyografini, unvanını,
akademik/kişisel tanıtım yazını buraya serbest metin olarak yazabilirsin.

## 8. İçerik dosyaları (isteğe bağlı, örnek olarak geliyor)

- `_posts/2026-07-11-ornek-yazi.md` → örnek blog yazısı, silip kendi
  yazılarını `_posts/YYYY-MM-DD-baslik.md` formatında ekleyebilirsin.
- `_projects/2025-ornek-proje.md` → örnek akademik proje, aynı mantıkla
  `_projects/` klasörüne kendi projelerini ekle.
