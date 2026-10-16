---
layout: default
title: "HavaStil"
yayinda: true
gizli_sayfa: true
auth_css: true
permalink: "/panel/havastil/"
---

<link rel="stylesheet" href="{{ '/assets/css/havastil.css' | relative_url }}">

<div class="hv-sayfa">
  <h1>🌦️ HavaStil</h1>
  <p class="muted" id="hv-yukleniyor">Yükleniyor...</p>
  <div id="hv-kok"></div>
</div>

<script type="module" src="{{ '/assets/js/havastil/sayfa.js' | relative_url }}"></script>
