---
layout: default
title: Okuduklarım
---

<h1>Okuduklarım</h1>
<p>
  Okuduğum kitapları
  <a href="{{ site.okuma_projects_url }}" target="_blank">GitHub Projects panosunda</a>
  kayıt altına alıyorum. Bu tablo, panoya her yeni kayıt eklendiğinde
  <strong>anlık olarak</strong> güncellenir — sayfayı her açtığında en güncel
  veriyi görürsün.
</p>

<p class="format-hint">
  Repo'nun kendisine <a href="https://github.com/abdullah-eymen-asru/izleme-okuma-listem" target="_blank">buradan</a> ulaşabilirsin.
</p>

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

<div id="okunanlar-tablo" class="scroll-list">
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
