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
    TÜM bağlantılar doğrudan görünür (açılır menü/pop-up YOK). Gruplar _config.yml -> social_categories (Yönetim Paneli'nden eklenir/silinir; dosyaya
    HER ZAMAN Türkçe alfabetik sırada yazılır, burada o sıra aynen kullanılır). Her social girdisinin "category" alanı bir kategori kimliğidir.
    Kategorisi olmayan / silinmiş kategoriye bağlı girdiler en altta "Diğer" grubunda görünür. url boş girdiler atlanır.
  {% endcomment %}
  {% assign kat_haritasi = site.social_categories %}
  <div class="baglanti-gruplar">
    {% for kat in kat_haritasi %}
      {% assign kat_id = kat[0] %}
      {% assign kat_ad = kat[1] %}
      {% capture grup_html %}
        {% for baglanti in site.social %}
          {% assign veri = baglanti[1] %}
          {% if veri.url and veri.url != "" and veri.category == kat_id %}
            {% assign ikon_anahtar = baglanti[0] %}
            <a href="{{ veri.url | escape }}" target="_blank" rel="noopener noreferrer">{% include baglanti-ikon.html anahtar=ikon_anahtar %}<span>{{ veri.label | default: ikon_anahtar | escape }}</span></a>
          {% endif %}
        {% endfor %}
        {% if kat_id == "okuma" and site.substack_url and site.substack_url != "" %}
          <a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">{% include baglanti-ikon.html anahtar="substack" %}<span>Substack</span></a>
        {% endif %}
      {% endcapture %}
      {% assign grup_temiz = grup_html | strip %}
      {% if grup_temiz != "" %}
      <section class="baglanti-grup" aria-label="{{ kat_ad }}">
        <h2 class="baglanti-grup-baslik">{{ kat_ad }}</h2>
        <div class="baglanti-listesi">{{ grup_temiz }}</div>
      </section>
      {% endif %}
    {% endfor %}
    {% comment %} DİĞER: kategorisiz ya da kategorisi silinmiş bağlantılar (+ "okuma" kategorisi yoksa Substack). Hiçbir bağlantı kaybolmaz. {% endcomment %}
    {% capture diger_html %}
      {% for baglanti in site.social %}
        {% assign veri = baglanti[1] %}
        {% assign bilinen = kat_haritasi[veri.category] %}
        {% unless bilinen %}
          {% if veri.url and veri.url != "" %}
            {% assign ikon_anahtar = baglanti[0] %}
            <a href="{{ veri.url | escape }}" target="_blank" rel="noopener noreferrer">{% include baglanti-ikon.html anahtar=ikon_anahtar %}<span>{{ veri.label | default: ikon_anahtar | escape }}</span></a>
          {% endif %}
        {% endunless %}
      {% endfor %}
      {% unless kat_haritasi["okuma"] %}
        {% if site.substack_url and site.substack_url != "" %}
          <a href="{{ site.substack_url }}" target="_blank" rel="noopener noreferrer">{% include baglanti-ikon.html anahtar="substack" %}<span>Substack</span></a>
        {% endif %}
      {% endunless %}
    {% endcapture %}
    {% assign diger_temiz = diger_html | strip %}
    {% if diger_temiz != "" %}
    <section class="baglanti-grup" aria-label="Diğer">
      <h2 class="baglanti-grup-baslik">Diğer</h2>
      <div class="baglanti-listesi">{{ diger_temiz }}</div>
    </section>
    {% endif %}
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
