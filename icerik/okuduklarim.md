---
layout: default
title: Okuduklarım
permalink: "/icerik/okuduklarim.html"
---

<h1>Okuduklarım</h1>

<div class="listeler-sekmeler">
  <a href="/icerik/izlediklerim.html" class="sekme-btn">🎬 İzlediklerim</a>
  <a href="/icerik/okuduklarim.html" class="sekme-btn aktif">📚 Okuduklarım</a>
</div>

<p>
  Okuduğum kitapları
  <a href="{{ site.okuma_projects_url }}" target="_blank" rel="noopener noreferrer">GitHub Projects panosunda</a>
  kayıt altına alıyorum. Bu tablo, panoya her yeni kayıt eklendiğinde
  <strong>anlık olarak</strong> güncellenir — sayfayı her açtığında en güncel
  veriyi görürsün.
</p>

<p class="format-hint">
  Repo'nun kendisine <a href="https://github.com/abdullah-eymen-asru/izleme-okuma-listem" target="_blank" rel="noopener noreferrer">buradan</a> ulaşabilirsin.
</p>

<!-- Sadece site sahibi (owner) girişliyken görünür — bkz.
     assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js. Diğer
     ziyaretçiler için bu script hiçbir şey render etmez, sayfa öncekiyle
     birebir aynı görünür. -->
<div id="izleme-okuma-yonetim-kisayol"></div>

<div class="filter-row">
  <input
    type="text"
    id="okuma-search"
    class="search-box"
    placeholder="Kitap/yazar ara…"
    disabled>

  <select id="tur-filtresi" class="tur-select" disabled>
    <option value="">Tüm türler</option>
  </select>
</div>

<div id="okunanlar-tablo" class="scroll-list scroll-list--tablo">
  <p class="loading">Yükleniyor…</p>
</div>

<script src="{{ '/assets/js/koleksiyon-tablo.js' | relative_url }}"></script>
<script>
  koleksiyonTablosuOlustur({
    jsonUrl: "{{ site.cloudflare_worker_url }}?project=okuma",
    containerId: "okunanlar-tablo",
    searchInputId: "okuma-search",
    turSelectId: "tur-filtresi",
    turFieldName: "Tür",
    aramaAlanlari: ["Yazar", "Tür", "Durum"],
    gizliAlanlar: [],
    sayfaBasinaKayit: 50
  });
</script>
<script type="module" src="{{ '/assets/js/izleme-okuma-yonetim/izleme-okuma-yonetim-kisayol.js' | relative_url }}"></script>
