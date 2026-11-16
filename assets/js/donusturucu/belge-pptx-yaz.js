/*
 * assets/js/donusturucu/belge-pptx-yaz.js — HER BİÇİM → PPTX (PptxGenJS, tarayıcıda).
 *  • Belge (DOCX/MD/HTML/TXT/EPUB → IR): başlıklara göre slaytlara bölünür (H1/H2 yeni slayt), listeler/tablolar/resimler/kod korunur.
 *  • PDF: her sayfa, sayfa boyutuyla aynı oranlı bir slayta TAM SAYFA GÖRÜNTÜ olarak konur (mizanpaj birebir) + sayfa metni konuşmacı notuna eklenir.
 *  • Görsel: görsel başına bir slayt (sığdırılmış).
 * Dosya hiçbir yere gönderilmez.
 */
import { kutuphaneYukle } from "./cdn.js";
import { nefes } from "./ortak.js";

const W = 13.333, H = 7.5; // 16:9 (inç)
const RENK = { ana: "1F2937", baslik: "0F172A", vurgu: "2563EB", soluk: "6B7280" };

const dataUrlBoyut = (u) => new Promise((coz) => { const im = new Image(); im.onload = () => coz({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 }); im.onerror = () => coz(null); im.src = u; });
const blobDataUrl = (b) => new Promise((coz, red) => { const r = new FileReader(); r.onload = () => coz(r.result); r.onerror = () => red(new Error("Dosya okunamadı.")); r.readAsDataURL(b); });

function calistir(runs, taban = {}) {
  const dizi = [];
  for (const r of runs || []) {
    if (r.br) { dizi.push({ text: "\n", options: { ...taban, breakLine: false } }); continue; }
    const o = { ...taban };
    if (r.b) o.bold = true; if (r.i) o.italic = true; if (r.u) o.underline = { style: "sng" }; if (r.s) o.strike = "sngStrike";
    if (r.code) { o.fontFace = "Consolas"; }
    if (r.href && /^https?:\/\//i.test(r.href)) { o.hyperlink = { url: r.href }; o.color = RENK.vurgu; }
    dizi.push({ text: r.text ?? "", options: o });
  }
  return dizi.length ? dizi : [{ text: " ", options: taban }];
}
const duzMetin = (runs) => (runs || []).map((r) => (r.br ? "\n" : r.text || "")).join("");

/** IR blok listesi → slayt grupları */
function slaytlaraBol(bloklar, baslik) {
  const gruplar = [{ baslik: baslik || "Belge", ilk: true, bloklar: [] }];
  let mevcut = null;
  const seviye = Math.min(...bloklar.filter((b) => b.t === "h").map((b) => b.lv), 3);
  for (const b of bloklar) {
    if (b.t === "h" && b.lv <= Math.max(2, seviye)) { mevcut = { baslik: duzMetin(b.runs).trim() || "Başlıksız", bloklar: [] }; gruplar.push(mevcut); }
    else (mevcut || gruplar[0]).bloklar.push(b);
  }
  return gruplar.filter((g, i) => i > 0 || g.bloklar.length || gruplar.length === 1);
}

async function blokYaz(pptx, slayt, bloklar, ctx) {
  // bloklar bir slayta sığacak kadar; dönen: sığmayan artık
  let y = 1.35;
  const kalan = [];
  const yer = (yuk) => y + yuk <= H - 0.5;
  const ogeler = [];
  for (const b of bloklar) {
    if (b.t === "p" || b.t === "quote" || b.t === "list" || b.t === "code") {
      const satirlar = [];
      const ekle = (blokx, derinlik) => {
        if (blokx.t === "p") satirlar.push({ runs: blokx.runs, derinlik });
        else if (blokx.t === "list") blokx.items.forEach((it) => it.blocks.forEach((ib, k) => (ib.t === "list" ? ekle(ib, derinlik + 1) : satirlar.push({ runs: ib.runs || [{ text: duzMetin(ib.runs) }], madde: k === 0 ? (blokx.ordered ? { type: "number" } : true) : false, derinlik }))));
        else if (blokx.t === "quote") blokx.blocks.forEach((q) => ekle(q, derinlik));
        else if (blokx.t === "code") satirlar.push({ runs: [{ text: blokx.text, code: true }], derinlik, kod: true });
      };
      ekle(b, 0);
      const yuk = Math.max(0.4, satirlar.reduce((a, s) => a + Math.ceil(duzMetin(s.runs).length / 85) * 0.34 + 0.08, 0));
      if (!yer(yuk) && ogeler.length) { kalan.push(b); continue; }
      // paragraf sınırı: her satır grubunun sonuna breakLine
      const birlesik = [];
      for (const s of satirlar) { const rs = calistir(s.runs, { fontSize: s.kod ? 14 : 20, color: RENK.ana, fontFace: s.kod ? "Consolas" : "Calibri" }); rs.forEach((r, k) => birlesik.push({ text: r.text, options: { ...r.options, ...(k === 0 ? { bullet: s.madde || undefined, indentLevel: s.derinlik || 0 } : {}), breakLine: k === rs.length - 1 } })); }
      slayt.addText(birlesik, { x: 0.7, y, w: W - 1.4, h: Math.min(yuk, H - 0.5 - y), valign: "top", margin: 0.05, fit: "shrink", paraSpaceAfter: 6 });
      y += yuk + 0.1;
    } else if (b.t === "table") {
      const yuk = Math.min(0.42 * b.rows.length + 0.2, H - 0.5 - y);
      if (!yer(Math.min(yuk, 1)) && ogeler.length) { kalan.push(b); continue; }
      const satirlar = b.rows.map((r, ri) => r.map((h) => ({ text: h.blocks.map((x) => duzMetin(x.runs)).join(" "), options: { bold: ri === 0 && b.baslik !== false, fill: ri === 0 && b.baslik !== false ? { color: "E5E7EB" } : undefined, color: RENK.ana, fontSize: 14, colspan: h.colspan || undefined, rowspan: h.rowspan || undefined, border: { type: "solid", color: "9CA3AF", pt: 0.75 } } })));
      slayt.addTable(satirlar, { x: 0.7, y, w: W - 1.4, fontFace: "Calibri", valign: "middle" });
      y += yuk + 0.15;
    } else if (b.t === "img") {
      const boy = await dataUrlBoyut(b.src);
      if (!boy) continue;
      const maksW = W - 1.4, maksH = Math.max(1.2, H - 0.5 - y);
      if (maksH < 1.5 && ogeler.length) { kalan.push(b); continue; }
      const w2 = Math.min(maksW, maksH * boy.w / boy.h, 9), h2 = w2 * boy.h / boy.w;
      slayt.addImage({ data: b.src, x: (W - w2) / 2, y, w: w2, h: h2 });
      y += h2 + 0.15;
    } else if (b.t === "hr") { y += 0.1; }
    ogeler.push(b);
  }
  return kalan;
}

/** IR → PPTX blob */
export async function irDenPptx(bloklar, { baslik = "Sunum", yazar = "", ilerle } = {}) {
  const PptxGenJS = await kutuphaneYukle("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = baslik; pptx.author = yazar || "Abdullah Eymen Asru"; pptx.company = "";
  const gruplar = slaytlaraBol(bloklar, baslik);
  let n = 0;
  // kapak
  const kapak = pptx.addSlide(); kapak.background = { color: "FFFFFF" };
  kapak.addText(baslik, { x: 0.8, y: 2.3, w: W - 1.6, h: 1.6, fontSize: 40, bold: true, color: RENK.baslik, fontFace: "Calibri", align: "left", valign: "middle", fit: "shrink" });
  if (yazar) kapak.addText(yazar, { x: 0.8, y: 4.0, w: W - 1.6, h: 0.6, fontSize: 20, color: RENK.soluk, fontFace: "Calibri" });
  kapak.addShape(pptx.ShapeType.rect, { x: 0.8, y: 4.0 + (yazar ? 0.8 : 0), w: 1.6, h: 0.06, fill: { color: RENK.vurgu } });
  for (const g of gruplar) {
    let kuyruk = g.bloklar, parca = 0;
    if (!kuyruk.length && !g.ilk) kuyruk = [{ t: "p", runs: [{ text: " " }] }];
    do {
      const s = pptx.addSlide(); s.background = { color: "FFFFFF" };
      s.addText(parca ? `${g.baslik} (devam)` : g.baslik, { x: 0.7, y: 0.4, w: W - 1.4, h: 0.8, fontSize: 30, bold: true, color: RENK.baslik, fontFace: "Calibri", valign: "middle", fit: "shrink" });
      s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 1.2, w: 1.2, h: 0.05, fill: { color: RENK.vurgu } });
      const once = kuyruk.length;
      kuyruk = await blokYaz(pptx, s, kuyruk, {});
      if (kuyruk.length === once) { kuyruk = kuyruk.slice(1); }   // sonsuz döngü koruması
      parca++; n++;
      ilerle?.(0.75, `Slayt ${n} oluşturuluyor…`);
      await nefes();
    } while (kuyruk.length);
  }
  return pptx.write({ outputType: "blob" });
}

/** Sayfa/slayt görüntüleri (Blob[]) → PPTX; sayfa oranı korunur. notlar: string[] (isteğe bağlı) */
export async function goruntulerdenPptx(goruntuler, { baslik = "Sunum", yazar = "", notlar = [], ilerle } = {}) {
  const PptxGenJS = await kutuphaneYukle("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.title = baslik; pptx.author = yazar || "Abdullah Eymen Asru";
  const ilk = await dataUrlBoyut(await blobDataUrl(goruntuler[0]));
  const oran = ilk ? ilk.w / ilk.h : 16 / 9;
  const lw = oran >= 1 ? 13.333 : 13.333 * oran, lh = oran >= 1 ? 13.333 / oran : 13.333;
  pptx.defineLayout({ name: "SAYFA", width: lw, height: lh }); pptx.layout = "SAYFA";
  for (let i = 0; i < goruntuler.length; i++) {
    const s = pptx.addSlide(); s.background = { color: "FFFFFF" };
    s.addImage({ data: await blobDataUrl(goruntuler[i]), x: 0, y: 0, w: lw, h: lh });
    if (notlar[i]) s.addNotes(notlar[i]);
    ilerle?.(0.5 + 0.45 * ((i + 1) / goruntuler.length), `Slayt ${i + 1}/${goruntuler.length} yazılıyor…`);
    await nefes();
  }
  return pptx.write({ outputType: "blob" });
}
