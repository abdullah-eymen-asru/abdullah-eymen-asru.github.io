---
layout: default
title: "CV"
permalink: "/cv/"
---

{% comment %}
  Bu sayfa sabit/kalıcı bir adrestir (abdullah-eymen-asru.github.io/cv) —
  CV'nin GERÇEK konumu (_config.yml -> cv_url, panelin "🙋 Hakkımda"
  sekmesinden yönetilir) zaman içinde değişse (PDF güncellense, dış bir
  linke taşınsa vb.) bile bu adres HİÇ değişmez, paylaştığın link kırılmaz.

  site.cv_url doluysa: sunucu taraflı (Liquid, build zamanında) hemen
  <meta http-equiv="refresh"> ile yönlendirir + aynı zamanda JS ile de
  dener (biri engellenirse diğeri çalışsın) + JS/meta hiç çalışmazsa diye
  tıklanabilir görünür bir link de her zaman gösterilir (erişilebilirlik —
  ekran okuyucu kullanan ya da otomatik yönlendirmeleri engelleyen biri de
  CV'ye ulaşabilsin).

  site.cv_url boşsa: yönlendirme yapılmaz, sadece "CV henüz eklenmedi"
  mesajı gösterilir (bu, admin CV'yi silene kadar burada kalır).
{% endcomment %}
{% if site.cv_url and site.cv_url != "" %}
<meta http-equiv="refresh" content="0; url={{ site.cv_url }}">
{% endif %}

<article class="project-detail">
  {% if site.cv_url and site.cv_url != "" %}
    <h1>CV'ye Yönlendiriliyorsunuz…</h1>
    <p>
      Otomatik olarak yönlendirilmediyseniz
      <a href="{{ site.cv_url }}" id="cv-link" rel="noopener noreferrer">buraya tıklayın</a>.
    </p>
    <script>
      window.location.replace(document.getElementById("cv-link").href);
    </script>
  {% else %}
    <h1>CV Henüz Eklenmedi</h1>
    <p class="muted">
      Bu sayfa, site sahibinin CV'sini eklediğinde otomatik olarak aktif
      olacaktır. Şu anda görüntülenecek bir CV bulunmuyor.
    </p>
    <p>
      <a href="{{ '/' | relative_url }}">Anasayfaya dön</a>
    </p>
  {% endif %}
</article>
