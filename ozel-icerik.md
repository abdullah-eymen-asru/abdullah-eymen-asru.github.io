---
layout: default
title: "Özel İçerik"
yayinda: true
---

<link rel="stylesheet" href="{{ '/assets/css/auth.css' | relative_url }}">

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <div id="icerik-govde"></div>

  <div id="dosya-indir-alani" hidden style="margin-top:24px;">
    <button id="dosya-indir-btn" class="btn-primary" style="width:auto;">Eki İndir</button>
    <p id="dosya-indir-status" class="muted"></p>
  </div>

  <p style="margin-top:32px;"><a href="{{ '/panel.html' | relative_url }}">&larr; Panelime dön</a></p>
</div>

<script type="module" src="{{ '/assets/js/ozel-icerik.js' | relative_url }}"></script>
