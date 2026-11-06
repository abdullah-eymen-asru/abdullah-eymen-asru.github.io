/*
 * assets/js/pdf-duzenle/pdf-duzenle.js — Araçlar › PDF Düzenleyici (ayrı sekme)
 * Dönüştürücü'deki PDF düzenleyiciyi (metin düzenleme, yazı/çizim/vurgu/imza ekleme, sayfa sırala/döndür/sil, birleştir) kendi sekmesine taşır ve ekler:
 *   • ▦ Tüm sayfalar: bütün sayfaların büyük küçük-resim ızgarası (tıkla → o sayfayı düzenle)
 *   • 🔎 Tüm sayfalarda bul ve değiştir (yazıları topluca değiştirir; Geri al ile geri alınır)
 *   • 🔗 Bağlantılar: PDF içindeki yönlendirmeli bağlantıları (URL) listeler; adresini değiştir / kaldır
 *   • 🧹 Belleği temizle: dosya, sayfa görüntüleri ve çıktılar bellekten bırakılır
 * GİZLİLİK: dosya hiçbir yere yüklenmez; her şey tarayıcında (pdf.js + pdf-lib, açık kaynak). Yetki: Dönüştürücü ile aynı (donusturucu_yetkisi_var_mi) + "PDF Düzenleyici" anahtarı.
 * CSP: inline stil/olay işleyici yok; olaylar addEventListener.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt, adsizAl } from "../donusturucu/ortak.js";
import { pdfjsAl, pdfLibAl } from "../donusturucu/pdf-yukle.js";
import { pdfDuzenleyiciKur } from "../donusturucu/pdf-duzenleyici.js";

const kok = document.getElementById("pd-kok");
const SINIR = 300 * 1024 * 1024;
const URL_IZIN = /^(https?:\/\/|mailto:|tel:)/i;

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) { kok.replaceChildren(el("div", { class: "pd-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "pd-soluk", text: "Bu araca erişim yetkin bulunmuyor. Gerekirse site sahibinden talep et." }))); return; }

  let ed = null, dosyalar = [], yamalar = [];                       // yamalar: bağlantı değişiklikleri [{sayfa, rect, url|null(=kaldır)}]
  const mesaj = el("p", { class: "pd-mesaj", role: "status", "aria-live": "polite" });
  const bildir = (m, tur = "") => { mesaj.textContent = m || ""; mesaj.classList.toggle("pd-hata", tur === "error"); };
  const editorKap = el("div", { class: "pd-editor" }), arac = el("div", { class: "pd-arac" }), panel = el("div", { class: "pd-panel" });
  arac.hidden = true; panel.hidden = true;

  /* ---- dosya seçimi ---- */
  const girdi = el("input", { type: "file", accept: "application/pdf,.pdf,image/png,image/jpeg,image/webp", multiple: true, hidden: true });
  const sec = el("button", { type: "button", class: "pd-btn pd-birincil", text: "📄 PDF / görsel seç" });
  const bilgi = el("p", { class: "pd-soluk", text: "Dosyan sunucuya yüklenmez; her şey tarayıcında yapılır. Birden çok PDF seçersen birleştirilir." });
  const birak = el("div", { class: "pd-birak", tabindex: "0" }, sec, girdi, bilgi);
  sec.addEventListener("click", () => girdi.click());
  girdi.addEventListener("change", () => { if (girdi.files?.length) ac([...girdi.files]); girdi.value = ""; });
  for (const o of ["dragenter", "dragover"]) birak.addEventListener(o, (e) => { e.preventDefault(); birak.classList.add("surukle"); });
  for (const o of ["dragleave", "drop"]) birak.addEventListener(o, (e) => { e.preventDefault(); birak.classList.remove("surukle"); });
  birak.addEventListener("drop", (e) => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) ac(f); });

  async function ac(liste) {
    try {
      const toplam = liste.reduce((t, f) => t + f.size, 0);
      if (toplam > SINIR) throw new Error(`Toplam boyut çok büyük (${bayt(toplam)}). Üst sınır ${bayt(SINIR)}.`);
      temizle(false); bildir("Düzenleyici hazırlanıyor… (büyük dosyalarda biraz sürebilir)");
      dosyalar = liste;
      ed = await pdfDuzenleyiciKur(editorKap, { dosyalar: liste, mesaj: bildir });
      editorKap.querySelector(".dn-pdf")?.classList.add("dn-pdf--panel-acik");        // sayfa paneli açık başlasın: tüm sayfalar görünsün
      bilgi.textContent = `${liste.map((f) => f.name).join(", ")} · ${ed.sayfaSayisi()} sayfa · ${bayt(toplam)}`;
      arac.hidden = false; bildir(`${ed.sayfaSayisi()} sayfa yüklendi. Sol panelden sayfaları görebilir, “Yazı” aracıyla yazıları düzenleyebilirsin.`);
    } catch (h) { bildir(h.message || String(h), "error"); }
  }

  /* ---- araç çubuğu ---- */
  const dg = (m, f, c = "") => { const b = el("button", { type: "button", class: `pd-btn ${c}`.trim(), text: m }); b.addEventListener("click", f); return b; };
  const metaTemizle = el("input", { type: "checkbox", id: "pd-meta" });
  const metaEtiket = el("label", { class: "pd-onay", for: "pd-meta" }, metaTemizle, el("span", { text: "Metadata'yı temizle" }));

  async function indirPdf() {
    if (!ed) return;
    try {
      bildir("PDF hazırlanıyor…");
      let blob = await ed.pdfAl();
      if (yamalar.length || metaTemizle.checked) blob = await sonIsle(blob);
      indir(blob, `${adsizAl(ed.ad())}_duzenlenmis.pdf`); bildir("✔ İndirildi.");
    } catch (h) { bildir(h.message || String(h), "error"); }
  }
  async function sonIsle(blob) {
    const lib = await pdfLibAl(), { PDFDocument, PDFName, PDFString, PDFDict, PDFArray } = lib;
    const doc = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false }), sayfalar = doc.getPages();
    for (const y of yamalar) {
      const sf = sayfalar[y.sayfa]; const an = sf?.node.Annots(); if (!an) continue;
      for (let i = 0; i < an.size(); i++) {
        const d = an.lookupMaybe(i, PDFDict); if (!d || String(d.get(PDFName.of("Subtype"))) !== "/Link") continue;
        const r = d.lookupMaybe(PDFName.of("Rect"), PDFArray); if (!r) continue;
        const n = r.asArray().map((x) => Number(x.asNumber ? x.asNumber() : x.toString()));
        if (n.length < 4 || !n.every((v, j) => Math.abs(v - y.rect[j]) < 1)) continue;
        if (y.url === null) { an.remove(i); i--; }
        else { d.set(PDFName.of("A"), doc.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(y.url) })); d.delete(PDFName.of("Dest")); }
        break;
      }
    }
    if (metaTemizle.checked) { doc.setTitle(""); doc.setAuthor(""); doc.setSubject(""); doc.setKeywords([]); doc.setProducer(""); doc.setCreator(""); }
    return new Blob([await doc.save()], { type: "application/pdf" });
  }

  /* ---- ▦ tüm sayfalar ---- */
  function tumSayfalar() {
    if (!ed) return;
    const ızgara = el("div", { class: "pd-izgara" }), n = ed.sayfaSayisi();
    const gozlem = new IntersectionObserver((k) => { for (const g of k) if (g.isIntersecting) { gozlem.unobserve(g.target); const c = g.target.querySelector("canvas"), i = Number(g.target.dataset.i); if (c && !c.dataset.c) { c.dataset.c = "1"; ed.sayfaCiz(i, c); } } }, { root: ızgara, rootMargin: "300px" });
    for (let i = 0; i < n; i++) {
      const b = el("button", { type: "button", class: "pd-kucuk", "data-i": String(i), "aria-label": `Sayfa ${i + 1}` }, el("canvas", { width: 120, height: 160 }), el("span", { class: "pd-no", text: String(i + 1) }));
      b.addEventListener("click", async () => { await ed.sayfaGit(i); panel.hidden = true; editorKap.scrollIntoView({ block: "start", behavior: "smooth" }); });
      ızgara.append(b);
    }
    panel.replaceChildren(el("div", { class: "pd-panel-ust" }, el("strong", { text: `▦ Tüm sayfalar (${n})` }), dg("Kapat", () => { gozlem.disconnect(); panel.hidden = true; }, "pd-kucukbtn")), ızgara);
    panel.hidden = false; ızgara.querySelectorAll(".pd-kucuk").forEach((b) => gozlem.observe(b));
  }

  /* ---- 🔎 bul ve değiştir ---- */
  function bulPaneli() {
    if (!ed) return;
    const a = el("input", { type: "text", class: "pd-girdi", placeholder: "Bulunacak yazı", "aria-label": "Bulunacak yazı", autocomplete: "off" });
    const y = el("input", { type: "text", class: "pd-girdi", placeholder: "Yeni yazı (boş = sil)", "aria-label": "Yeni yazı", autocomplete: "off" });
    const bk = el("input", { type: "checkbox", id: "pd-bk" });
    const git = dg("Tümünü değiştir", async () => {
      if (!a.value) { bildir("Bulunacak yazıyı yaz.", "error"); return; }
      git.disabled = true; bildir("Sayfalar taranıyor…");
      try { const s = await ed.bulDegistir(a.value, y.value, { buyukKucuk: bk.checked });
        bildir(s.adet ? `✔ ${s.adet} yazı parçası ${s.sayfa} sayfada değiştirildi.${s.atlanan ? ` ${s.atlanan} dikey/eğik yazı atlandı.` : ""} Beğenmediysen “Geri al”ı kullan.` : "Eşleşen yazı bulunamadı (taranmış/resim PDF'lerde yazı katmanı yoktur).", s.adet ? "" : "error"); }
      catch (h) { bildir(h.message || String(h), "error"); } finally { git.disabled = false; }
    }, "pd-birincil");
    panel.replaceChildren(el("div", { class: "pd-panel-ust" }, el("strong", { text: "🔎 Tüm sayfalarda bul ve değiştir" }), dg("Kapat", () => { panel.hidden = true; }, "pd-kucukbtn")),
      el("p", { class: "pd-soluk", text: "Eşleşen her yazının üstü sayfa rengiyle kapatılır, yenisi yazılır. Tek tek düzeltmek için soldaki “Yazı” aracını kullan." }),
      a, y, el("label", { class: "pd-onay", for: "pd-bk" }, bk, el("span", { text: "Büyük/küçük harfe duyarlı" })), git);
    panel.hidden = false; a.focus();
  }

  /* ---- 🔗 bağlantılar ---- */
  async function baglantiPaneli() {
    if (!ed) return;
    panel.replaceChildren(el("div", { class: "pd-panel-ust" }, el("strong", { text: "🔗 Yönlendirmeli bağlantılar" }), dg("Kapat", () => { panel.hidden = true; }, "pd-kucukbtn")), el("p", { class: "pd-soluk", text: "Taranıyor…" }));
    panel.hidden = false;
    try {
      const blob = await ed.pdfAl(), pdfjs = await pdfjsAl(), gorev = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }), pdf = await gorev.promise, liste = [];
      for (let i = 1; i <= pdf.numPages; i++) { const sf = await pdf.getPage(i); for (const a of await sf.getAnnotations()) if (a.subtype === "Link") liste.push({ sayfa: i - 1, rect: a.rect.map(Number), url: a.url || a.unsafeUrl || "", ic: !a.url && !a.unsafeUrl }); sf.cleanup?.(); }
      try { await pdf.destroy(); } catch { /* yok say */ }
      yamalar = [];
      const ul = el("ul", { class: "pd-baglantilar" });
      for (const b of liste) {
        const g = el("input", { type: "url", class: "pd-girdi", value: b.url, placeholder: b.ic ? "(sayfa içi bağlantı) yeni https:// adresi yaz" : "https://…", "aria-label": `Sayfa ${b.sayfa + 1} bağlantı adresi` });
        const kaldir = el("input", { type: "checkbox" }), kl = el("label", { class: "pd-onay" }, kaldir, el("span", { text: "Bağlantıyı kaldır" }));
        const guncelle = () => {
          yamalar = yamalar.filter((y) => y !== b._y); b._y = null;
          if (kaldir.checked) b._y = { sayfa: b.sayfa, rect: b.rect, url: null };
          else if (g.value.trim() && g.value.trim() !== b.url) { if (!URL_IZIN.test(g.value.trim())) { bildir("Adres http(s)://, mailto: ya da tel: ile başlamalı.", "error"); return; } b._y = { sayfa: b.sayfa, rect: b.rect, url: g.value.trim() }; }
          if (b._y) yamalar.push(b._y); bildir(yamalar.length ? `${yamalar.length} bağlantı değişikliği indirmede uygulanacak.` : "");
        };
        g.addEventListener("change", guncelle); kaldir.addEventListener("change", guncelle);
        ul.append(el("li", {}, el("span", { class: "pd-soluk", text: `Sayfa ${b.sayfa + 1}${b.ic ? " · sayfa içi" : ""}` }), g, kl));
      }
      panel.replaceChildren(el("div", { class: "pd-panel-ust" }, el("strong", { text: `🔗 Yönlendirmeli bağlantılar (${liste.length})` }), dg("Kapat", () => { panel.hidden = true; }, "pd-kucukbtn")),
        el("p", { class: "pd-soluk", text: "Adresi değiştirip alandan çık; değişiklikler PDF'i indirirken uygulanır. Sayfa sırasını/sayısını değiştirdiysen bağlantıları yeniden tara." }), liste.length ? ul : el("p", { class: "pd-soluk", text: "Bu PDF'te bağlantı bulunamadı." }));
    } catch (h) { bildir(h.message || String(h), "error"); }
  }

  /* ---- 🧹 bellek ---- */
  function temizle(bildirim = true) {
    try { ed?.yokEt(); } catch { /* yok say */ }
    ed = null; dosyalar = []; yamalar = []; editorKap.replaceChildren(); panel.replaceChildren(); panel.hidden = true; arac.hidden = true;
    bilgi.textContent = "Dosyan sunucuya yüklenmez; her şey tarayıcında yapılır. Birden çok PDF seçersen birleştirilir.";
    if (bildirim) bildir("🧹 Bellek temizlendi: dosyalar, sayfa görüntüleri ve çıktılar bırakıldı.");
  }

  arac.append(dg("⬇ PDF'i indir", indirPdf, "pd-birincil"), dg("▦ Tüm sayfalar", tumSayfalar), dg("🔎 Bul ve değiştir", bulPaneli), dg("🔗 Bağlantılar", baglantiPaneli), metaEtiket, dg("🧹 Belleği temizle", () => temizle(true)));
  kok.classList.add("pd-kok", "dn-kok");           // dn-kok: düzenleyicinin CSS değişkenleri (yükseklik, renkler) buradan gelir — eksikliği sayfa alanını 0 yükseklikte bırakıyordu
  kok.replaceChildren(el("div", { class: "pd-kart" }, el("p", { class: "pd-gizlilik", text: "🔒 Dosyan sunucuya yüklenmez; tüm işlem tarayıcında (pdf.js + pdf-lib, açık kaynak) yapılır." }), birak), arac, panel, editorKap, mesaj);
  void dosyalar;
}
kur().catch((h) => { console.error("pdf-duzenle.js:", h); if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${h?.message || h}` })); });
