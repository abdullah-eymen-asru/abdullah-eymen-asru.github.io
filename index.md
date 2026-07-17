---
layout: default
title: Anasayfa
---

<div class="hero">
  {% if site.profile_image and site.profile_image != "" %}
  <img src="{{ site.profile_image | relative_url }}" alt="{{ site.title }}" class="profile-photo">
  {% endif %}

{{ site.includes_load | default: "" }}
{% capture hakkimda_icerik %}{% include hakkimda-kutusu.md %}{% endcapture %}
{{ hakkimda_icerik | markdownify }}

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


<div class="substack-embed-container" style="width: 100%; display: flex; justify-content: center; margin: 2.5em 0;">
  <!-- Siten aydınlık (Light) moddayken görünecek kutu -->
  <iframe 
    src="https://abdullaheymenasru.substack.com/embed?colors=%23ffffff%2C%23000000%2C%231a202c" 
    class="substack-light"
    width="100%" 
    height="180" 
    style="max-width: 500px; width: 100%; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; display: block;" 
    frameborder="0" 
    scrolling="no">
  </iframe>
</div>

<style>
  /* Siten eğer karanlık (Dark) moda geçerse, Substack'in renklerini ve kutusunu otomatik gece moduna uyarla */
  @media (prefers-color-scheme: dark) {
    .substack-embed-container iframe {
      content: url("https://abdullaheymenasru.substack.com/embed?colors=%231a202c%2C%23ffffff%2C%234a5568");
      border-color: #2d3748 !important;
      background: #1a202c !important;
    }
  }
</style>

{% if site.mirror_site_url and site.mirror_site_url != "" %}
<p class="format-hint" style="margin-top: 1.2em;">
  Bu site iki adreste eşzamanlı olarak yayınlanıyor:
  <a href="{{ site.url }}" target="_blank">{{ site.url }}</a> ·
  <a href="{{ site.mirror_site_url }}" target="_blank">{{ site.mirror_site_url }}</a>
</p>
{% endif %}
