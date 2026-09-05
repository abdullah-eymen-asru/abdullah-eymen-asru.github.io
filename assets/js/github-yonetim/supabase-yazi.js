/*
 * assets/js/github-yonetim/supabase-yazi.js — /icerik/supabase-yazi.html?tur=blog|proje&slug=...
 *
 * "Sadece Supabase'te Yayınla" (bkz. panel/github-yonetim.md, migration
 * 0015) seçeneğiyle yayınlanmış, GitHub'a hiç commit edilmemiş ama
 * GERÇEKTEN yayında olan içerikleri gösterir. requireAuth() BİLEREK
 * kullanılmıyor — bu içerik zaten herkese açık/yayında, tıpkı normal bir
 * GitHub tabanlı blog yazısı/proje gibi giriş yapmamış ziyaretçiler de
 * görebilmeli.
 */
import { supabase, escapeHtml, guvenliDisUrlMi } from "../core/supabase-client.js";
import { okumaSuresiHesapla, pdfButonuHtml, tocOlustur } from "../okuma-araclari/okuma-meta-yardimci.js";

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

    const okumaSuresiMetni = okumaSuresiHesapla(kayit.govde);

    let metaHtml = "";
    if (tur === "proje") {
      const parcalar = [];
      if (kayit.venue) parcalar.push(escapeHtml(kayit.venue));
      if (kayit.tarih) parcalar.push(new Date(kayit.tarih).getFullYear());
      if (kayit.guncelleme_tarihi) {
        parcalar.push(
          `Güncellendi: ${new Date(kayit.guncelleme_tarihi).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}`
        );
      }
      if (kayit.durum) parcalar.push(`<span class="tag">${escapeHtml(kayit.durum)}</span>`);
      if (kayit.yazar_adi) parcalar.push(`Yazan: ${escapeHtml(kayit.yazar_adi)}`);
      parcalar.push(okumaSuresiMetni);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    } else {
      const parcalar = [];
      if (kayit.tarih) {
        parcalar.push(
          new Date(kayit.tarih).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })
        );
      }
      if (kayit.guncelleme_tarihi) {
        parcalar.push(
          `Güncellendi: ${new Date(kayit.guncelleme_tarihi).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}`
        );
      }
      if (kayit.yazar_adi) parcalar.push(`Yazan: ${escapeHtml(kayit.yazar_adi)}`);
      parcalar.push(okumaSuresiMetni);
      metaHtml = `<div class="meta">${parcalar.join(" · ")}</div>`;
    }

    let html = `<h1>${escapeHtml(kayit.baslik)}</h1>${metaHtml}`;
    html += pdfButonuHtml(kayit.pdf_url, escapeHtml);
    html += `<div class="project-body">${basitMarkdown(kayit.govde || "")}</div>`;
    // GÜVENLİK: href'e basmadan önce şema kontrolü (bkz. supabase-client.js
    // guvenliDisUrlMi yorumu) — "javascript:" gibi bir URI hiç render edilmez.
    if (tur === "proje" && kayit.link && guvenliDisUrlMi(kayit.link)) {
      html += `<p class="proje-baglanti-alani"><a href="${escapeHtml(kayit.link)}" target="_blank" rel="noopener noreferrer">→ ${escapeHtml(
        kayit.link_etiket || "Bağlantıyı görüntüle"
      )}</a></p>`;
    }

    govdeEl.innerHTML = html;

    // İÇİNDEKİLER: gövde DOM'a yazıldıktan SONRA (h2/h3'ler artık gerçek
    // elementler olarak var) üretilip, .project-body'nin HEMEN ÖNÜNE
    // (yazının en başına, PDF butonundan sonra) ekleniyor — bkz.
    // _layouts/post.html'deki <details class="akademik-toc"> ile aynı yer.
    const tocElementi = tocOlustur(govdeEl.querySelector(".project-body"), kayit.toc === true);
    if (tocElementi) {
      govdeEl.querySelector(".project-body").before(tocElementi);
    }

    // REKLAM (bkz. icerik/supabase-yazi.md ve assets/js/core/
    // site-islemleri.js reklamUygula) — bu sayfa şablonu TEK olduğu için
    // (hangi içerik gösterileceği ancak burada belli oluyor) reklam
    // yüklemesi sayfa açılışında OTOMATİK tetiklenmiyor; kaydın kendi
    // `reklam` alanına bakıp KENDİMİZ karar veriyoruz. Sadece ziyaretçi
    // "Reklam" çerezlerini DAHA ÖNCE onaylamışsa gösteriyoruz — onay hiç
    // verilmemişse (ya da reddedilmişse) burada YENİDEN sormuyoruz, sayfa
    // en üstteki genel çerez şeridi/panelinden zaten yönetiliyor.
    const appEl = document.getElementById("supabase-yazi-app");
    const adsenseClient = appEl?.dataset.adsenseClient;
    const adsenseSlot = appEl?.dataset.adsenseSlot;
    const reklamOnayVarMi = !!(window.CerezTercihleri && window.CerezTercihleri.al()?.reklam);
    if (adsenseClient && adsenseSlot && kayit.reklam !== false && reklamOnayVarMi) {
      const reklamDiv = document.createElement("div");
      reklamDiv.className = "reklam-alani reklam-yazi-alt";
      reklamDiv.hidden = true;
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", adsenseClient);
      ins.setAttribute("data-ad-slot", adsenseSlot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      reklamDiv.appendChild(ins);
      govdeEl.after(reklamDiv);
      if (typeof window.__cerezReklamYukle === "function") window.__cerezReklamYukle();
    }
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
        .replaceAll(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replaceAll(/\n/g, "<br>");
      return `<p>${satir}</p>`;
    })
    .join("\n");
}

init();
