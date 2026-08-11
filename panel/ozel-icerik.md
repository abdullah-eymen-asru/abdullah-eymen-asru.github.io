---
layout: default
title: "Özel İçerik"
yayinda: true
auth_css: true
permalink: "/panel/ozel-icerik.html"
---

<div class="loading-overlay" id="loading">Yükleniyor...</div>

<div id="app" hidden>
  <div id="okundu-manuel-wrap" class="okundu-manuel-wrap" hidden>
    <button id="okundu-manuel-btn" type="button" class="okundu-manuel-btn">✓ Okundum olarak işaretle</button>
  </div>
  <div id="icerik-govde"></div>

  <div id="dosya-indir-alani" hidden style="margin-top:24px;">
    <button id="dosya-indir-btn" class="btn-primary" style="width:auto;">Eki İndir</button>
    <p id="dosya-indir-status" class="muted"></p>
  </div>

  <div id="harici-dosya-alani" hidden style="margin-top:24px;">
    <a id="harici-dosya-link" class="btn-primary" style="width:auto;display:inline-block;text-decoration:none;" target="_blank" rel="noopener">Büyük Dosyayı İndir (harici bağlantı)</a>
    <p class="muted" style="margin-top:6px;">Bu dosya boyutu nedeniyle harici bir depolama alanında (Cloudflare R2) barındırılıyor.</p>
  </div>

  <p style="margin-top:32px;"><a href="{{ '/panel/panel.html' | relative_url }}">&larr; Panelime dön</a></p>
</div>

<script type="module" src="{{ '/assets/js/ozel-icerik.js' | relative_url }}"></script>
