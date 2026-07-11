---
layout: default
title: Anasayfa
---

<div class="hero">
  <h1>Merhaba, ben Abdullah Eymen Asru 👋</h1>
  <p class="subtitle">Kısa unvan / bölüm bilgin (örn: Doktora Öğrencisi, XYZ Üniversitesi)</p>

  <div class="social-links">
    {% assign labels = "github:GitHub|linkedin:LinkedIn|twitter:X (Twitter)|instagram:Instagram|youtube:YouTube|nsosyal:NSosyal|orcid:ORCID|academia:Academia.edu|researchgate:ResearchGate|kitap1000:1000Kitap|playstore:Uygulama (Google Play Store)" | split: "|" %}
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
  <p>
    Burada kendinle ilgili 3-5 cümlelik kısa bir tanıtım yazacaksın: akademik ilgi
    alanların, şu an üzerinde çalıştığın konu, ve varsa kısa bir kişisel not.
    Örnek: "İlgi alanlarım X ve Y üzerine yoğunlaşıyor. Şu anda Z Üniversitesi'nde
    ... konusunda araştırma yapıyorum. Boş zamanlarımda film izlemeyi ve kitap
    okumayı seviyorum — bunları da sitenin ilgili sekmelerinde paylaşıyorum."
  </p>
</div>
