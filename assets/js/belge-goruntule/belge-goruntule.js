/*
 * assets/js/belge-goruntule/belge-goruntule.js — "Görüntüle" sekmesi (PDF & Belge Çalışma Alanı).
 * Dosya seç / sürükle-bırak → PDF (evrensel okuyucu: PDF.js → tarayıcı yerleşik okuyucu), görsel ve metin dosyaları görüntülenir.
 * DOCX/PPTX/PPT gibi Office dosyaları için "Dönüştür" sekmesine yönlendirilir. Dosyalar cihazdan çıkmaz.
 * Sekme değişince seçim otomatik sıfırlanır (gezinme-kilidi.js › sekmeSifirlamaKaydet).
 */
import { sekmeSifirlamaKaydet } from "../core/gezinme-kilidi.js";
import { evrenselPdfGoster } from "../pdf-okuyucu/evrensel-pdf.js";

const kok = document.getElementById("bg-kok");
if (kok) {
  const e = (t, s, m) => { const n = document.createElement(t); if (s) n.className = s; if (m != null) n.textContent = m; return n; };
  let okuyucu = null, nesneUrl = null;

  const girdi = e("input"); girdi.type = "file"; girdi.accept = ".pdf,application/pdf,image/*,.txt,.md,.csv,.json,text/plain"; girdi.hidden = true;
  const sec = e("button", "eo-btn", "📂 Dosya seç"); sec.type = "button";
  const kapat = e("button", "eo-btn", "✖ Kapat"); kapat.type = "button"; kapat.hidden = true;
  const ipucu = e("p", "muted", "PDF, görsel (PNG/JPG/WebP/GIF) ve metin dosyalarını buraya bırak ya da seç. Word/PowerPoint dosyalarını görmek için önce “Dönüştür” sekmesinde PDF’e çevir.");
  const bolge = e("div", "bg-bolge"); bolge.tabIndex = 0; bolge.setAttribute("role", "button"); bolge.setAttribute("aria-label", "Dosya bırakma alanı");
  bolge.append(e("p", "bg-bolge-metin", "Dosyayı buraya sürükle"), sec, ipucu);
  const sahne = e("div", "bg-sahne");
  const durum = e("p", "muted"); durum.setAttribute("role", "status");
  const ust = e("div", "eo-arac"); ust.append(kapat);
  kok.replaceChildren(girdi, bolge, ust, durum, sahne);

  function sifirla() {
    try { okuyucu?.yokEt(); } catch { /* yok say */ }
    okuyucu = null;
    if (nesneUrl) { URL.revokeObjectURL(nesneUrl); nesneUrl = null; }
    sahne.replaceChildren(); durum.textContent = ""; girdi.value = "";
    bolge.hidden = false; kapat.hidden = true;
  }

  async function ac(dosya) {
    sifirla();
    if (!dosya) return;
    bolge.hidden = true; kapat.hidden = false;
    const ad = dosya.name, uz = (ad.split(".").pop() || "").toLowerCase();
    durum.textContent = `${ad} (${(dosya.size / 1048576).toFixed(1)} MB)`;
    if (dosya.type === "application/pdf" || uz === "pdf") {
      okuyucu = await evrenselPdfGoster(sahne, { dosya }, { baslik: ad });
    } else if (/^image\//.test(dosya.type)) {
      nesneUrl = URL.createObjectURL(dosya);
      const img = e("img", "bg-resim"); img.alt = ad; img.src = nesneUrl; sahne.append(img);
    } else if (/^text\//.test(dosya.type) || ["txt", "md", "csv", "json"].includes(uz)) {
      const pre = e("pre", "bg-metin"); pre.textContent = (await dosya.text()).slice(0, 2_000_000); sahne.append(pre);
    } else {
      sahne.append(e("p", "eo-hata", "Bu dosya türü burada görüntülenemiyor. Word/PowerPoint için “Dönüştür” sekmesinde PDF’e çevirip tekrar aç."));
    }
  }

  sec.addEventListener("click", () => girdi.click());
  bolge.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); girdi.click(); } });
  girdi.addEventListener("change", () => ac(girdi.files?.[0]));
  kapat.addEventListener("click", sifirla);
  for (const o of ["dragenter", "dragover"]) bolge.addEventListener(o, (ev) => { ev.preventDefault(); bolge.classList.add("bg-ustunde"); });
  for (const o of ["dragleave", "drop"]) bolge.addEventListener(o, (ev) => { ev.preventDefault(); bolge.classList.remove("bg-ustunde"); });
  bolge.addEventListener("drop", (ev) => ac(ev.dataTransfer?.files?.[0]));
  sekmeSifirlamaKaydet("tool-belge-goruntule", sifirla);
  window.addEventListener("pagehide", sifirla);
}
