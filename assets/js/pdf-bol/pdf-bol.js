/*
 * assets/js/pdf-bol/pdf-bol.js — Araçlar › PDF Böl & Ayıkla
 * Bölme sitelerindeki (iLovePDF / Smallpdf / PDF24) temel özelliklerin tamamı, %100 TARAYICIDA:
 *   • Aralıklara böl ("1-3, 5, 8-10": her aralık ayrı dosya ya da hepsi tek dosya)
 *   • Her N sayfada bir · Her sayfa ayrı dosya · Eşit parçalara (N parça) · Boyuta göre (en çok X MB)
 *   • Küçük resimlerden sayfa seç → ayıkla (yeni PDF) / sil / 90° döndür; tek-çift sayfa seçimi
 *   • Çoklu çıktıyı tek ZIP olarak indir; isteğe bağlı metadata temizliği
 * GİZLİLİK: dosya hiçbir yere YÜKLENMEZ, sunucuya/üçüncü tarafa gönderilmez. Kütüphaneler (pdf-lib, pdf.js) açık kaynaktır;
 * yetki kapısı Dönüştürücü ile aynıdır (donusturucu_yetkisi_var_mi → Yetki Ayarları › "Gelişmiş Belge ve Gizlilik Araçları").
 * CSP: inline stil/olay işleyici yok; tüm olaylar addEventListener.
 */
import { supabase } from "../core/supabase-client.js";
import { el, hataMetni, indir, bayt, dosyaAdiTemizle, adsizAl, nefes } from "../donusturucu/ortak.js";
import { pdfjsAl, pdfLibAl } from "../donusturucu/pdf-yukle.js";
import { ZipYazici } from "../notlar/disa-aktar/zip.js";

const kok = document.getElementById("pb-kok");
const SINIR = 300 * 1024 * 1024;
const MODLAR = [
  ["aralik", "Aralıklara böl"], ["her-n", "Her N sayfada bir"], ["tek", "Her sayfa ayrı"], ["esit", "Eşit parçalara"], ["boyut", "Boyuta göre"], ["sec", "Sayfa seç / ayıkla"],
];

/** "1-3, 5, 8-" → [[0,1,2],[4],[7..son]] ; hatada anlaşılır Error. */
export function araliklariCoz(metin, n) {
  const parcalar = String(metin || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!parcalar.length) throw new Error("En az bir aralık yaz (örn. 1-3, 5, 8-10).");
  const sayi = (t) => (/^son$/i.test(t) ? n : /^\d+$/.test(t) ? Number(t) : NaN);
  return parcalar.map((p) => {
    const m = /^([^-]*)-([^-]*)$/.exec(p);
    let a, b;
    if (m) { a = m[1] === "" ? 1 : sayi(m[1]); b = m[2] === "" ? n : sayi(m[2]); } else { a = b = sayi(p); }
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`“${p}” anlaşılamadı. Örnek: 1-3, 5, 8-10, 12-`);
    if (a < 1 || b < 1 || a > n || b > n) throw new Error(`“${p}” geçersiz: belgede 1–${n} arası sayfa var.`);
    if (a > b) throw new Error(`“${p}” ters aralık (başlangıç bitişten büyük).`);
    return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
  });
}
const sayfaMetni = (idx) => (idx.length === 1 ? `s${idx[0] + 1}` : `s${idx[0] + 1}-${idx[idx.length - 1] + 1}`);

async function kur() {
  if (!kok) return;
  const { data: yetkili, error } = await supabase.rpc("donusturucu_yetkisi_var_mi");
  if (error) { kok.replaceChildren(el("p", { class: "auth-message error", text: hataMetni(error) })); return; }
  if (yetkili !== true) {
    kok.replaceChildren(el("div", { class: "pb-kart", role: "alert" }, el("h2", { text: "🚫 Erişim yok" }), el("p", { class: "pb-soluk", text: "Bu araca erişim yetkin bulunmuyor. Gerekirse site sahibinden talep et." })));
    return;
  }
  let lib = null, pdfjs = null;
  const d = { ad: "", bayt: null, n: 0, kaynakDoc: null, js: null, mod: "aralik", secili: new Set(), sonuc: [] };

  const mesaj = el("p", { class: "pb-mesaj", role: "status", "aria-live": "polite" });
  const bildir = (m, hata = false) => { mesaj.textContent = m || ""; mesaj.classList.toggle("pb-hata", !!hata); };

  /* ---------------- dosya seçimi ---------------- */
  const girdi = el("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const secDugme = el("button", { type: "button", class: "pb-btn pb-birincil", text: "📄 PDF seç" });
  const bilgi = el("p", { class: "pb-soluk", text: "Henüz dosya seçilmedi. Dosyan bu cihazdan çıkmaz; her şey tarayıcında yapılır." });
  const alan = el("div", { class: "pb-birak", tabindex: "0" }, secDugme, girdi, bilgi);
  secDugme.addEventListener("click", () => girdi.click());
  girdi.addEventListener("change", () => { if (girdi.files?.[0]) yukle(girdi.files[0]); girdi.value = ""; });
  for (const o of ["dragenter", "dragover"]) alan.addEventListener(o, (e) => { e.preventDefault(); alan.classList.add("surukle"); });
  for (const o of ["dragleave", "drop"]) alan.addEventListener(o, (e) => { e.preventDefault(); alan.classList.remove("surukle"); });
  alan.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) yukle(f); });

  async function yukle(dosya) {
    try {
      if (!/\.pdf$/i.test(dosya.name) && dosya.type !== "application/pdf") throw new Error("Yalnızca PDF dosyası seçebilirsin.");
      if (dosya.size > SINIR) throw new Error(`Dosya çok büyük (${bayt(dosya.size)}). Üst sınır ${bayt(SINIR)}; tarayıcı belleği için.`);
      bildir("PDF okunuyor…");
      lib ||= await pdfLibAl(); pdfjs ||= await pdfjsAl();
      const u8 = new Uint8Array(await dosya.arrayBuffer());
      let doc;
      try { doc = await lib.PDFDocument.load(u8, { updateMetadata: false }); }
      catch (h) { throw new Error(/encrypt/i.test(h.message) ? "Bu PDF şifreli. Önce şifresini kaldırıp (açıp yeniden kaydederek) tekrar dene." : `PDF okunamadı: ${h.message}`); }
      if (d.js) { try { await d.js.destroy(); } catch { /* yoksay */ } }
      d.js = await pdfjs.getDocument({ data: u8.slice(0) }).promise;
      Object.assign(d, { ad: dosya.name, bayt: u8, n: doc.getPageCount(), kaynakDoc: doc, secili: new Set(), sonuc: [] });
      bilgi.textContent = `${dosya.name} · ${d.n} sayfa · ${bayt(dosya.size)}`;
      bildir(""); cizAyarlar(); cizKucukler(); cizSonuc();
    } catch (h) { bildir(h.message || String(h), true); }
  }

  /* ---------------- mod ve ayarlar ---------------- */
  const modBar = el("div", { class: "pb-modlar", role: "tablist", "aria-label": "Bölme yöntemi" });
  const ayarKutu = el("div", { class: "pb-ayarlar" });
  const metaTemizle = el("input", { type: "checkbox", id: "pb-meta" });
  const secenekler = el("label", { class: "pb-onay", for: "pb-meta" }, metaTemizle, el("span", { text: "Çıktılardaki metadata'yı (başlık, yazar, üretici vb.) temizle" }));
  function cizModlar() {
    modBar.replaceChildren(...MODLAR.map(([id, ad]) => {
      const b = el("button", { type: "button", class: "pb-mod", role: "tab", "aria-selected": String(d.mod === id), text: ad });
      b.addEventListener("click", () => { d.mod = id; cizModlar(); cizAyarlar(); cizKucukler(); });
      return b;
    }));
  }
  const alanEl = (etiket, girdi2, ipucu) => el("label", { class: "pb-alan" }, el("span", { text: etiket }), girdi2, ipucu ? el("small", { class: "pb-soluk", text: ipucu }) : null);
  let g = {};
  function cizAyarlar() {
    ayarKutu.replaceChildren(); g = {};
    if (!d.kaynakDoc) { ayarKutu.append(el("p", { class: "pb-soluk", text: "Önce bir PDF seç." })); return; }
    const calis = el("button", { type: "button", class: "pb-btn pb-birincil", text: "✂ Böl ve hazırla" });
    calis.addEventListener("click", () => calistir());
    if (d.mod === "aralik") {
      g.aralik = el("input", { type: "text", class: "pb-girdi", placeholder: "1-3, 5, 8-10  (son = son sayfa, 12- = 12'den sona)", autocomplete: "off", spellcheck: "false" });
      g.birlestir = el("input", { type: "checkbox", id: "pb-birlestir" });
      ayarKutu.append(alanEl(`Sayfa aralıkları (1–${d.n})`, g.aralik), el("label", { class: "pb-onay", for: "pb-birlestir" }, g.birlestir, el("span", { text: "Tüm aralıkları TEK PDF'de birleştir (yoksa her aralık ayrı dosya)" })));
    } else if (d.mod === "her-n") {
      g.n = el("input", { type: "number", class: "pb-girdi", min: "1", max: String(d.n), value: "1", inputmode: "numeric" });
      ayarKutu.append(alanEl("Her kaç sayfada bir yeni dosya?", g.n, `Örn. 5 → ${Math.ceil(d.n / 5)} dosya`));
    } else if (d.mod === "tek") {
      ayarKutu.append(el("p", { class: "pb-soluk", text: `${d.n} sayfa → ${d.n} ayrı PDF (ZIP olarak indirilir).` }));
    } else if (d.mod === "esit") {
      g.parca = el("input", { type: "number", class: "pb-girdi", min: "2", max: String(Math.max(2, d.n)), value: "2", inputmode: "numeric" });
      ayarKutu.append(alanEl("Kaç eşit parçaya bölünsün?", g.parca));
    } else if (d.mod === "boyut") {
      g.mb = el("input", { type: "number", class: "pb-girdi", min: "0.1", step: "0.1", value: "10", inputmode: "decimal" });
      ayarKutu.append(alanEl("Her dosya en çok kaç MB olsun?", g.mb, "Sayfalar bölünmeden en yakın uygun boyuta paketlenir; tek sayfa sınırı aşarsa kendi başına kalır."));
    } else {
      ayarKutu.append(selSecimAraclari());
      return;
    }
    ayarKutu.append(secenekler, calis);
  }

  /* ---------------- küçük resimler / sayfa seçimi ---------------- */
  const izgara = el("div", { class: "pb-izgara", role: "group", "aria-label": "Sayfalar" });
  const secimBilgi = el("p", { class: "pb-soluk", role: "status" });
  let gozlemci = null, cizimSirasi = Promise.resolve();
  function guncelleSecimBilgi() { secimBilgi.textContent = d.mod === "sec" ? `${d.secili.size} / ${d.n} sayfa seçili` : ""; }
  function cizKucukler() {
    if (gozlemci) gozlemci.disconnect();
    izgara.replaceChildren(); izgara.hidden = !d.kaynakDoc;
    if (!d.kaynakDoc) return;
    izgara.classList.toggle("secilebilir", d.mod === "sec");
    gozlemci = new IntersectionObserver((kayitlar) => {
      for (const k of kayitlar) if (k.isIntersecting) { gozlemci.unobserve(k.target); const i = Number(k.target.dataset.i); cizimSirasi = cizimSirasi.then(() => kucukCiz(k.target, i)); }
    }, { rootMargin: "300px" });
    for (let i = 0; i < d.n; i++) {
      const b = el("button", { type: "button", class: "pb-kucuk", "data-i": String(i), "aria-pressed": String(d.secili.has(i)), "aria-label": `Sayfa ${i + 1}` }, el("span", { class: "pb-no", text: String(i + 1) }));
      b.addEventListener("click", () => { if (d.mod !== "sec") return; if (d.secili.has(i)) d.secili.delete(i); else d.secili.add(i); b.setAttribute("aria-pressed", String(d.secili.has(i))); guncelleSecimBilgi(); });
      izgara.append(b); gozlemci.observe(b);
    }
    guncelleSecimBilgi();
  }
  async function kucukCiz(dugme, i) {
    try {
      const sayfa = await d.js.getPage(i + 1), vp0 = sayfa.getViewport({ scale: 1 }), olcek = Math.min(2, (150 * Math.min(2, window.devicePixelRatio || 1)) / vp0.width);
      const vp = sayfa.getViewport({ scale: olcek }), tuval = document.createElement("canvas");
      tuval.width = Math.ceil(vp.width); tuval.height = Math.ceil(vp.height); tuval.className = "pb-tuval";
      await sayfa.render({ canvasContext: tuval.getContext("2d", { alpha: false }), canvas: tuval, viewport: vp }).promise;
      dugme.prepend(tuval); sayfa.cleanup?.();
    } catch { dugme.classList.add("pb-bozuk"); }
  }
  function selSecimAraclari() {
    const kutu = el("div", { class: "pb-sec-araclar" });
    const dg = (metin, fn, tur = "") => { const b = el("button", { type: "button", class: `pb-btn ${tur}`, text: metin }); b.addEventListener("click", fn); return b; };
    const yenile = () => { izgara.querySelectorAll(".pb-kucuk").forEach((b) => b.setAttribute("aria-pressed", String(d.secili.has(Number(b.dataset.i))))); guncelleSecimBilgi(); };
    const yoksa = () => { if (!d.secili.size) { bildir("Önce küçük resimlerden sayfa seç.", true); return true; } bildir(""); return false; };
    kutu.append(
      el("div", { class: "pb-sec-satir" },
        dg("Tümünü seç", () => { d.secili = new Set(Array.from({ length: d.n }, (_, i) => i)); yenile(); }), dg("Temizle", () => { d.secili.clear(); yenile(); }),
        dg("Tek sayfalar", () => { d.secili = new Set(Array.from({ length: d.n }, (_, i) => i).filter((i) => i % 2 === 0)); yenile(); }),
        dg("Çift sayfalar", () => { d.secili = new Set(Array.from({ length: d.n }, (_, i) => i).filter((i) => i % 2 === 1)); yenile(); }),
        dg("Seçimi ters çevir", () => { d.secili = new Set(Array.from({ length: d.n }, (_, i) => i).filter((i) => !d.secili.has(i))); yenile(); })),
      el("div", { class: "pb-sec-satir" },
        dg("📤 Seçilenleri ayıkla (yeni PDF)", () => { if (!yoksa()) calistir("ayikla"); }, "pb-birincil"),
        dg("🗑 Seçilenleri sil", () => { if (!yoksa()) calistir("sil"); }),
        dg("↻ Seçilenleri 90° döndür", () => { if (!yoksa()) calistir("dondur"); })),
      secenekler);
    return kutu;
  }

  /* ---------------- işleme ---------------- */
  const temizMeta = (doc) => { doc.setTitle(""); doc.setAuthor(""); doc.setSubject(""); doc.setKeywords([]); doc.setProducer(""); doc.setCreator(""); };
  async function pdfYap(idx, { dondur = 0 } = {}) {
    const cikti = await lib.PDFDocument.create();
    const kopya = await cikti.copyPages(d.kaynakDoc, idx);
    kopya.forEach((p) => { if (dondur) p.setRotation(lib.degrees((p.getRotation().angle + dondur) % 360)); cikti.addPage(p); });
    if (metaTemizle.checked) temizMeta(cikti); else cikti.setProducer("PDF Böl & Ayıkla");
    return cikti.save({ useObjectStreams: true });
  }
  async function boyutaGore(idx, limit, cikis) {
    const u8 = await pdfYap(idx);
    if (u8.length <= limit || idx.length === 1) { cikis.push({ idx, u8 }); return; }
    const orta = Math.ceil(idx.length / 2);
    await boyutaGore(idx.slice(0, orta), limit, cikis); await boyutaGore(idx.slice(orta), limit, cikis);
  }
  /** Boyut modunda iki komşu parça birlikte sınıra sığıyorsa birleştirir (gereksiz küçük dosyaları azaltır). */
  async function sikistirKomsu(liste, limit) {
    const s = [];
    for (const p of liste) {
      const son = s[s.length - 1];
      if (son && son.u8.length + p.u8.length <= limit * 0.9) { const idx = [...son.idx, ...p.idx], u8 = await pdfYap(idx); if (u8.length <= limit) { s[s.length - 1] = { idx, u8 }; continue; } }
      s.push(p);
    }
    return s;
  }
  async function calistir(islem = "") {
    if (!d.kaynakDoc) return;
    try {
      bildir("Hazırlanıyor… (büyük dosyalarda biraz sürebilir)"); d.sonuc = []; cizSonuc(); await nefes();
      const taban = adsizAl(d.ad), cikti = [];
      const tumu = Array.from({ length: d.n }, (_, i) => i);
      if (islem === "ayikla" || islem === "sil" || islem === "dondur") {
        const sec = [...d.secili].sort((a, b) => a - b);
        if (islem === "ayikla") cikti.push({ ad: `${taban}_ayiklanan.pdf`, idx: sec, u8: await pdfYap(sec) });
        else if (islem === "sil") { const kalan = tumu.filter((i) => !d.secili.has(i)); if (!kalan.length) throw new Error("Tüm sayfaları silemezsin; en az bir sayfa kalmalı."); cikti.push({ ad: `${taban}_silinmis.pdf`, idx: kalan, u8: await pdfYap(kalan) }); }
        else cikti.push({ ad: `${taban}_dondurulmus.pdf`, idx: tumu, u8: await pdfYapDondurulmus(sec) });
      } else if (d.mod === "aralik") {
        const araliklar = araliklariCoz(g.aralik.value, d.n);
        if (g.birlestir.checked) { const hepsi = araliklar.flat(); cikti.push({ ad: `${taban}_secilen.pdf`, idx: hepsi, u8: await pdfYap(hepsi) }); }
        else for (const a of araliklar) cikti.push({ ad: `${taban}_${sayfaMetni(a)}.pdf`, idx: a, u8: await pdfYap(a) });
      } else if (d.mod === "her-n") {
        const n = Math.floor(Number(g.n.value)); if (!(n >= 1)) throw new Error("Sayfa sayısı 1 veya daha büyük olmalı.");
        for (let b = 0; b < d.n; b += n) { const a = tumu.slice(b, b + n); cikti.push({ ad: `${taban}_${sayfaMetni(a)}.pdf`, idx: a, u8: await pdfYap(a) }); bildir(`Hazırlanıyor… ${cikti.length}`); await nefes(); }
      } else if (d.mod === "tek") {
        for (const i of tumu) { cikti.push({ ad: `${taban}_s${String(i + 1).padStart(String(d.n).length, "0")}.pdf`, idx: [i], u8: await pdfYap([i]) }); if (i % 10 === 9) { bildir(`Hazırlanıyor… ${i + 1}/${d.n}`); await nefes(); } }
      } else if (d.mod === "esit") {
        const p = Math.floor(Number(g.parca.value)); if (!(p >= 2) || p > d.n) throw new Error(`Parça sayısı 2 ile ${d.n} arasında olmalı.`);
        const boy = Math.ceil(d.n / p);
        for (let b = 0; b < d.n; b += boy) { const a = tumu.slice(b, b + boy); cikti.push({ ad: `${taban}_parca${cikti.length + 1}_${sayfaMetni(a)}.pdf`, idx: a, u8: await pdfYap(a) }); await nefes(); }
      } else if (d.mod === "boyut") {
        const limit = Math.floor(Number(g.mb.value) * 1024 * 1024); if (!(limit >= 50 * 1024)) throw new Error("Sınır en az 0,05 MB olmalı.");
        const ort = d.bayt.length / d.n, adim = Math.max(1, Math.floor((limit * 0.85) / Math.max(1, ort))), ham = [];
        for (let b = 0; b < d.n; b += adim) { await boyutaGore(tumu.slice(b, b + adim), limit, ham); bildir(`Boyuta göre bölünüyor… ${Math.min(b + adim, d.n)}/${d.n}`); await nefes(); }
        (await sikistirKomsu(ham, limit)).forEach((p, i) => cikti.push({ ad: `${taban}_parca${i + 1}_${sayfaMetni(p.idx)}.pdf`, idx: p.idx, u8: p.u8 }));
      }
      d.sonuc = cikti.map((c) => ({ ad: dosyaAdiTemizle(c.ad), sayfa: c.idx.length, u8: c.u8 }));
      bildir(`${d.sonuc.length} dosya hazır.`); cizSonuc();
    } catch (h) { bildir(h.message || String(h), true); }
  }
  async function pdfYapDondurulmus(sec) {
    const cikti = await lib.PDFDocument.load(d.bayt, { updateMetadata: false });
    for (const i of sec) { const p = cikti.getPage(i); p.setRotation(lib.degrees((p.getRotation().angle + 90) % 360)); }
    if (metaTemizle.checked) temizMeta(cikti);
    return cikti.save({ useObjectStreams: true });
  }

  /* ---------------- sonuçlar ---------------- */
  const sonucKutu = el("div", { class: "pb-sonuc" });
  function cizSonuc() {
    sonucKutu.replaceChildren(); sonucKutu.hidden = !d.sonuc.length; if (!d.sonuc.length) return;
    const toplam = d.sonuc.reduce((t, s) => t + s.u8.length, 0);
    const ust = el("div", { class: "pb-sonuc-ust" }, el("strong", { text: `${d.sonuc.length} dosya · ${bayt(toplam)}` }));
    if (d.sonuc.length > 1) {
      const z = el("button", { type: "button", class: "pb-btn pb-birincil", text: "📦 Tümünü ZIP olarak indir" });
      z.addEventListener("click", async () => {
        try { z.disabled = true; const zip = new ZipYazici(); for (const s of d.sonuc) await zip.dosyaEkle(s.ad, s.u8); indir(zip.bitir(), `${adsizAl(d.ad)}_bolunmus.zip`); }
        catch (h) { bildir(h.message, true); } finally { z.disabled = false; }
      });
      ust.append(z);
    }
    const liste = el("ul", { class: "pb-sonuc-liste" }, ...d.sonuc.map((s) => {
      const b = el("button", { type: "button", class: "pb-btn", text: "⬇ İndir" }); b.addEventListener("click", () => indir(new Blob([s.u8], { type: "application/pdf" }), s.ad));
      return el("li", {}, el("span", { class: "pb-sonuc-ad", text: s.ad }), el("small", { class: "pb-soluk", text: `${s.sayfa} sayfa · ${bayt(s.u8.length)}` }), b);
    }));
    sonucKutu.append(ust, liste);
  }

  cizModlar(); cizAyarlar(); izgara.hidden = true; sonucKutu.hidden = true;
  kok.classList.add("pb-kok");
  kok.replaceChildren(
    el("div", { class: "pb-kart" }, el("p", { class: "pb-gizlilik", text: "🔒 Dosyan sunucuya yüklenmez; tüm işlem tarayıcında (pdf-lib + pdf.js, açık kaynak) yapılır." }), alan),
    el("div", { class: "pb-kart" }, modBar, ayarKutu, mesaj),
    el("div", { class: "pb-kart" }, secimBilgi, izgara),
    sonucKutu);
}
kur().catch((h) => { console.error("pdf-bol.js:", h); if (kok) kok.replaceChildren(el("p", { class: "auth-message error", text: `Araç yüklenemedi: ${h?.message || h}` })); });
