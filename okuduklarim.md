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

<div id="okunanlar-tablo">
  <p class="loading">Yükleniyor…</p>
</div>

<script>
(async function () {
  const repo = "{{ site.kutuphane_repo }}";
  const label = "okuma";
  const url = `https://api.github.com/repos/${repo}/issues?labels=${label}&state=all&per_page=100`;
  const container = document.getElementById("okunanlar-tablo");

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
      const date = new Date(issue.created_at).toLocaleDateString("tr-TR", {
        year: "numeric", month: "short", day: "numeric"
      });
      const otherLabels = issue.labels
        .map(l => l.name)
        .filter(n => n !== "okuma")
        .map(n => `<span class="tag">${n}</span>`)
        .join(" ");

      rows += `
        <tr>
          <td><a href="${issue.html_url}" target="_blank">${issue.title}</a></td>
          <td>${otherLabels}</td>
          <td>${date}</td>
        </tr>`;
    });

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Başlık</th><th>Etiket</th><th>Tarih</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = '<p class="error">Liste yüklenemedi. Lütfen daha sonra tekrar dene.</p>';
    console.error(err);
  }
})();
</script>
