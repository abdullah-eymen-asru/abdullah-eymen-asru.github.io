---
layout: default
title: Anasayfa
---

<div class="hero">
  <h1>Merhaba, ben Adın Soyadın 👋</h1>
  <p class="subtitle">Kısa unvan / bölüm bilgin (örn: Doktora Öğrencisi, XYZ Üniversitesi)</p>

  <div class="social-links">
    {% if site.social.github %}<a href="{{ site.social.github }}" target="_blank">GitHub</a>{% endif %}
    {% if site.social.linkedin %}<a href="{{ site.social.linkedin }}" target="_blank">LinkedIn</a>{% endif %}
    {% if site.social.twitter %}<a href="{{ site.social.twitter }}" target="_blank">Twitter / X</a>{% endif %}
    {% if site.social.instagram and site.social.instagram != "" %}<a href="{{ site.social.instagram }}" target="_blank">Instagram</a>{% endif %}
    {% if site.social.orcid and site.social.orcid != "" %}<a href="{{ site.social.orcid }}" target="_blank">ORCID</a>{% endif %}
    {% if site.social.googlescholar and site.social.googlescholar != "" %}<a href="{{ site.social.googlescholar }}" target="_blank">Google Scholar</a>{% endif %}
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
