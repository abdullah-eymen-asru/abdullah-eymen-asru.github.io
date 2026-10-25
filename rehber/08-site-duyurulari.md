[⬅️ README'ye dön](../README.md)

---

# 📢 Site Duyuruları (bakım · yedekleme · felaket uyarı ekranı)

Migration: `supabase/migrations/0113_site_duyurulari_ve_havastil_ai_kasasi.sql`. Panel: **Sistem › 📢 Site Duyuruları**.

## Ne yapar
- **Ziyaretçiler:** siteye girince (panel hariç) bir **uyarı penceresi** (`<dialog>`) açılır; “Anladım”/Esc ile kapanır, bu tarayıcıda hatırlanır, içerik değişirse yeniden gösterilir.
- **Üyeler:** panelde en üstte **ince, kalıcı şerit** (sticky değil, içeriği örtmez; mobil/masaüstü uyumlu). ✕ ile kapatınca **okundu kaydı** (kim, ne zaman) tutulur.
- Site sahibi başlık + mesaj (düz metin, satır sonları korunur) + tür (Bilgi/Uyarı/Kritik) + hedef (ziyaretçi/üye/hepsi) + isteğe bağlı https bağlantısı + başlangıç/bitiş yazar; taslak olarak saklayabilir.
- **Kimler okudu:** ad, soyad ve e-posta ile **sunucuda** arama (en az 2 harf); e-posta **maskeli** döner (`ab***@g***.com`); yalnızca duyuruyu kapatan üyeler listelenir.

## Yetkiler
| İşlem | Site Sahibi | Yönetici (Yetki Ayarları › “Site Duyuruları” AÇIKSA) |
|---|---|---|
| Oluştur / düzenle / yayına al-kaldır | ✅ | ✅ |
| Okuyanları gör ve ara | ✅ | ✅ |
| Duyuruyu sil | ✅ | ❌ |
| Okuma kayıtlarını sil (tek üye / hepsi) | ✅ | ❌ |

Anahtar `duyuru_yonetimi` **varsayılan KAPALI**, yalnızca Yönetici sütunu. Gerçek sınır SQL’dedir (`duyuru_yonetim_yetkili()`, `is_owner()`); tablolara doğrudan erişim yoktur. Oluşturma/güncelleme/silme `denetim_kayitlari`na yazılır.

## Sınırlar (dürüst notlar)
- Statik sitede bu bir **bilgi penceresidir**, erişim kilidi değildir. Siteyi gerçekten kapatmak için Gatekeeper (Yetki Ayarları) kullanılır.
- Ziyaretçi “okundu”su sunucuya yazılmaz (anonim); yalnızca üye kapatmaları kayda geçer.
- Duyuru tabloları sistem yedeği tablo listesinde **yoktur** (okuma kayıtları kişisel veri olduğundan bilerek).
- Arama Türkçe büyük/küçük harf (İ/ı) farklarına karşı birebir duyarlı olmayabilir.
