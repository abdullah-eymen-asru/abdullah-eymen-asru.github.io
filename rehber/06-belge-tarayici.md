[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · [🍴 Fork Kurulumu](./03-fork-kurulumu.md) · [☁️ Cloudflare Secret & Ayarlar](./04-cloudflare-secretlar.md) · [🔄 Dönüştürücü & Belge Düzenleyici](./05-donusturucu.md) · **📑 Belge Tarayıcı & Sıkıştırma**

---

# 06 — Belge Tarayıcı & Çoklu Birleştirici (Sıkıştırma + RAM Kalkanı)

**Sıfır sunucu maliyeti:** dosyalar yalnızca sekmenin belleğinde işlenir; Cloudflare Worker, Supabase, R2'ye **hiçbir dosya/istek gitmez**.
Ağ trafiği yalnızca açık kaynak kütüphane kodunun CDN'den indirilmesidir. **Yeni migration, secret, binding, bucket YOKTUR.**

## Kurulum
Ek adım yok. Yetki, Dönüştürücü ile **aynıdır** (`can_use_converter`, migration 0077) ve TEK yerden yönetilir: Panel → Yetki Ayarları → "Dönüştürücü, Belge Tarayıcı & Sıkıştırma" satırı. Araç içinde ayrı yetki paneli yoktur.
Menü: `Araçlar → 📑 Belge Tarayıcı & Birleştirici` (`#tool-belge-tarayici`). Modül, arayüz kurmadan önce `donusturucu_yetkisi_var_mi()` RPC'sini sorar (Guard).

## Dosyalar
`assets/js/belge-tarayici/` — `belge-tarayici.js` (giriş/arayüz), `girdi.js` (JPG/PNG/WEBP/TIFF/HEIC/PDF/DOCX ayıklama), `tarama.js` (perspektif +
Magic Color + Sauvola), `perspektif-arayuz.js` (4 pin + büyüteç), `sikistir.js` (profiller + canlı tahmin), `disa-aktar.js` (PDF/görsel/ZIP),
`bellek-kalkani.js` (RAM kalkanı). `assets/css/belge-tarayici.css`. Değişenler: `dashboard.js`, `panel/dashboard.html`, `donusturucu/cdn.js` (utif + pako).

## Sıkıştırma modeli
| Profil | A4 yoğunluğu | JPEG/WebP kalitesi |
|---|---|---|
| Düşük Boyut / Web | 110 DPI | %55 |
| Dengeli (önerilen) | 170 DPI | %80 |
| Orijinal / Arşiv | 300 DPI | %95 |

Kaydırıcılar (kalite %10–100, A4 DPI 72–300) profili "özel"e çevirir. Çözünürlük sınırı: Orijinal · 1080p (1920×1080) · 2K (2560×1440) · A4 (DPI × 8,27×11,69 in).
Küçük kaynaklar **büyütülmez**. PDF her zaman JPEG gömer; görsel/ZIP çıktısı JPEG/WebP/PNG olabilir. ZIP: DEFLATE seviye 6–9 (JPEG'de kazanç küçüktür).
**Canlı tahmin:** ortadaki bir sayfa seçili ayarlarla gerçekten işlenip kodlanır → piksel başına bayt ölçülür → tüm sayfalara ölçeklenir (±%15).

## Bellek kalkanı
Sıralı boru hattı (sayfa sayfa) · her tuval `tuvalBirak` ile `clearRect` + `width=height=0` · `ImageData`/`Uint8Array`/JSZip tamponları işlem bitince `null` ·
her `createObjectURL` kayıt defterinden geçer, `revokeObjectURL` ile bırakılır · perspektif/temizleme bantlıdır (192 satır) · iptal/hatada `finally` ile temizlik ·
sekme değişiminde "Sil ve ayrıl" sorusu, `pagehide`'da otomatik sıfırlama · arayüzde canlı sayaç (işlem sonrası açık tuval = 0).
Sınırlar: kuyruk 300 sayfa, tek dosya 250 MB.

## Bilinen sınırlar (bilerek)
- Metinli (vektör) PDF sayfaya çevrilir → seçilebilir metin kaybolur, dosya büyüyebilir. Tarama/fotoğraf PDF'lerinde küçülür. OCR yoktur.
- B&W modunda (Sauvola) içi dolu büyük renkli alanlar (mühür) halka gibi çıkabilir; mühür/imza için **Magic Color** kullan.
- Otomatik köşe algılama kâğıt–arka plan kontrastına dayanır; olmazsa pinleri elle yerleştir.
- TIFF: Safari yerel çözer; Chrome/Firefox UTIF.js (CDN) kullanır. DOCX: EMF/WMF/SVG görseller atlanır. HEIC: `'wasm-unsafe-eval'` CSP'de olmalı (05'te var).
- `utif@3.1.0` ve `pako@2.1.0` `sri: null` ile yüklenir (hash isteğe bağlı: 05 numaralı rehberdeki SRI yöntemi). **İlk canlı denemede bir TIFF aç** (bu ortamda ağ yoktu).

## Test edildi (headless Chromium, çevrimdışı; kütüphaneler yerelden servis edildi)
Eğik/gölgeli/sararmış fotoğraf → otomatik köşe + perspektif + Magic Color + B&W; PDF → sayfa ayıklama (2380×3368); DOCX → gömülü görseller belge sırasıyla; karışık kuyruk, üst üste ekleme, ok ile sıralama;
profil boyutları (web 130 KB / dengeli 181 KB / arşiv 282 KB, aynı sayfa); tahmin; PDF (A4) ve ZIP çıktısı (pdfinfo/unzip ile doğrulandı); iptal; 375 px taşma yok;
işlem sonrası açık tuval 0, sıfırlamadan sonra açık URL 0. **Çalıştırılamayanlar:** HEIC, UTIF/pako (TIFF), gerçek Supabase yetki RPC'si.

---

[📖 Site Rehberi](./01-site-rehberi.md) · [🔐 Supabase Sistemi](./02-supabase-sistemi.md) · [🍴 Fork Kurulumu](./03-fork-kurulumu.md) · [☁️ Cloudflare Secret & Ayarlar](./04-cloudflare-secretlar.md) · [🔄 Dönüştürücü & Belge Düzenleyici](./05-donusturucu.md) · **📑 Belge Tarayıcı & Sıkıştırma**
