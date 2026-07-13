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

<input
  type="text"
  id="okuma-search"
  class="search-box"
  placeholder="Kitap/yazar ara…"
  disabled>

<div id="tur-filtreleri" class="filter-chips"></div>

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
          <td><a href="${escapeHtml(issue.html_url)}" target="_blank">${escapeHtml(issue.title)}</a></td>
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

    // Tablodaki satırlardan benzersiz türleri topla, her biri için tıklanabilir
    // bir "chip" butonu oluştur. Yeni bir tür (örn. "Şiir") eklediğinde bu liste
    // otomatik güncellenir, elle hiçbir şey değiştirmene gerek yok.
    const tumSatirlar = Array.from(document.querySelectorAll("#okuma-tbody .searchable"));
    const benzersizTurler = [...new Set(
      tumSatirlar.map(tr => tr.dataset.tur).filter(t => t !== "")
    )].sort();

    const chipContainer = document.getElementById("tur-filtreleri");
    let aktifTur = null;

    if (benzersizTurler.length > 0) {
      const tumuChip = document.createElement("button");
      tumuChip.className = "filter-chip active";
      tumuChip.type = "button";
      tumuChip.textContent = "Tümü";
      chipContainer.appendChild(tumuChip);

      benzersizTurler.forEach(tur => {
        const chip = document.createElement("button");
        chip.className = "filter-chip";
        chip.type = "button";
        // orijinal (küçük harfe çevrilmemiş) görünümü tablo satırından bulup gösteriyoruz
        const ornekSatir = tumSatirlar.find(tr => tr.dataset.tur === tur);
        chip.textContent = ornekSatir.querySelector("td:nth-child(3)").textContent;
        chip.dataset.tur = tur;
        chipContainer.appendChild(chip);
      });

      chipContainer.addEventListener("click", (e) => {
        const chip = e.target.closest(".filter-chip");
        if (!chip) return;

        chipContainer.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        aktifTur = chip.dataset.tur || null; // "Tümü" chip'inin dataset.tur'u yok, o yüzden null olur

        uygulaFiltre();
      });
    }

    function uygulaFiltre() {
      const q = searchBox.value.trim().toLowerCase();
      tumSatirlar.forEach(tr => {
        const metinEslesiyor = tr.dataset.search.includes(q);
        const turEslesiyor = !aktifTur || tr.dataset.tur === aktifTur;
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
