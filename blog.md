---
layout: default
title: Blog
---

<h1>Blog</h1>
<p>
  Yazılarımı <a href="{{ site.substack_url }}" target="_blank">Substack</a> üzerinde
  yayınlıyorum. Son yazılar aşağıda otomatik listeleniyor.
</p>

<div id="substack-posts">
  <p class="loading">Yazılar yükleniyor…</p>
</div>

<script>
(async function () {
  const feedUrl = "{{ site.substack_feed }}";
  const proxyUrl = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feedUrl);
  const container = document.getElementById("substack-posts");

  // BURAYA Substack'teki section adını birebir yaz (büyük/küçük harf önemli değil)
  const ISTENEN_SECTION = "Türkçe";

  try {
    const res = await fetch(proxyUrl);
    const data = await res.json();

    if (data.status !== "ok" || !data.items || data.items.length === 0) {
      throw new Error("Feed boş veya erişilemedi");
    }

    // Sadece istenen section'a ait postları bırak, gerisini ele
    const filtered = data.items.filter(item => {
      const categories = item.categories || [];
      return categories.some(
        cat => cat.toLowerCase() === ISTENEN_SECTION.toLowerCase()
      );
    });

    if (filtered.length === 0) {
      container.innerHTML =
        '<p class="loading">Bu bölümde henüz yazı yok, ya da section adı eşleşmiyor. ' +
        'Kod içindeki ISTENEN_SECTION değerini kontrol et.</p>';
      return;
    }

    container.innerHTML = "";
    filtered.slice(0, 15).forEach(item => {
      const date = new Date(item.pubDate).toLocaleDateString("tr-TR", {
        year: "numeric", month: "long", day: "numeric"
      });
      // description'dan HTML etiketlerini temizleyip kısa özet çıkar
      const plain = item.description.replace(/<[^>]*>/g, "").slice(0, 180);

      const card = document.createElement("div");
      card.className = "post-card";
      card.innerHTML = `
        <h3><a href="${item.link}" target="_blank">${item.title}</a></h3>
        <div class="meta">${date}</div>
        <p>${plain}…</p>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML =
      '<p class="error">Yazılar otomatik yüklenemedi. ' +
      '<a href="{{ site.substack_url }}" target="_blank">Substack sayfamı buradan ziyaret edebilirsin</a>.</p>';
    console.error(err);
  }
})();
</script>

<hr style="margin:3em 0; border:none; border-top:1px solid var(--border);">

<h2>Notlarım</h2>
<p>Bazı yazılara kendi notlarımı/eklerimi burada da tutuyorum:</p>

{% for post in site.posts %}
<div class="post-card">
  <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
  <div class="meta">{{ post.date | date: "%d %B %Y" }}</div>
  <p>{{ post.excerpt }}</p>
</div>
{% endfor %}
