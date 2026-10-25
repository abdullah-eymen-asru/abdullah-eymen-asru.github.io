---
layout: default
title: "Oturum kalıcılığı, önbellek ve güncelleme mimarisi"
gizli_sayfa: true
---
# Oturum kalıcılığı, önbellek ve güncelleme

**Kod güncellemek kimseyi çıkış yaptırmamalı.** Mimari:

1. **Sürüm kimliği:** her Jekyll derlemesi `surum.json` ve sayfadaki `aea-build` etiketini yeniler.
2. **Güncel kod:** `sw-bildirim.js` aynı kaynaklı sayfa/JS/CSS isteklerini her seferinde ETag ile doğrular (GitHub Pages'in 10 dk önbelleği artık eski kod getirmez). Önbellek (Cache API) kullanılmaz.
3. **Panel:** sekme geçişinde yeni sürüm varsa panel hedef sekmeyle kendini yeniler; oturum localStorage'da kalır.
4. **Oturum koruyucu** (`assets/js/core/oturum-koruyucu.js`): beklenmedik düşüşleri sessizce kurtarır; bilinçli çıkış ve sunucu kararları (zorla çıkış, askıya alma) aynen geçerlidir.

## Hâlâ herkes çıkış yapıyorsa: Supabase panelini kontrol et
Authentication › Sessions: *Enforce single session per user*, *Time-box user sessions*, *Inactivity timeout* kapalı/uzun olmalı. Authentication › Settings: *Refresh token reuse interval* 30–60 sn önerilir. JWT secret'ı değiştirmek tüm oturumları düşürür. SQL migration'larında `auth.sessions` / `auth.refresh_tokens` silen sorgu çalıştırma.

## Migration sırası
`0114_worker_istatistik_adminlere_ve_oturum_koruma.sql`, ardından `0115_yetki_anahtari_uye_rolleri_duzeltme.sql`. Worker'lar: `sistem_yedek_worker`, `havastil_worker` yeniden deploy.
