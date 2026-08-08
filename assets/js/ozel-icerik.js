/*
 * assets/js/ozel-icerik.js — /ozel-icerik.html?id=<uuid>
 * Tek bir gizli makaleyi gösterir + varsa eki için 10 saniyelik Signed URL
 * üretip indirme linki sunar. RLS sayesinde bu sorgu erişimi olmayan bir
 * kullanıcı için otomatik olarak BOŞ döner (403 değil, "satır yok" gibi
 * görünür) — bu yüzden "veri gelmedi" durumunu "erişimin yok" olarak
 * ele alıyoruz.
 */
import { supabase, escapeHtml } from "./supabase-client.js";
import { requireAuth } from "./auth-guard.js";

async function init() {
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
    .select("id, title, summary, body_md, file_path, created_at")
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

/** Çok temel, bağımlılıksız markdown -> HTML (başlık, kalın, italik, link, paragraf). */
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
