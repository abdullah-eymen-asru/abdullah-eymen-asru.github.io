/*
 * assets/js/supabase-yazi.js — /icerik/supabase-yazi.html?tur=blog|proje&slug=...
 *
 * "Sadece Supabase'te Yayınla" (bkz. panel/github-yonetim.md, migration
 * 0015) seçeneğiyle yayınlanmış, GitHub'a hiç commit edilmemiş ama
 * GERÇEKTEN yayında olan içerikleri gösterir. requireAuth() BİLEREK
 * kullanılmıyor — bu içerik zaten herkese açık/yayında, tıpkı normal bir
 * GitHub tabanlı blog yazısı/proje gibi giriş yapmamış ziyaretçiler de
 * görebilmeli.
 */
import { supabase, escapeHtml } from "./supabase-client.js";

function relUrl(path) {
  const base = document.documentElement.dataset.baseurl || "";
  return base + path;
}

async function init() {
  const govdeEl = document.getElementById("supabase-yazi-govde");
  const geriLink = document.getElementById("supabase-yazi-geri-link");

  const params = new URLSearchParams(window.location.search);
  const tur = params.get("tur");
  const slug = params.get("slug");

  if (geriLink) {
    geriLink.href = relUrl(tur === "proje" ? "/icerik/akademik-projeler.html" : "/icerik/blog.html");
    geriLink.textContent = tur === "proje" ? "← Tüm projeler" : "← Bloga dön";
  }

  if (!tur || !slug || !["blog", "proje"].includes(tur)) {
    govdeEl.innerHTML = `<h1>Geçersiz bağlantı</h1><p>Bu linkte gerekli bilgiler eksik ya da hatalı.</p>`;
    return;
  }

  try {
    const { data, error } = await supabase.rpc("sadece_supabase_yazi_getir", {
      p_tur: tur,
      p_slug: slug,
    });

    const kayit = Array.isArray(data) ? data[0] : data;

    if (error || !kayit) {
      govdeEl.innerHTML = `
        <h1>İçerik bulunamadı</h1>
        <p>Bu yazı artık burada değil — GitHub'a taşınmış, silinmiş ya da
        adresi değişmiş olabilir.</p>`;
      return;
    }

    document.title = kayit.baslik;

    let metaHtml = "";
    if (tur === "proje") {
      const parcalar = [];
      if (kayit.venue) parcalar.push(escapeHtml(kayit.venue));
      if (kayit.tarih) parcalar.push(new Date(kayit.tarih).getFullYear());
      if (kayit.durum) parcalar.push(`<span class="tag">${escapeHtml(kayit.durum)}</span>`);
      if (kayit.yazar_adi) parcalar.push(`✍️ ${escapeHtml(kayit.yazar_adi)}`);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    } else {
      const parcalar = [];
      if (kayit.tarih) {
        parcalar.push(
          new Date(kayit.tarih).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })
        );
      }
      if (kayit.yazar_adi) parcalar.push(`✍️ ${escapeHtml(kayit.yazar_adi)}`);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    }

    let html = `<h1>${escapeHtml(kayit.baslik)}</h1>${metaHtml}`;
    html += `<div class="project-body">${basitMarkdown(kayit.govde || "")}</div>`;
    if (tur === "proje" && kayit.link) {
      html += `<p style="margin-top:2em;"><a href="${escapeHtml(kayit.link)}" target="_blank" rel="noopener">→ ${escapeHtml(
        kayit.link_etiket || "Bağlantıyı görüntüle"
      )}</a></p>`;
    }

    govdeEl.innerHTML = html;
  } catch (err) {
    console.error("supabase-yazi.js init hatası:", err);
    govdeEl.innerHTML = `<p>Bir şeyler ters gitti, sayfayı yenilemeyi dene.</p>`;
  }
}

/** onizleme.js / ozel-icerik.js ile aynı, bağımlılıksız basit markdown->HTML dönüşümü. */
function basitMarkdown(md) {
  const esc = escapeHtml(md);
  return esc
    .split(/\n{2,}/)
    .map((blok) => {
      if (/^### /.test(blok)) return `<h3>${blok.slice(4)}</h3>`;
      if (/^## /.test(blok)) return `<h2>${blok.slice(3)}</h2>`;
      if (/^# /.test(blok)) return `<h1>${blok.slice(2)}</h1>`;
      let satir = blok
        .replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replaceAll(/\*(.+?)\*/g, "<em>$1</em>")
        .replaceAll(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replaceAll(/\n/g, "<br>");
      return `<p>${satir}</p>`;
    })
    .join("\n");
}

init();
