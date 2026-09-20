---
layout: default
title: "Üye Ayarları"
yayinda: true
auth_css: true  # yönlendirme bir anlık da olsa: btn-primary gibi sınıflar stilsiz görünmesin
permalink: "/panel/uye-ayarlari.html"
---

<!--
  ESKİ PANEL SAYFASI — ARTIK SADECE YÖNLENDİRME.

  Bu sayfanın tüm içeriği /panel/dashboard.html içindeki "Üye Ayarları"
  sekmesine taşındı (markup birebir, id'ler değiştirilmeden). Sayfa
  SİLİNMEDİ, çünkü bu URL yer imlerinde, eski mesajlarda, Supabase'in
  OAuth redirect listesinde ya da gözden kaçmış bir linkte hâlâ geçiyor
  olabilir — 404 vermek yerine kullanıcıyı doğru sekmeye bırakıyoruz.

  Yönlendirme mantığı assets/js/core/eski-panel-yonlendir.js içinde
  (CSP inline script'e izin vermediği için ayrı dosya). Hedef sekme
  aşağıdaki data-hedef özniteliğinde; gelen adreste zaten bir hash
  varsa (ör. OAuth dönüşündeki #access_token=...) o korunur.

  JavaScript kapalıysa aşağıdaki link elle tıklanabilir — panelin
  kendisi zaten baştan sona JS (Supabase) ile çalıştığı için JS'siz
  bir kullanım senaryosu yok.
-->

<div id="eski-panel-yonlendir" data-hedef="#users-uye"></div>

<h1>Panel taşındı</h1>
<p class="muted">
  Bu sayfa artık birleşik yönetim panelinin <strong>Üye Ayarları</strong>
  sekmesi. Yönlendiriliyorsun&hellip;
</p>
<p>
  <a class="btn-primary csp-inline-block-link" href="{{ '/panel/dashboard.html' | relative_url }}#users-uye">
    Panele git
  </a>
</p>

<script type="module" src="{{ '/assets/js/core/eski-panel-yonlendir.js' | relative_url }}"></script>
