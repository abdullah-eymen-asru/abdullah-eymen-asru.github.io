/*
 * assets/js/ozel-icerik.js — /panel/ozel-icerik.html?id=<uuid>
 * Tek bir gizli makaleyi gösterir + varsa eki için 10 saniyelik Signed URL
 * üretip indirme linki sunar. RLS sayesinde bu sorgu erişimi olmayan bir
 * kullanıcı için otomatik olarak BOŞ döner (403 değil, "satır yok" gibi
 * görünür) — bu yüzden "veri gelmedi" durumunu "erişimin yok" olarak
 * ele alıyoruz.
 */
import { supabase, escapeHtml } from "./core/supabase-client.js";
import { requireAuth } from "./auth/auth-guard.js";

async function init() {
  try {
    await requireAuth({ role: null });
    document.getElementById("loading")?.setAttribute("hidden", "");
    document.getElementById("app").hidden = false;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const container = document.getElementById("icerik-govde");

    if (!id) {
      container.innerHTML = `<p>Geçersiz bağlantı.</p>`;
      return;
    }

    const { data: content, error } = await supabase
      .from("special_content")
      .select("id, title, summary, body_md, file_path, harici_dosya_url, created_at")
      .eq("id", id)
      .single();

    if (error || !content) {
      container.innerHTML = `
        <h1>Erişim yok</h1>
        <p>Bu içeriği görüntüleme yetkin yok ya da içerik silinmiş olabilir.
        Erişim gerekiyorsa site yöneticisiyle iletişime geç.</p>`;
      return;
    }

    document.title = content.title + " · Özel İçerik";
    let html = `
      <h1>${escapeHtml(content.title)}</h1>
      <p class="meta">${new Date(content.created_at).toLocaleDateString("tr-TR")}</p>
      <div id="okundu-durum" class="muted" style="margin-bottom:16px;"></div>
    `;

    if (content.body_md) {
      // Basit ve bağımlılıksız bir markdown->HTML dönüşümü. Site zaten
      // kullanıcı girdisini innerHTML'e escape ETMEDEN basmıyor; burada da
      // önce escape edip SONRA çok temel markdown kalıplarını uyguluyoruz,
      // böylece içine kötü amaçlı HTML/script yazılsa bile çalışmaz.
      html += `<div class="markdown-body">${basitMarkdown(content.body_md)}</div>`;
    }

    container.innerHTML = html;

    if (content.file_path) {
      await renderDownloadButton(content.id, content.file_path);
    }
    if (content.harici_dosya_url) {
      renderHariciDosyaButonu(content.harici_dosya_url);
    }

    await okunduIsaretleVeGoster(content.id);
  } catch (err) {
    // Önceden burada bir hata (ör. beklenmeyen bir DOM/veri durumu)
    // fırlarsa, sayfa sonsuza kadar "Yükleniyor..." ekranında asılı
    // kalıyordu — kullanıcı ne olduğunu anlayamıyordu.
    console.error("ozel-icerik.js init hatası:", err);
    document.getElementById("loading")?.setAttribute("hidden", "");
    const app = document.getElementById("app");
    if (app) app.hidden = false;
    const container = document.getElementById("icerik-govde");
    if (container) {
      container.innerHTML = `<p>Bir şeyler ters gitti, sayfayı yenilemeyi dene. Sorun devam ederse site yöneticisiyle iletişime geç.</p>`;
    }
  }
}

/**
 * İçerik açıldığı an OTOMATİK olarak "okundu" işaretlenir (admin'e ait
 * içeriklerde content_access satırı olmayabilir — bu durumda RPC sessizce
 * hiçbir şey yapmaz, hata vermez). Üye ayrıca "Okundum" butonuyla manuel
 * de teyit edebilir (zaten okunmuşsa bunun bir etkisi olmaz, sadece
 * tarihi tazeler değil — okundu_tarihi ilk işaretlenen anı korur).
 */
async function okunduIsaretleVeGoster(contentId) {
  const durumEl = document.getElementById("okundu-durum");
  const kosedeAlan = document.getElementById("okundu-manuel-wrap");
  if (!durumEl) return;

  await supabase.rpc("icerik_okundu_isaretle", { p_content_id: contentId });
  await durumuYenile(contentId, durumEl, kosedeAlan);
}

/**
 * Okundu durumunu DB'den okuyup hem üstteki metni hem köşedeki yedek
 * "Okundum" düğmesini günceller. Otomatik işaretleme (yukarıdaki RPC çağrısı,
 * sayfa açılır açılmaz çalışır) normalde yeterlidir — köşedeki düğme SADECE
 * bağlantı sorunu/gecikme gibi bir sebeple otomatik işaretleme
 * uygulanmadıysa diye duran bir YEDEKTİR ("otomatik sistem kaydetsin ama
 * yedek olarak köşede bir yerde dursun" isteği).
 */
async function durumuYenile(contentId, durumEl, kosedeAlan) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data } = await supabase
    .from("content_access")
    .select("okundu_mu, okundu_tarihi")
    .eq("content_id", contentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (data?.okundu_mu) {
    durumEl.innerHTML = `✓ Okundu olarak işaretlendi (${new Date(data.okundu_tarihi).toLocaleString("tr-TR")})`;
    if (kosedeAlan) kosedeAlan.hidden = true;
    return;
  }

  // Admin kendi eklediği içeriği görüntülüyor olabilir (content_access
  // satırı hiç yok) — bu durumda okundu bilgisi/düğmesi hiç gösterilmez.
  durumEl.innerHTML = "";
  if (!kosedeAlan) return;
  if (data === null) {
    kosedeAlan.hidden = true;
    return;
  }
  kosedeAlan.hidden = false;
  const btn = document.getElementById("okundu-manuel-btn");
  if (btn && !btn.dataset.bagli) {
    btn.dataset.bagli = "1";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await supabase.rpc("icerik_okundu_isaretle", { p_content_id: contentId });
      await durumuYenile(contentId, durumEl, kosedeAlan);
      btn.disabled = false;
    });
  }
}

/**
 * Çok büyük (Cloudflare R2'de barınan) dosyalar için: burada 10 saniyelik
 * Signed URL YOK, çünkü dosya Supabase'te değil — RLS/erişim kontrolü zaten
 * bu SAYFANIN kendisinde yapıldı (yukarıdaki special_content sorgusu RLS'ten
 * geçti). Link doğrudan R2'nin genel adresine gider.
 */
function renderHariciDosyaButonu(url) {
  // koleksiyon-tablo.js'teki guvenliLink ile aynı mantık: sadece http(s)
  // ile başlayan, boşluk/kontrol karakteri içermeyen linklere izin ver.
  const guvenli = /^https?:\/\/\S+$/.test(url);
  if (!guvenli) return;

  const wrap = document.getElementById("harici-dosya-alani");
  if (!wrap) return;
  wrap.hidden = false;
  const a = wrap.querySelector("#harici-dosya-link");
  a.href = url;
}

async function renderDownloadButton(contentId, filePath) {
  const wrap = document.getElementById("dosya-indir-alani");
  wrap.hidden = false;
  const btn = document.getElementById("dosya-indir-btn");
  const status = document.getElementById("dosya-indir-status");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Bağlantı hazırlanıyor...";

    // 10 saniye geçerli, tek kullanımlık indirme linki. Bu süre RLS
    // kontrolünün YAPILDIĞI ANDIR — süre dolunca link tamamen geçersiz olur,
    // paylaşılsa bile işe yaramaz.
    const { data, error } = await supabase.storage
      .from("ozel-dosyalar")
      .createSignedUrl(filePath, 10);

    if (error || !data?.signedUrl) {
      status.textContent = "Bağlantı oluşturulamadı: yetkin olmayabilir.";
      btn.disabled = false;
      return;
    }

    status.textContent = "İndirme başlıyor... (bağlantı 10 saniye geçerli)";
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = filePath.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    btn.disabled = false;
  });
}

/** Çok temel, bağımlılıksız markdown -> HTML (başlık, kalın, italik, link, paragraf).
 *
 * BUG FİX ("### şeklinde kalıyor" / H3-H4 içindekilere girmiyor): bkz.
 * assets/js/github-yonetim/onizleme.js'deki AYNI fonksiyonun başındaki
 * bugfix notu — birebir aynı düzeltme (H1-H4 hepsi tanınıyor).
 */
function basitMarkdown(md) {
  const esc = escapeHtml(md);
  return esc
    .split(/\n{2,}/)
    .map((blok) => {
      const baslikEslesme = blok.match(/^(#{1,4})[ \t]+(.+)$/);
      if (baslikEslesme) {
        const seviye = baslikEslesme[1].length;
        return `<h${seviye}>${baslikEslesme[2]}</h${seviye}>`;
      }
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
