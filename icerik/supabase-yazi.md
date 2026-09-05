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

<article class="project-detail" id="supabase-yazi-app"
  data-site-title="{{ site.title | escape }}"
  data-site-url="{{ site.url | escape }}"
  {% if site.adsense_client_id and site.adsense_client_id != "" %}
  data-adsense-client="{{ site.adsense_client_id }}"
  data-adsense-slot="{{ site.adsense_slot_icerik_alt }}"
  {% endif %}>
  <a href="#" id="supabase-yazi-geri-link" class="back-link">← Geri</a>

  <div id="supabase-yazi-govde">
    <p class="loading">Yükleniyor...</p>
  </div>
</article>

{% if site.adsense_client_id and site.adsense_client_id != "" %}
<script>
  // bkz. assets/js/core/site-islemleri.js reklamUygula() — bu şablon TEK
  // (hangi içeriğin gösterileceği ancak çalışma zamanında, bir RPC ile
  // belli olan) bir sayfa olduğu için, sayfa açılışında otomatik reklam
  // yüklemesi burada TETİKLENMEZ; supabase-yazi.js kendi çektiği kaydın
  // `reklam` alanına bakıp uygunsa window.__cerezReklamYukle()'yi
  // KENDİSİ, elle çağırır. Bu satır bu tetiklemeyi ("Reklam" onayı zaten
  // verilmişse sayfa açılır açılmaz otomatik ateşlenecek genel kuralı)
  // devre dışı bırakmak için var; site-islemleri.js deferred olduğu için
  // (bkz. _layouts/default.html) bu inline script HER ZAMAN ondan önce
  // çalışır.
  window.__reklamOtomatikYuklemeKapali = true;
</script>
{% endif %}

<script type="module" src="{{ '/assets/js/github-yonetim/supabase-yazi.js' | relative_url }}"></script>
