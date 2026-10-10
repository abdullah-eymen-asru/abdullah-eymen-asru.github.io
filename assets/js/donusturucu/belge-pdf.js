/*
 * assets/js/donusturucu/belge-pdf.js — IR → PDF (pdfmake, Roboto gömülü; Türkçe karakterler dahil).
 * Metin vektör ve seçilebilir kalır. Roboto'nun kapsamadığı yazı sistemleri (CJK, Arapça, emoji) boş çıkabilir:
 * bu durumda "HTML olarak indir → tarayıcıdan Yazdır → PDF" önerilir (arayüz bu uyarıyı gösterir).
 */
import { kutuphaneYukle } from "./cdn.js";
import { gorselHazirla } from "./motor-gorsel.js";

const BASLIK_PT = [22, 18, 15, 13, 12, 11];
const ICERIK_GENISLIK = 595.28 - 2 * 56;

export async function irDenPdf(bloklar, { baslik = "Belge", yazar = "" } = {}) {
  const pm = await kutuphaneYukle("pdfmake");

  const gorsel = new Map();
  async function topla(bl) {
    for (const b of bl) {
      if (b.t === "img" && !gorsel.has(b.src)) gorsel.set(b.src, await gorselHazirla(b.src, ["png", "jpg"]));
      else if (b.t === "list") for (const it of b.items) await topla(it.blocks);
      else if (b.t === "quote") await topla(b.blocks);
      else if (b.t === "table") for (const r of b.rows) for (const h of r) await topla(h.blocks);
    }
  }
  await topla(bloklar);

  const metin = (runs, ekstra = {}) => {
    const dizi = [];
    for (const r of runs) {
      if (r.br) { dizi.push({ text: "\n" }); continue; }
      const o = { text: r.text, ...ekstra };
      if (r.b) o.bold = true;
      if (r.i) o.italics = true;
      const dec = [];
      if (r.u) dec.push("underline");
      if (r.s) dec.push("lineThrough");
      if (r.href) { o.link = r.href; o.color = "#0563C1"; if (!dec.includes("underline")) dec.push("underline"); }
      if (dec.length) o.decoration = dec.length === 1 ? dec[0] : dec;
      if (r.code) { o.background = "#eceff1"; o.color = o.color || "#2d3748"; }
      if (r.sup || r.sub) o.fontSize = 8;
      if (r.mark) o.background = "#fff59d";
      dizi.push(o);
    }
    return dizi.length ? dizi : [{ text: " " }];
  };

  const hiza = (a) => (a === "center" || a === "right" || a === "justify" ? a : undefined);

  function uret(bl) {
    const c = [];
    for (const b of bl) {
      switch (b.t) {
        case "h": c.push({ text: metin(b.runs), bold: true, fontSize: BASLIK_PT[b.lv - 1], margin: [0, b.lv <= 2 ? 14 : 10, 0, 6], alignment: hiza(b.align) }); break;
        case "p": c.push({ text: metin(b.runs), margin: [0, 0, 0, 7], alignment: hiza(b.align) }); break;
        case "list": {
          const ogeler = b.items.map((it) => {
            const ic = uret(it.blocks);
            if (ic.length === 1 && ic[0].text) return { ...ic[0], margin: [0, 0, 0, 2] };
            return { stack: ic.length ? ic : [{ text: " " }], margin: [0, 0, 0, 2] };
          });
          c.push(b.ordered ? { ol: ogeler, start: b.start, margin: [0, 0, 0, 7] } : { ul: ogeler, margin: [0, 0, 0, 7] });
          break;
        }
        case "table": c.push(tablo(b)); break;
        case "quote":
          c.push({
            table: { widths: ["*"], body: [[{ stack: uret(b.blocks), italics: true, color: "#4b5563" }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 2.5 : 0), vLineColor: () => "#a3aec2", paddingLeft: () => 10, paddingTop: () => 2, paddingBottom: () => 0 },
            margin: [4, 0, 0, 7],
          });
          break;
        case "code":
          c.push({
            table: { widths: ["*"], body: [[{ text: b.text || " ", preserveLeadingSpaces: true, fontSize: 9, color: "#1f2937" }]] },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => "#f3f4f6", paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
            margin: [0, 0, 0, 8],
          });
          break;
        case "hr": c.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: ICERIK_GENISLIK, y2: 0, lineWidth: 0.6, lineColor: "#bbbbbb" }], margin: [0, 6, 0, 8] }); break;
        case "img": {
          const g = gorsel.get(b.src);
          if (!g) { c.push({ text: `[Görsel${b.alt ? `: ${b.alt}` : ""}]`, italics: true, color: "#777777", margin: [0, 0, 0, 7] }); break; }
          const url = `data:image/${g.tip === "jpg" ? "jpeg" : "png"};base64,${btoa(Array.from(g.bayt, (x) => String.fromCharCode(x)).join(""))}`;
          c.push({ image: url, fit: [ICERIK_GENISLIK, 640], margin: [0, 0, 0, 8] });
          break;
        }
        default: break;
      }
    }
    return c;
  }

  function tablo(b) {
    const sutun = Math.max(1, Math.max(...b.rows.map((r) => r.reduce((a, h) => a + h.colspan, 0))));
    const kapli = b.rows.map(() => new Set());
    const govde = b.rows.map((r, ri) => {
      const satir = [];
      let ci = 0;
      for (const h of r) {
        while (kapli[ri].has(ci)) { satir[ci] = {}; ci += 1; }
        const ic = uret(h.blocks);
        const baslikH = h.th || (b.baslik && ri === 0);
        const hucre = ic.length === 1 && ic[0].text ? { ...ic[0], margin: [0, 0, 0, 0] } : { stack: ic.length ? ic : [{ text: " " }] };
        if (baslikH) { hucre.bold = true; hucre.fillColor = "#eef1f5"; }
        if (h.colspan > 1) hucre.colSpan = h.colspan;
        if (h.rowspan > 1) hucre.rowSpan = Math.min(h.rowspan, b.rows.length - ri);
        satir[ci] = hucre;
        for (let dx = 1; dx < h.colspan; dx++) satir[ci + dx] = {};
        for (let dy = 1; dy < h.rowspan && ri + dy < b.rows.length; dy++) for (let dx = 0; dx < h.colspan; dx++) kapli[ri + dy].add(ci + dx);
        ci += h.colspan;
      }
      while (kapli[ri].has(ci)) { satir[ci] = {}; ci += 1; }
      for (let k = 0; k < sutun; k++) if (!satir[k]) satir[k] = { text: "" };
      return satir;
    });
    return {
      table: { headerRows: b.baslik ? 1 : 0, widths: Array(sutun).fill("*"), body: govde },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => "#b0b7c3", vLineColor: () => "#b0b7c3", paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 },
      margin: [0, 0, 0, 10],
    };
  }

  const icerik = uret(bloklar);
  const tanim = {
    info: { title: baslik, author: yazar || undefined, creator: "Evrensel Dönüştürücü" },
    pageSize: "A4",
    pageMargins: [56, 56, 56, 60],
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.3 },
    content: icerik.length ? icerik : [{ text: " " }],
    footer: (sayfa, toplam) => ({ text: `${sayfa} / ${toplam}`, alignment: "center", fontSize: 8, color: "#888888", margin: [0, 24, 0, 0] }),
  };
  return new Promise((coz, red) => {
    try {
      const p = pm.createPdf(tanim);
      const r = p.getBlob((b) => coz(b));
      if (r && typeof r.then === "function") r.then(coz, red);
    } catch (h) { red(h); }
  });
}
