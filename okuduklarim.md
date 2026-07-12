---
layout: default
title: Okuduklarım
---

<h1>Okuduklarım</h1>
<p>
  Okuduğum kitapları GitHub üzerinde
  <a href="https://github.com/{{ site.kutuphane_repo }}/issues?q=is%3Aissue+label%3Aokuma" target="_blank">issue olarak</a>
  not alıyorum. Liste aşağıda otomatik güncelleniyor.
</p>

<p class="format-hint">
  Her issue'nun açıklama kısmına şu formatta bilgi eklersen tabloya otomatik işlenir:<br>
  <code>Yazar: İsim Soyisim</code> · <code>Tür: Roman</code> · <code>Puan: 8</code> ·
  <code>Sayfa Sayısı: 320</code> · <code>Başlama Tarihi: 2026-07-07</code> · <code>Bitiş Tarihi: 2026-08-01</code>
</p>

<input
  type="text"
  id="okuma-search"
  class="search-box"
  placeholder="Kitap/yazar ara…"
  disabled>

<div id="okunanlar-tablo" class="scroll-list">
  <p class="loading">Yükleniyor…</p>
</div>

<script>
(async function () {
  const repo = "{{ site.kutuphane_repo }}";
  const label = "okuma";
  const url = `https://api.github.com/repos/${repo}/issues?labels=${label}&state=all&per_page=100`;
  const container = document.getElementById("okunanlar-tablo");
  const searchBox = document.getElementById("okuma-search");

  // Issue açıklamasındaki "Alan Adı: Değer" satırlarını okuyup bir obje haline getirir
  function bodyAyristir(body) {
    const alanlar = {};
    if (!body) return alanlar;
    body.split("\n").forEach(satir => {
      const eslesme = satir.match(/^([^:]+):\s*(.*)$/);
      if (eslesme) {
        const anahtar = eslesme[1].trim().toLowerCase();
        const deger = eslesme[2].trim();
        alanlar[anahtar] = deger;
      }
    });
    return alanlar;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("API isteği başarısız: " + res.status);
    const issues = await res.json();

    if (!Array.isArray(issues) || issues.length === 0) {
      container.innerHTML = '<p class="loading">Henüz eklenmiş bir kayıt yok.</p>';
      return;
    }

    let rows = "";
    issues.forEach(issue => {
      const alanlar = bodyAyristir(issue.body);
      const yazar = alanlar["yazar"] || "";
      const tur = alanlar["tür"] || alanlar["tur"] || "";
      const puan = alanlar["puan"] || "";
      const sayfaSayisi = alanlar["sayfa sayısı"] || alanlar["sayfa sayisi"] || "";
      const baslamaTarihi = alanlar["başlama tarihi"] || alanlar["baslama tarihi"] || "";
      const bitisTarihi = alanlar["bitiş tarihi"] || alanlar["bitis tarihi"] || "";

      const searchText = [issue.title, yazar, tur].join(" ").toLowerCase();

      rows += `
        <tr class="searchable" data-search="${searchText}">
          <td><a href="${issue.html_url}" target="_blank">${issue.title}</a></td>
          <td>${yazar}</td>
          <td>${tur}</td>
          <td>${puan}</td>
          <td>${sayfaSayisi}</td>
          <td>${baslamaTarihi}</td>
          <td>${bitisTarihi}</td>
        </tr>`;
    });

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Başlık</th><th>Yazar</th><th>Tür</th><th>Puan</th>
            <th>Sayfa</th><th>Başlama</th><th>Bitiş</th>
          </tr>
        </thead>
        <tbody id="okuma-tbody">${rows}</tbody>
      </table>`;

    searchBox.disabled = false;
    searchBox.addEventListener("input", () => {
      const q = searchBox.value.trim().toLowerCase();
      const trs = document.querySelectorAll("#okuma-tbody .searchable");
      trs.forEach(tr => {
        tr.style.display = tr.dataset.search.includes(q) ? "" : "none";
      });
    });

  } catch (err) {
    container.innerHTML = '<p class="error">Liste yüklenemedi. Lütfen daha sonra tekrar dene.</p>';
    console.error(err);
  }
})();
</script>
