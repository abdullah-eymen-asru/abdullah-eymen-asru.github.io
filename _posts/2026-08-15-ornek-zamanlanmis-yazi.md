---
title: "Örnek Zamanlanmış / Gizli Yazı"
date: 2026-09-19
yayinda: false            # zamanlanmış/gizli proje için — bkz. README.md
sitemap: false             # yayinda:false ile BİRLİKTE yazılmalı — bkz. README.md
permalink: /blog/on-izleme-x7k2p9qz/   # gizli linkin adresi — bkz. README.md
---

Bu, "yayinda: false" ile işaretlenmiş ÖRNEK bir taslak yazı. Blog
listesinde, RSS feed'inde ve sitemap'te görünmüyor, arama motorları
indekslemiyor — ama bu dosyanın `permalink` alanındaki adresi bilen biri
doğrudan girip okuyabiliyor.

**Not:** `yayinda` ve `date` artık birlikte çalışıyor (bkz. README § 9):

- `yayinda: false` yazdığın sürece, dosya adındaki (veya front-matter'daki)
  `date` geçmiş bir tarih olsa bile yazı **asla** görünmez. Bu dosyada
  `yayinda: false` olduğu için `date` hiç önemli değil.
- Eğer bunun yerine `yayinda: true` yazıp `date`'i ileri bir tarihe
  ayarlasaydın (örn. dosya adını `2026-12-25-...` yapsaydın), yazı o
  tarihe kadar otomatik gizli kalır, tarih geldiğinde (bir sonraki
  otomatik build'de — bkz. `.github/workflows/zamanlanmis-yayin.yml`)
  kendiliğinden yayına girerdi.

Gerçek bir taslak yazı için:

1. Bu dosyayı kopyala, `title` ve içeriği kendi yazınla değiştir.
2. `permalink` değerini tahmin edilemez, rastgele bir adresle değiştir
   (örn. `/blog/on-izleme-RASTGELE-HARF-SAYI/`) — bunun nasıl
   üretileceği README.md'de anlatılıyor.
3. Yazıyı yayınlamaya hazır olduğunda `yayinda: false` satırını komple
   sil (ya da `yayinda: true` yap) — anında blog listesine, RSS'e ve
   sitemap'e girer. Ya da hiç dokunmadan sadece `date`'in gelmesini
   bekleyebilirsin (`yayinda: true` iken).

Bu dosyayı silebilir ya da örnek olarak tutabilirsin.
