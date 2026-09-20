---
layout: default
title: Anasayfa
---

<div class="hero">
  {% if site.profile_image and site.profile_image != "" %}
  <img src="{{ site.profile_image | relative_url }}" alt="{{ site.title }}" class="profile-photo">
  {% endif %}

  {% include hakkimda-kutusu.md %}

  <div class="baglanti-listesi">
    {% comment %}
      _config.yml -> social: altındaki HER girdi (sabit tanımlı olsun ya
      da panelden sonradan eklenmiş olsun FARK ETMEZ) buradan otomatik
      okunur — yeni bir platform eklemek için bu dosyanın değişmesine
      gerek yoktur (bkz. panel/github-yonetim.md "🔗 Bağlantılar" sekmesi).
      url boş ("") olan girdiler sessizce atlanır, hiç render edilmez.
    {% endcomment %}
    {% for baglanti in site.social %}
      {% assign veri = baglanti[1] %}
      {% if veri.url and veri.url != "" %}
        <a href="{{ veri.url | escape }}" target="_blank" rel="noopener noreferrer">{{ veri.label | default: baglanti[0] | escape }}</a>
      {% endif %}
    {% endfor %}
    <a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">Substack</a>
  </div>

  {% if site.cv_url and site.cv_url != "" %}
  <div class="cv-link-wrap">
    <a href="{{ '/cv/' | relative_url }}" class="cv-goruntule-btn">
      📄 CV Görüntüle
    </a>
  </div>
  {% endif %}

  {% if site.mirror_site_url and site.mirror_site_url != "" %}
  <p class="format-hint csp-mt-1-2em">
    Bu site iki adreste eşzamanlı olarak yayınlanıyor:
    <a href="{{ site.url }}" target="_blank" rel="noopener noreferrer">{{ site.url }}</a> ·
    <a href="{{ site.mirror_site_url }}" target="_blank" rel="noopener noreferrer">{{ site.mirror_site_url }}</a>
  </p>
  {% endif %}
</div>

<div class="about-box">
  {% include hakkimda-icerik.md %}
</div>
