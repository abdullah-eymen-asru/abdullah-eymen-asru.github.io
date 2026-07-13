---
layout: default
title: İzlediklerim
---

<h1>İzlediklerim</h1>
<p>
  İzlediğim film ve dizileri GitHub üzerinde
  <a href="https://github.com/{{ site.kutuphane_repo }}/issues?q=is%3Aissue+label%3Aizleme" target="_blank">issue olarak</a>
  not alıyorum. Liste aşağıda otomatik güncelleniyor.
</p>

<p class="format-hint">
  Her issue'nun açıklama kısmına şu formatta bilgi eklersen tabloya otomatik işlenir:<br>
  <code>Tür: Dizi</code> · <code>Puan: 8</code> · <code>Sezon/Bölüm: 1. Sezon 4. Bölüm</code> ·
  <code>Başlama Tarihi: 2026-07-07</code> · <code>Bitiş Tarihi: 2026-08-01</code>
</p>

<p class="format-hint">
  Bu repodaki issue'ları <a href="{{ site.izleme_projects_url }}" target="_blank">GitHub Projects panosu</a>
  üzerinden Kanban veya tablo formatında da görüntüleyebilirsin — ama buradaki tablo
  daha güncel ve aranabilir olduğu için doğrudan site üzerinden takip etmeni öneririm.
  Repo'nun kendisine <a href="https://github.com/abdullah-eymen-asru/izleme-okuma-listem" target="_blank">buradan</a> ulaşabilirsin.
</p>

<input
  type="text"
  id="izleme-search"
  class="search-box"
  placeholder="Film/dizi ara…"
  disabled>

<div id="tur-filtreleri" class="filter-chips"></div>

<div id="izlenenler-tablo" class="scroll-list">
  <p class="loading">Yükleniyor…</p>
</div>

<script>
(async function () {
  const repo = "{{ site.kutuphane_repo }}";
  const label = "izleme";
  const url = `https://api.github.com/repos/${repo}/issues?labels=${label}&state=all&per_page=100`;
  const container = document.getElementById("izlenenler-tablo");
  const searchBox = document.getElementById("izleme-search");

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

  // GitHub'dan gelen metinler (başlık, açıklama alanları) kullanıcı tarafından
  // yazılabildiği için doğrudan innerHTML'e basmıyoruz — HTML özel karakterlerini
  // (< > & " ') zararsız hale getirip öyle ekliyoruz. Bu, kötü niyetli bir issue
  // başlığının (örn. <script> içeren) tarayıcıda çalıştırılmasını engeller.
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
      const tur = alanlar["tür"] || alanlar["tur"] || "";
      const puan = alanlar["puan"] || "";
      const sezonBolum = alanlar["sezon/bölüm"] || alanlar["sezon/bolum"] || "";
      const baslamaTarihi = alanlar["başlama tarihi"] || alanlar["baslama tarihi"] || "";
      const bitisTarihi = alanlar["bitiş tarihi"] || alanlar["bitis tarihi"] || "";

      // arama kutusu için tüm alanları tek metinde birleştirip küçük harfe çeviriyoruz
      const searchText = [issue.title, tur, sezonBolum].join(" ").toLowerCase();

      rows += `
        <tr class="searchable" data-search="${escapeHtml(searchText)}" data-tur="${escapeHtml(tur.toLowerCase())}">
          <td><a href="${escapeHtml(issue.html_url)}" target="_blank">${escapeHtml(issue.title)}</a></td>
          <td>${escapeHtml(tur)}</td>
          <td>${escapeHtml(puan)}</td>
          <td>${escapeHtml(sezonBolum)}</td>
          <td>${escapeHtml(baslamaTarihi)}</td>
          <td>${escapeHtml(bitisTarihi)}</td>
        </tr>`;
    });

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Başlık</th><th>Tür</th><th>Puan</th>
            <th>Sezon/Bölüm</th><th>Başlama</th><th>Bitiş</th>
          </tr>
        </thead>
        <tbody id="izleme-tbody">${rows}</tbody>
      </table>`;

    // Tablodaki satırlardan benzersiz türleri topla, her biri için tıklanabilir
    // bir "chip" butonu oluştur. Yeni bir tür eklediğinde bu liste otomatik
    // güncellenir, elle hiçbir şey değiştirmene gerek yok.
    const tumSatirlar = Array.from(document.querySelectorAll("#izleme-tbody .searchable"));
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
        const ornekSatir = tumSatirlar.find(tr => tr.dataset.tur === tur);
        chip.textContent = ornekSatir.querySelector("td:nth-child(2)").textContent;
        chip.dataset.tur = tur;
        chipContainer.appendChild(chip);
      });

      chipContainer.addEventListener("click", (e) => {
        const chip = e.target.closest(".filter-chip");
        if (!chip) return;

        chipContainer.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        aktifTur = chip.dataset.tur || null;

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
