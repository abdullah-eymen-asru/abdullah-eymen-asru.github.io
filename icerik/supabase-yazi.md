---
layout: default
title: "Yazı"
permalink: "/icerik/supabase-yazi.html"
sitemap: false
---

<!--
  /icerik/supabase-yazi.html?tur=blog|proje&slug=...

  GitHub'a hiç commit edilmemiş ama GERÇEKTEN yayında olan (bkz.
  panel/github-yonetim.md "🅲️ Sadece Supabase'te Yayınla" seçeneği ve
  migration 0015) blog yazıları / akademik projeler için detay sayfası.

  /onizleme/ sayfasından farkı: /onizleme/ tahmin edilemez GİZLİ bir kod
  gerektirir (RLS'i by-pass eden taslak_onizleme_getir RPC'si SADECE
  yayin_durumu='taslak' satırlarına bakar) ve arama motorları tarafından
  indekslenmez; bu sayfa ise herkese açık bir slug kullanır
  (sadece_supabase_yazi_getir RPC'si SADECE yayin_durumu='sadece_supabase'
  satırlarına bakar) ve normal bir yazı gibi paylaşılabilir/indekslenebilir.
-->

<article class="project-detail" id="supabase-yazi-app">
  <a href="#" id="supabase-yazi-geri-link" class="back-link">← Geri</a>

  <div id="supabase-yazi-govde">
    <p class="loading">Yükleniyor...</p>
  </div>
</article>

<script type="module" src="{{ '/assets/js/github-yonetim/supabase-yazi.js' | relative_url }}"></script>
