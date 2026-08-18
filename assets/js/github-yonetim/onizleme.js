/*
 * assets/js/github-yonetim/onizleme.js — /onizleme/?tur=blog|proje&kod=XXXXXXXX
 *
 * "Yayında değil" (gizli) blog yazıları ve akademik projeler artık GitHub
 * deposuna hiç commit edilmiyor, sadece Supabase'teki `taslak_icerikler`
 * tablosunda duruyor (bkz. supabase/migrations/0013_...sql). Bu sayfa,
 * URL'deki tur+kod'u bilen HERKESİN (giriş yapması gerekmez) içeriği
 * görebilmesini sağlıyor — ama SADECE tam eşleşen tek bir satırı döndüren
 * `taslak_onizleme_getir` RPC'si üzerinden; tabloyu doğrudan listeleyemez.
 *
 * Not: requireAuth() BİLEREK kullanılmıyor — bu link, siteye hiç kayıtlı
 * olmayan biriyle bile paylaşılabilmeli (tıpkı eski permalink yöntemindeki
 * gibi). Güvenlik, kodun tahmin edilemezliğinden (8 karakter, rastgele)
 * geliyor.
 */
import { supabase, escapeHtml, guvenliDisUrlMi } from "../core/supabase-client.js";

async function init() {
  const govdeEl = document.getElementById("onizleme-govde");
  const uyariEl = document.getElementById("onizleme-durum-uyarisi");

  const params = new URLSearchParams(window.location.search);
  const tur = params.get("tur");
  const kod = params.get("kod");

  if (!tur || !kod || !["blog", "proje"].includes(tur)) {
    if (uyariEl) uyariEl.hidden = true;
    govdeEl.innerHTML = `<h1>Geçersiz bağlantı</h1><p>Bu linkte gerekli bilgiler eksik ya da hatalı.</p>`;
    return;
  }

  try {
    const { data, error } = await supabase.rpc("taslak_onizleme_getir", {
      p_tur: tur,
      p_kod: kod,
    });

    const kayit = Array.isArray(data) ? data[0] : data;

    if (error || !kayit) {
      if (uyariEl) uyariEl.hidden = true;
      govdeEl.innerHTML = `
        <h1>İçerik bulunamadı</h1>
        <p>Bu link artık geçerli değil — içerik yayına alınmış, silinmiş
        ya da linkin kodu değiştirilmiş olabilir. Doğru linke sahip
        olduğundan emin değilsen içeriği paylaşan kişiyle iletişime geç.</p>`;
      return;
    }

    document.title = `${kayit.baslik} · Ön İzleme`;

    let metaHtml = "";
    if (tur === "proje") {
      const parcalar = [];
      if (kayit.venue) parcalar.push(escapeHtml(kayit.venue));
      if (kayit.tarih) parcalar.push(new Date(kayit.tarih).getFullYear());
      if (kayit.durum) parcalar.push(`<span class="tag">${escapeHtml(kayit.durum)}</span>`);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    } else if (kayit.tarih) {
      metaHtml = `<div class="meta">${new Date(kayit.tarih).toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })}</div>`;
    }

    let html = `<h1>${escapeHtml(kayit.baslik)}</h1>${metaHtml}`;
    html += `<div class="project-body">${basitMarkdown(kayit.govde || "")}</div>`;
    // GÜVENLİK: href'e basmadan önce şema kontrolü (bkz. guvenliDisUrlMi
    // yorumu) — "javascript:" gibi bir URI hiç render edilmez.
    if (tur === "proje" && kayit.link && guvenliDisUrlMi(kayit.link)) {
      html += `<p style="margin-top:2em;"><a href="${escapeHtml(kayit.link)}" target="_blank" rel="noopener">→ ${escapeHtml(
        kayit.link_etiket || "Bağlantıyı görüntüle"
      )}</a></p>`;
    }

    govdeEl.innerHTML = html;
  } catch (err) {
    console.error("onizleme.js init hatası:", err);
    if (uyariEl) uyariEl.hidden = true;
    govdeEl.innerHTML = `<p>Bir şeyler ters gitti, sayfayı yenilemeyi dene.</p>`;
  }
}

/** ozel-icerik.js ile aynı, bağımlılıksız basit markdown->HTML dönüşümü (bkz. o dosyadaki açıklama). */
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
