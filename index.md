---
layout: default
title: Anasayfa
---

<div class="hero">
  {% if site.profile_image and site.profile_image != "" %}
  <img src="{{ site.profile_image | relative_url }}" alt="{{ site.title }}" class="profile-photo">
  {% endif %}

  {% include hakkimda-kutusu.md %}

  <div class="social-links">
    {% assign labels = "github:GitHub|linkedin:LinkedIn|twitter:X (Twitter)|instagram:Instagram|youtube:YouTube|nsosyal:NSosyal|orcid:ORCID|academia:Academia.edu|researchgate:ResearchGate|kitap1000:1000Kitap|playstore:Uygulama (Play Store)" | split: "|" %}
    {% for pair in labels %}
      {% assign parts = pair | split: ":" %}
      {% assign key = parts[0] %}
      {% assign label = parts[1] %}
      {% assign link = site.social[key] %}
      {% if link and link != "" %}
        <a href="{{ link }}" target="_blank">{{ label }}</a>
      {% endif %}
    {% endfor %}
    <a href="{{ site.substack_url }}" target="_blank">Substack</a>
  </div>
</div>

<div class="about-box">
  <h2 style="margin-top:0">Hakkımda</h2>
  {% include hakkimda-icerik.md %}
</div>

{% if site.mirror_site_url and site.mirror_site_url != "" %}
<p class="format-hint" style="margin-top: 1.2em;">
  Bu site iki adreste eşzamanlı olarak yayınlanıyor:
  <a href="{{ site.url }}" target="_blank">{{ site.url }}</a> ·
  <a href="{{ site.mirror_site_url }}" target="_blank">{{ site.mirror_site_url }}</a>
</p>
{% endif %}
