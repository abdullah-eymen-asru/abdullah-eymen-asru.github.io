# 05 — Evrensel Dönüştürücü & Tarayıcı İçi Belge Düzenleyici

**Gizlilik ilkesi:** dosyalar yalnızca sekmenin belleğinde (File/Blob/ArrayBuffer) durur. Supabase'e, R2'ye, Worker'a ya da başka bir
sunucuya **gitmez**. Ağ trafiği yalnızca açık kaynak kütüphane kodunun CDN'den indirilmesidir. Yeni **secret/binding/bucket YOKTUR**
(bu yüzden `04-cloudflare-secretlar.md` değişmedi).

## Kurulum (sırayla)
1. Supabase SQL Editor'de `supabase/migrations/0077_donusturucu_yetkisi.sql` dosyasını **tek seferde** çalıştır (tekrar çalıştırmak güvenli).
2. Siteyi yayınla (CSP'ye `'wasm-unsafe-eval'` eklendi, aşağıya bak).
3. Panel → Yetki Ayarları → **🔄 Dönüştürücü** sekmesinden istediğin rolleri aç. Varsayılan: yalnızca owner.

## Yetki modeli
| Parça | Davranış |
|---|---|
| `can_use_converter` | rol bazlı (admin, manager, editor, special_user, user). Satır yok = **kapalı**. owner her zaman yetkili. |
| Menü | `Araçlar → Dönüştürücü & Editör`; yetkisiz rol hiç görmez (`dashboard.js › gorunurMu`, `izin:"donusturucu"`). |
| Guard | `#tool-donusturucu` adresine elle gidilirse `gorunurMu` yönlendirir; ayrıca modül kütüphane yüklemeden önce `donusturucu_yetkisi_var_mi()` RPC'sini sorar. |
| Yönetim | owner: 5 rolün hepsi + "Adminler de yönetebilsin" anahtarı. Yetkili admin (owner izin verdiyse): admin DIŞINDAKİ roller; araç içindeki "⚙️ Erişim yönetimi" kartından. Admin, admin rolünü ve bu anahtarı değiştiremez. |

> Dürüst not: araç statik, herkese açık sitede çalışan istemci kodudur. Guard menüyü, rotayı ve arayüzü korur; araç sunucu
> verisine dokunmadığı için korunacak gizli bir veri yoktur. Gerçek sınır, yetki RPC'leri ve tablolara istemci erişiminin kapalı olmasıdır.

## Dosyalar
- `assets/js/donusturucu/` — `donusturucu.js` (giriş), `tur-matrisi.js`, `donustur.js`, `belge-ir.js`, `belge-oku.js`, `belge-docx.js`,
  `belge-pdf.js`, `belge-epub.js`, `pdf-metin.js`, `motor-gorsel.js`, `motor-veri.js`, `temizle.js`, `zengin-duzenleyici.js`,
  `metin-duzenleyici.js`, `vurgu.js`, `pdf-duzenleyici.js`, `pdf-yukle.js`, `cdn.js`, `ortak.js`, `yetki-ortak.js`, `yetki-paneli.js`
- `assets/css/donusturucu.css`
- `supabase/migrations/0077_donusturucu_yetkisi.sql`

## Mimari
Her belge türü önce **temiz HTML pivotuna** çevrilir → ara temsil (IR) → hedef (docx / pdf / md / txt / epub / html). Böylece N×N
dönüşüm yerine N okuyucu + M yazıcı gerekir. HTML pivotu her zaman temizleyiciden geçer (`temizle.js`): DOMPurify (varsa) + yerleşik
katı izin listesi (her zaman). Uzak görseller kaldırılır (render sırasında ağ isteği oluşmasın).

## Kullanılan açık kaynak kütüphaneler (sürüm sabitli; jsDelivr → unpkg yedek)
| Kütüphane | Sürüm | Lisans | Amaç | SRI |
|---|---|---|---|---|
| pdfjs-dist | 5.6.205 | Apache-2.0 | PDF gösterim / metin / sayfa görseli (mevcut Akademik Kütüphane yükleyicisi) | motor.js |
| pdf-lib | 1.17.1 | MIT | PDF sayfa işlemleri, birleştirme, kayıt | motor.js |
| jszip | 3.10.1 | MIT/GPL-3 | ZIP / EPUB / çoklu çıktı | ✔ |
| docx | 9.6.1 | MIT | Word üretimi | ✔ |
| marked | 18.0.2 | MIT | Markdown → HTML | ✔ |
| mammoth | 1.8.0 | BSD-2 | Word → HTML | — |
| dompurify | 3.2.6 | Apache-2/MPL-2 | HTML temizleme | — |
| pdfmake | 0.2.20 | MIT | PDF üretimi (Roboto gömülü, Türkçe dahil) | — |
| heic2any | 0.0.4 | MIT | HEIC/HEIF çözme (yalnızca gerektiğinde, WASM) | — |

Editörler (zengin metin, metin/kod, PDF) ve CSV/JSON/XML, BMP/ICO, SVG sarmalama **bağımlılıksızdır** (kendi kodumuz).

### SRI (boş olanlar için)
```bash
curl -s https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```
Çıkan değeri `assets/js/donusturucu/cdn.js` içinde ilgili kütüphanenin `sri` alanına `"sha384-…"` olarak yaz.

## CSP değişikliği (tek token)
`_layouts/default.html` ve `_headers` içine `script-src 'self' https: 'wasm-unsafe-eval'` eklendi (önceden `default-src 'self' https:`
üzerinden aynı kaynaklar zaten serbestti; tek fark WebAssembly'e izin). JS `eval`'e izin **vermez**. Yalnız HEIC (iPhone) çözümü için
gerekir; istemezsen token'ı sil — HEIC dışındaki her şey çalışır. (`csp_hash_enjekte.rb` mevcut script-src'yi korur, hash ekler.)

## Bilinen sınırlar (bilerek)
- **PDF → Word/MD/…**: düzen birebir değil; metin/başlık/liste sezgiyle yeniden kurulur, tablolar düz akışa döner. Taranmış (metinsiz)
  PDF'te OCR yapılmaz; Word'e sayfa görüntüleri konur.
- **PDF kaydı**: sayfalar vektör olarak kopyalanır; açıklamalar her sayfada tek saydam PNG katmanı olarak işlenir (metin kutuları
  seçilebilir metin değil görüntü). Form alanları/yer imleri korunmaz. Parola korumalı PDF düzenlenemez (dönüştürülebilir).
- **PDF üretimi** Roboto ile (Latin/Latin-Ext/Kiril/Yunan). CJK/Arapça/emoji boş çıkabilir → HTML indirip tarayıcıdan "PDF olarak yazdır".
- **Raster → SVG**: vektörleştirme değil, gömülü görsel sarmalama. **ICO**: PNG gömülü (Vista+ ve tüm tarayıcılar).
- iOS Safari canvas sınırı (~16,7 MP): büyük görseller otomatik küçültülür ve kullanıcıya bildirilir.
- Dosya sınırı: tek dosya 250 MB, toplam 500 MB (tarayıcı belleği için güvenlik sınırı).

## Test edildi (headless Chromium, çevrimdışı)
Veri dönüşümleri, temizleyici (script/onclick/javascript:/uzak görsel), IR → md/txt/docx/epub, EPUB gidiş-dönüş, görsel → jpg/webp/bmp/ico/svg/pdf,
PDF → md/png/docx, PDF birleştirme, zengin editör (kalın, geri al/yinele, hizalama, tablo, yapıştırma temizliği), PDF editör (vurgu, çizim,
metin, döndürme, silme, sıralama, kayıt — çıktı poppler ile doğrulandı), taşma (375 px ve 1280 px), Guard (yetkisiz → arayüz kurulmaz).
Gerçek CDN'den yüklenen **mammoth, DOMPurify, pdfmake, heic2any** bu ortamda ağ olmadığı için çalıştırılamadı: ilk canlı denemede
DOCX→, →PDF ve HEIC dönüşümlerini bir kez dene (hata olursa konsolda sürüm/yol mesajı çıkar).
