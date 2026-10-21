---
layout: default
title: Anasayfa
---

<div class="hero">
  {% if site.profile_image and site.profile_image != "" %}
  <img src="{{ site.profile_image | relative_url }}" alt="{{ site.title }}" class="profile-photo">
  {% endif %}

  {% include hakkimda-kutusu.md %}

  {% comment %}
    TÜM bağlantılar doğrudan görünür (açılır menü/pop-up YOK). _config.yml -> social: her girdinin "category" alanı (akademik | sosyal |
    yazilim | okuma) gruplamayı belirler; panelden eklenen yeni girdiler de otomatik gelir. url boş girdiler atlanır.
    Kategorisi yazılmamış eski girdiler "sosyal" grubuna düşer.
  {% endcomment %}
  {% assign kategoriler = "akademik|Akademik & Araştırma,sosyal|Sosyal & İletişim,yazilim|Yazılım & Projeler,okuma|Okuma & Kültür" | split: "," %}
  <div class="baglanti-gruplar">
    {% for kat in kategoriler %}
      {% assign kv = kat | split: "|" %}
      {% capture grup_html %}
        {% for baglanti in site.social %}
          {% assign veri = baglanti[1] %}
          {% assign bk = veri.category | default: "sosyal" %}
          {% if veri.url and veri.url != "" and bk == kv[0] %}
            <a href="{{ veri.url | escape }}" target="_blank" rel="noopener noreferrer">{% include baglanti-ikon.html anahtar=baglanti[0] %}<span>{{ veri.label | default: baglanti[0] | escape }}</span></a>
          {% endif %}
        {% endfor %}
        {% if kv[0] == "okuma" and site.substack_url and site.substack_url != "" %}
          <a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">{% include baglanti-ikon.html anahtar="substack" %}<span>Substack</span></a>
        {% endif %}
      {% endcapture %}
      {% assign grup_temiz = grup_html | strip %}
      {% if grup_temiz != "" %}
      <section class="baglanti-grup" aria-label="{{ kv[1] }}">
        <h2 class="baglanti-grup-baslik">{{ kv[1] }}</h2>
        <div class="baglanti-listesi">{{ grup_temiz }}</div>
      </section>
      {% endif %}
    {% endfor %}
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
