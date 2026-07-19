---
layout: default
title: Blog
---

<h1>Blog</h1>
<p>
  Yazılarımı <a href="{{ site.substack_url }}" target="_blank">Substack</a> üzerinde
  yayınlıyorum.
</p>

<div class="blog-columns">

  <div class="blog-column">
    <h2>Substack Yazıları</h2>
    <input
      type="text"
      id="substack-search"
      class="search-box"
      placeholder="Yazı ara…"
      disabled>

    <div id="substack-posts" class="scroll-list">
      <p class="loading">Yazılar yükleniyor…</p>
    </div>
  </div>

  <div class="blog-column">
    <h2>Notlarım</h2>
    <input
      type="text"
      id="notes-search"
      class="search-box"
      placeholder="Notlarımda ara…">

    <div id="notes-posts" class="scroll-list">
      {% assign yayindaki_yazilar = site.posts | where_exp: "p", "p.yayinda != false" | where_exp: "p", "p.date <= site.time" %}
      {% for post in yayindaki_yazilar %}
      <div class="post-card searchable" data-search="{{ post.title | downcase }} {{ post.excerpt | strip_html | downcase }}">
        <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
        <div class="meta">{{ post.date | date: "%d %B %Y" }}</div>
        <p>{{ post.excerpt }}</p>
      </div>
      {% endfor %}
      {% if yayindaki_yazilar.size == 0 %}
        <p class="loading">Henüz not eklenmedi.</p>
      {% endif %}
    </div>
  </div>

</div>

<script>
(async function () {
  const feedUrl = "{{ site.substack_feed }}";
  const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(feedUrl);
  const container = document.getElementById("substack-posts");
  const searchBox = document.getElementById("substack-search");

  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("Proxy isteği başarısız: " + res.status);
    const xmlText = await res.text();

    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");
    const items = Array.from(xml.querySelectorAll("item"));

    if (items.length === 0) {
      throw new Error("Feed boş veya ayrıştırılamadı");
    }

    // RSS'ten gelen metinler innerHTML'e basılmadan önce HTML özel
    // karakterlerinden arındırılıyor (XSS koruması).
    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text == null ? "" : String(text);
      return div.innerHTML;
    }

    // Substack'in RSS'i açıklamaları "&#252;" gibi HTML entity kodlarıyla
    // gönderiyor (ü, ', " gibi karakterler için). Bunları gerçek karaktere
    // çevirmek için tarayıcının kendi HTML ayrıştırıcısını kullanıyoruz.
    // ÖNEMLİ: Bu adım entity'leri çözer ama aynı zamanda metni geçici olarak
    // gerçek HTML'e çevirdiği için, sonucu SADECE .textContent ile okuyoruz
    // (asla innerHTML olarak geri basmıyoruz) — bu yüzden güvenlik açığı oluşturmaz.
    function decodeEntities(text) {
      const el = document.createElement("textarea");
      el.innerHTML = text;
      return el.textContent;
    }

    // Ekstra savunma katmanı: link http(s):// ile başlamalı VE içinde
    // boşluk/kontrol karakteri olmamalı. Bu özellikle burada önemli çünkü
    // RSS içeriği bir ÜÇÜNCÜ PARTİ proxy'den (api.allorigins.win) geçiyor —
    // proxy'ye veya Substack'e güvenmek yerine, gelen link'i kendi
    // tarafımızda da doğruluyoruz.
    function guvenliLink(url) {
      if (typeof url !== "string") return "#";
      const trimmed = url.trim();
      if (/^https?:\/\/[^\s<>"']+$/i.test(trimmed)) return trimmed;
      return "#";
    }

    container.innerHTML = "";
    items.forEach(item => {
      const titleRaw = item.querySelector("title")?.textContent?.trim() || "(başlıksız)";
      const link = item.querySelector("link")?.textContent?.trim() || "#";
      const pubDateRaw = item.querySelector("pubDate")?.textContent;
      const descRaw = item.querySelector("description")?.textContent || "";

      const title = decodeEntities(titleRaw);
      const date = pubDateRaw
        ? new Date(pubDateRaw).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })
        : "";
      // önce HTML etiketlerini temizle, sonra entity'leri çöz
      const withoutTags = descRaw.replace(/<[^>]*>/g, "");
      const plain = decodeEntities(withoutTags).slice(0, 180);

      const card = document.createElement("div");
      card.className = "post-card searchable";
      // arama için başlık+özet küçük harfe çevrilip veri olarak saklanıyor
      card.dataset.search = (title + " " + plain).toLowerCase();
      card.innerHTML = `
        <h3><a href="${escapeHtml(guvenliLink(link))}" target="_blank">${escapeHtml(title)}</a></h3>
        <div class="meta">${escapeHtml(date)}</div>
        <p>${escapeHtml(plain)}…</p>
      `;
      container.appendChild(card);
    });

    // Veri geldikten sonra arama kutusunu aktif hale getiriyoruz
    searchBox.disabled = false;
    searchBox.placeholder = "Yazı ara…";

  } catch (err) {
    container.innerHTML =
      '<p class="error">Yazılar otomatik yüklenemedi. ' +
      '<a href="{{ site.substack_url }}" target="_blank">Substack sayfamı buradan ziyaret edebilirsin</a>.</p>';
    console.error(err);
  }
})();

// Genel arama mantığı: bir arama kutusu + bir liste kutusunu birbirine bağlar.
// Hem Substack hem Notlarım sütunu bu aynı fonksiyonu kullanır.
function baglaArama(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const cards = list.querySelectorAll(".searchable");
    let visibleCount = 0;

    cards.forEach(card => {
      const match = card.dataset.search.includes(q);
      card.style.display = match ? "" : "none";
      if (match) visibleCount++;
    });

    // "sonuç yok" mesajını yönet
    let emptyMsg = list.querySelector(".no-results");
    if (visibleCount === 0 && q !== "") {
      if (!emptyMsg) {
        emptyMsg = document.createElement("p");
        emptyMsg.className = "loading no-results";
        emptyMsg.textContent = "Eşleşen sonuç bulunamadı.";
        list.appendChild(emptyMsg);
      }
    } else if (emptyMsg) {
      emptyMsg.remove();
    }
  });
}

baglaArama("substack-search", "substack-posts");
baglaArama("notes-search", "notes-posts");
</script>

