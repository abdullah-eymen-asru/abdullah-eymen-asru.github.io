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

<p class="format-hint">
  Bu repodaki issue'ları <a href="{{ site.okuma_projects_url }}" target="_blank">GitHub Projects panosu</a>
  üzerinden Kanban veya tablo formatında da görüntüleyebilirsin — ama buradaki tablo
  daha güncel ve aranabilir olduğu için doğrudan site üzerinden takip etmeni öneririm.
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

  // GitHub'dan gelen metinler doğrudan innerHTML'e basılmadan önce
  // HTML özel karakterlerinden arındırılıyor (XSS koruması).
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  // Ekstra savunma katmanı: bir link "http(s)://" ile başlamıyorsa reddediyoruz.
  function guvenliLink(url) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
    return "#";
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
        <tr class="searchable" data-search="${escapeHtml(searchText)}" data-tur="${escapeHtml(tur.toLowerCase())}">
          <td><a href="${escapeHtml(guvenliLink(issue.html_url))}" target="_blank">${escapeHtml(issue.title)}</a></td>
          <td>${escapeHtml(yazar)}</td>
          <td>${escapeHtml(tur)}</td>
          <td>${escapeHtml(puan)}</td>
          <td>${escapeHtml(sayfaSayisi)}</td>
          <td>${escapeHtml(baslamaTarihi)}</td>
          <td>${escapeHtml(bitisTarihi)}</td>
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

    // Tablodaki satırlardan benzersiz türleri topla, açılır listeye (dropdown)
    // seçenek olarak ekle. Yeni bir tür eklediğinde bu liste otomatik güncellenir,
    // elle hiçbir şey değiştirmene gerek yok — 20-30 tür olsa bile ekranı doldurmaz.
    const tumSatirlar = Array.from(document.querySelectorAll("#okuma-tbody .searchable"));
    const benzersizTurler = [...new Set(
      tumSatirlar.map(tr => tr.dataset.tur).filter(t => t !== "")
    )].sort();

    const turSelect = document.getElementById("tur-filtresi");

    if (benzersizTurler.length > 0) {
      benzersizTurler.forEach(tur => {
        // orijinal (küçük harfe çevrilmemiş) görünümü tablo satırından bulup gösteriyoruz
        const ornekSatir = tumSatirlar.find(tr => tr.dataset.tur === tur);
        const gorunenAd = ornekSatir.querySelector("td:nth-child(3)").textContent;

        const option = document.createElement("option");
        option.value = tur;
        option.textContent = gorunenAd;
        turSelect.appendChild(option);
      });

      turSelect.disabled = false;
      turSelect.addEventListener("change", uygulaFiltre);
    }

    function uygulaFiltre() {
      const q = searchBox.value.trim().toLowerCase();
      const secilenTur = turSelect.value;
      tumSatirlar.forEach(tr => {
        const metinEslesiyor = tr.dataset.search.includes(q);
        const turEslesiyor = !secilenTur || tr.dataset.tur === secilenTur;
        tr.style.display = (metinEslesiyor && turEslesiyor) ? "" : "none";
      });
    }

    searchBox.disabled = false;
    searchBox.addEventListener("input", uygulaFiltre);

  } catch (err) {
    container.innerHTML = '<p class="error">Liste yüklenemedi. Lütfen daha sonra tekrar dene.</p>';
    console.error(err);
  }
})();
</script>
