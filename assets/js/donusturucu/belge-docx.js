/*
 * assets/js/donusturucu/belge-docx.js — IR → Word (.docx) (docx kütüphanesi, istemci tarafı).
 * Başlıklar (1-6), kalın/italik/altı-üstü çizili/kod/üst-alt simge, bağlantı, iç içe numaralı/madde işaretli liste (her
 * ordered liste kendi numaralandırma örneğiyle yeniden başlar), tablo (colspan/rowspan), alıntı, kod bloğu, ayraç, gömülü görsel.
 */
import { kutuphaneYukle } from "./cdn.js";
import { gorselHazirla } from "./motor-gorsel.js";


const KENAR = { top: 1134, bottom: 1134, left: 1304, right: 1304 }; // ≈2 cm / 2,3 cm
const ICERIK_DXA = 11906 - KENAR.left - KENAR.right;
const MAKS_GORSEL_PX = 580;

export async function irDenDocx(bloklar, { baslik = "Belge", yazar = "" } = {}) {
  const D = await kutuphaneYukle("docx");
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, ExternalHyperlink,
    AlignmentType, LevelFormat, BorderStyle, ShadingType, VerticalMergeType,
  } = D;

  const BASLIKLAR = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
  const HIZA = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const numaralar = []; // her ordered liste için {reference}
  let siradaki = 0;

  const koşu = (r, ekstra = {}) => {
    if (r.br) return new TextRun({ break: 1 });
    const o = {
      text: r.text, bold: !!(r.b || ekstra.bold), italics: !!r.i, strike: !!r.s,
      underline: r.u || ekstra.underline ? {} : undefined,
      superScript: !!r.sup, subScript: !!r.sub,
      ...ekstra,
    };
    if (r.code) { o.font = "Consolas"; o.shading = { type: ShadingType.CLEAR, fill: "EEF0F2", color: "auto" }; }
    if (r.mark) o.highlight = "yellow";
    if (r.href) { o.style = "Hyperlink"; }
    return new TextRun(o);
  };

  const runlar = (runs, ekstra) => runs.map((r) => (r.href
    ? new ExternalHyperlink({ link: r.href, children: [koşu(r, ekstra)] })
    : koşu(r, ekstra)));

  // Görselleri önceden hazırla (asenkron)
  const gorselHaritasi = new Map();
  async function gorselleriTopla(bl) {
    for (const b of bl) {
      if (b.t === "img" && !gorselHaritasi.has(b.src)) gorselHaritasi.set(b.src, await gorselHazirla(b.src, ["png", "jpg", "gif", "bmp"]));
      else if (b.t === "list") for (const it of b.items) await gorselleriTopla(it.blocks);
      else if (b.t === "quote") await gorselleriTopla(b.blocks);
      else if (b.t === "table") for (const r of b.rows) for (const h of r) await gorselleriTopla(h.blocks);
    }
  }
  await gorselleriTopla(bloklar);

  const gorselParagraf = (b, ekstra = {}) => {
    const g = gorselHaritasi.get(b.src);
    if (!g) return new Paragraph({ children: [new TextRun({ text: `[Görsel${b.alt ? `: ${b.alt}` : ""}]`, italics: true, color: "777777" })], ...ekstra });
    const k = Math.min(1, MAKS_GORSEL_PX / g.w);
    return new Paragraph({
      ...ekstra,
      children: [new ImageRun({ type: g.tip, data: g.bayt, transformation: { width: Math.max(1, Math.round(g.w * k)), height: Math.max(1, Math.round(g.h * k)) }, altText: { title: b.alt || "görsel", description: b.alt || "görsel", name: "gorsel" } })],
    });
  };

  const blokUret = (bl, ctx = {}) => {
    const cikti = [];
    for (const b of bl) {
      switch (b.t) {
        case "h":
          cikti.push(new Paragraph({ heading: BASLIKLAR[b.lv - 1], alignment: HIZA[b.align], indent: ctx.girinti ? { left: ctx.girinti } : undefined, children: runlar(b.runs) }));
          break;
        case "p":
          cikti.push(new Paragraph({
            alignment: HIZA[b.align],
            numbering: ctx.numara,
            indent: ctx.girinti && !ctx.numara ? { left: ctx.girinti } : undefined,
            border: ctx.alinti ? { left: { style: BorderStyle.SINGLE, size: 12, space: 8, color: "A3AEC2" } } : undefined,
            spacing: { after: 120 },
            children: runlar(b.runs, ctx.alinti ? { italics: true, color: "4B5563" } : ctx.kalin ? { bold: true } : {}),
          }));
          break;
        case "list": {
          const ref = b.ordered ? `ol${siradaki++}` : "madde";
          if (b.ordered) numaralar.push({ reference: ref, baslangic: b.start });
          const seviye = Math.min(ctx.seviye ?? 0, 8);
          for (const it of b.items) {
            let ilk = true;
            for (const alt of it.blocks) {
              if (alt.t === "p" && ilk) {
                cikti.push(new Paragraph({ numbering: { reference: ref, level: seviye }, spacing: { after: 60 }, children: runlar(alt.runs) }));
              } else if (alt.t === "list") {
                cikti.push(...blokUret([alt], { ...ctx, seviye: seviye + 1 }));
              } else {
                cikti.push(...blokUret([alt], { ...ctx, girinti: 720 * (seviye + 1) }));
              }
              ilk = false;
            }
            if (!it.blocks.length) cikti.push(new Paragraph({ numbering: { reference: ref, level: seviye }, children: [] }));
          }
          break;
        }
        case "table": cikti.push(tabloUret(b)); cikti.push(new Paragraph({ children: [], spacing: { after: 80 } })); break;
        case "quote": cikti.push(...blokUret(b.blocks, { ...ctx, alinti: true, girinti: (ctx.girinti || 0) + 567 })); break;
        case "code":
          for (const satir of (b.text || " ").split("\n")) {
            cikti.push(new Paragraph({
              spacing: { after: 0, line: 260 },
              shading: { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" },
              children: [new TextRun({ text: satir || " ", font: "Consolas", size: 19 })],
            }));
          }
          cikti.push(new Paragraph({ children: [], spacing: { after: 80 } }));
          break;
        case "hr":
          cikti.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "BBBBBB" } }, spacing: { after: 120 }, children: [] }));
          break;
        case "img": cikti.push(gorselParagraf(b, { spacing: { after: 120 } })); break;
        default: break;
      }
    }
    return cikti;
  };

  function tabloUret(b) {
    const sutun = Math.max(1, Math.max(...b.rows.map((r) => r.reduce((a, h) => a + h.colspan, 0))));
    const w = Math.floor(ICERIK_DXA / sutun);
    const cizgi = { style: BorderStyle.SINGLE, size: 4, color: "B0B7C3" };
    const kenarlar = { top: cizgi, bottom: cizgi, left: cizgi, right: cizgi };
    // rowspan: kapsanan hücreler sonraki satırlarda ATLANIR; docx dikey birleştirmeyi kendisi tamamlar
    const kapli = b.rows.map(() => new Set());
    const satirlar = b.rows.map((r, ri) => {
      const hucreler = [];
      let c = 0;
      for (const h of r) {
        while (kapli[ri].has(c)) c += 1;
        for (let dy = 1; dy < h.rowspan && ri + dy < b.rows.length; dy++) for (let dx = 0; dx < h.colspan; dx++) kapli[ri + dy].add(c + dx);
        const baslikH = h.th || (b.baslik && ri === 0);
        const icerik = blokUret(h.blocks.length ? h.blocks : [{ t: "p", runs: [{ text: "" }] }], { kalin: baslikH });
        hucreler.push(new TableCell({
          width: { size: w * h.colspan, type: WidthType.DXA },
          columnSpan: h.colspan > 1 ? h.colspan : undefined,
          rowSpan: h.rowspan > 1 ? Math.min(h.rowspan, b.rows.length - ri) : undefined,
          borders: kenarlar,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          shading: baslikH ? { type: ShadingType.CLEAR, fill: "EEF1F5", color: "auto" } : undefined,
          children: icerik.length ? icerik : [new Paragraph({ children: [] })],
        }));
        c += h.colspan;
      }
      return new TableRow({ tableHeader: b.baslik && ri === 0, cantSplit: true, children: hucreler });
    });
    return new Table({ width: { size: w * sutun, type: WidthType.DXA }, columnWidths: Array(sutun).fill(w), rows: satirlar });
  }

  const cocuklar = blokUret(bloklar);
  if (!cocuklar.length) cocuklar.push(new Paragraph({ children: [] }));

  const seviyeler = (format, metin) => Array.from({ length: 9 }, (_, i) => ({
    level: i, format, text: metin(i), alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } },
  }));
  const config = [
    { reference: "madde", levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: LevelFormat.BULLET, text: ["•", "◦", "▪"][i % 3], alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } } })) },
    ...numaralar.map((n) => ({
      reference: n.reference,
      levels: seviyeler(LevelFormat.DECIMAL, (i) => `%${i + 1}.`).map((l, i) => (i === 0 ? { ...l, start: n.baslangic || 1 } : l)),
    })),
  ];

  const doc = new Document({
    creator: yazar || "Evrensel Dönüştürücü",
    title: baslik,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 300 } } } },
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: "0563C1", underline: {} } }],
    },
    numbering: { config },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: KENAR } }, children: cocuklar }],
  });
  return Packer.toBlob(doc);
}

