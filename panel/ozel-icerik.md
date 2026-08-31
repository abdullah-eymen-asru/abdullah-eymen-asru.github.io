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

  <div class="csp-mt-24" id="dosya-indir-alani" hidden>
    <button id="dosya-indir-btn" class="btn-primary csp-w-auto">Eki İndir</button>
    <p id="dosya-indir-status" class="muted"></p>
  </div>

  <div class="csp-mt-24" id="harici-dosya-alani" hidden>
    <a id="harici-dosya-link" class="btn-primary csp-inline-block-link-2" target="_blank" rel="noopener noreferrer">Büyük Dosyayı İndir (harici bağlantı)</a>
    <p class="muted csp-mt-6">Bu dosya boyutu nedeniyle harici bir depolama alanında (Cloudflare R2) barındırılıyor.</p>
  </div>

  <p class="csp-mt-32"><a href="{{ '/panel/panel.html' | relative_url }}">&larr; Panelime dön</a></p>
</div>

<script type="module" src="{{ '/assets/js/ozel-icerik.js' | relative_url }}"></script>
