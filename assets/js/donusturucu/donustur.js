/*
 * assets/js/donusturucu/donustur.js — Ana dönüştürme yönlendiricisi (belge / görsel / PDF / veri).
 * Girdi dosyaları ve çıktılar YALNIZCA bellekte (Blob/ArrayBuffer) durur; hiçbir ağ isteğine konu olmaz.
 * Dönüş: [{ blob, ad }] — birden çok parça (ör. sayfa görselleri, md + görsel klasörü) çağıran tarafta ZIP'e konur.
 */
import { adsizAl, dosyaAdiTemizle, baytlariOku, metinOku, dataUrlBaytlari, nefes, IptalHatasi } from "./ortak.js";
import { FORMATLAR } from "./tur-matrisi.js";
import { belgeHtmlAl } from "./belge-oku.js";
import { htmlDenIR, irDenMd, irDenMetin, irBaslik } from "./belge-ir.js";
import { irDenDocx } from "./belge-docx.js";
import { irDenPdf } from "./belge-pdf.js";
import { htmlDenEpub } from "./belge-epub.js";
import { gorselDonustur, gorsellerdenPdf, sayfaGorseliMime } from "./motor-gorsel.js";
import { veriDonustur } from "./motor-veri.js";
import { kutuphaneYukle } from "./cdn.js";
import { pdfjsAl, pdfLibAl } from "./pdf-yukle.js";
import { temizHtml } from "./temizle.js";

const HTML_SABLON_CSS = "body{font-family:system-ui,Segoe UI,Roboto,sans-serif;line-height:1.6;max-width:800px;margin:2rem auto;padding:0 1rem;color:#222}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:.35rem .5rem}th{background:#f1f3f5}pre{background:#f4f5f7;padding:.8rem;overflow:auto}code{font-family:ui-monospace,Consolas,monospace}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #aab}[align=center]{text-align:center}[align=right]{text-align:right}[align=justify]{text-align:justify}";

export function tamHtmlBelgesi(govde, baslik) {
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(baslik)}</title>\n<style>${HTML_SABLON_CSS}</style>\n</head>\n<body>\n${govde}\n</body>\n</html>\n`;
}

const metinBlob = (m, mime) => new Blob([m], { type: `${mime};charset=utf-8` });

/**
 * HTML pivotundan hedef belge biçimine.
 * @returns {Promise<{blob:Blob, ad:string}[]>}
 */
export async function htmldenCikti(html, hedef, { baslik = "Belge", yazar = "", ctx } = {}) {
  const ad = dosyaAdiTemizle(baslik);
  ctx?.ilerle?.(0.7, "Dosya oluşturuluyor…");
  switch (hedef) {
    case "html": return [{ blob: metinBlob(tamHtmlBelgesi(await temizHtml(html), baslik), "text/html"), ad: `${ad}.html` }];
    case "txt": return [{ blob: metinBlob(irDenMetin(htmlDenIR(html)), "text/plain"), ad: `${ad}.txt` }];
    case "md": {
      const ir = htmlDenIR(html);
      const gorseller = [];
      const md = irDenMd(ir, {
        gorsel: (src) => {
          const v = dataUrlBaytlari(src);
          if (!v) return "";
          const uz = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" }[v.mime.toLowerCase()] || "png";
          const yol = `gorseller/gorsel-${gorseller.length + 1}.${uz}`;
          gorseller.push({ blob: new Blob([v.bayt], { type: v.mime }), ad: yol });
          return yol;
        },
      });
      return [{ blob: metinBlob(md, "text/markdown"), ad: `${ad}.md` }, ...gorseller];
    }
    case "docx": return [{ blob: await irDenDocx(htmlDenIR(html), { baslik, yazar }), ad: `${ad}.docx` }];
    case "pdf": return [{ blob: await irDenPdf(htmlDenIR(html), { baslik, yazar }), ad: `${ad}.pdf` }];
    case "epub": return [{ blob: await htmlDenEpub(html, { baslik, yazar }), ad: `${ad}.epub` }];
    default: throw new Error(`Desteklenmeyen belge çıktısı: ${hedef}`);
  }
}

/* ------------------------------------ PDF kaynaklı ------------------------------------ */

export async function pdfSayfaGorselleri(dosya, hedef, { olcek = 2, ilerle, iptalKontrol, parola } = {}) {
  const pdfjs = await pdfjsAl();
  const bayt = new Uint8Array(await baytlariOku(dosya));
  const gorev = pdfjs.getDocument({ data: bayt });
  gorev.onPassword = async (cevapVer, neden) => { const p = parola ? await parola(neden === 2) : null; if (p == null) { gorev.destroy(); return; } cevapVer(p); };
  const pdf = await gorev.promise;
  const cikti = [];
  const kok = adsizAl(dosya.name);
  const uz = hedef === "jpg" ? "jpg" : hedef;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      iptalKontrol?.();
      const sayfa = await pdf.getPage(n);
      let k = olcek;
      const v0 = sayfa.getViewport({ scale: 1 });
      const alan = v0.width * v0.height * k * k;
      if (alan > 40_000_000) k = Math.sqrt(40_000_000 / (v0.width * v0.height)); // bellek güvenliği
      const vp = sayfa.getViewport({ scale: k });
      const c = document.createElement("canvas");
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx2 = c.getContext("2d");
      ctx2.fillStyle = "#fff"; ctx2.fillRect(0, 0, c.width, c.height);
      await sayfa.render({ canvasContext: ctx2, viewport: vp }).promise;
      const blob = await sayfaGorseliMime(c, hedef);
      c.width = 0; c.height = 0; // belleği hemen bırak
      cikti.push({ blob, ad: `${dosyaAdiTemizle(kok)}-sayfa-${String(n).padStart(3, "0")}.${uz}` });
      sayfa.cleanup?.();
      ilerle?.(n / pdf.numPages, `Sayfa ${n}/${pdf.numPages} görsele çevriliyor…`);
      await nefes();
    }
  } finally { pdf.destroy(); }
  return cikti;
}

/** Taranmış PDF → sayfa görüntülerinden oluşan DOCX (metin yoksa içeriği korumanın tek yolu; OCR yapılmaz). */
async function taranmisDocx(dosya, ctx) {
  const sayfalar = await pdfSayfaGorselleri(dosya, "jpg", { olcek: 1.5, ilerle: ctx.ilerle, iptalKontrol: ctx.iptalKontrol, parola: ctx.parola });
  const bloklar = [];
  for (const s of sayfalar) {
    const u8 = new Uint8Array(await s.blob.arrayBuffer());
    let b64 = "";
    for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    bloklar.push({ t: "img", src: `data:image/jpeg;base64,${btoa(b64)}`, alt: s.ad });
  }
  return irDenDocx(bloklar, { baslik: adsizAl(dosya.name) });
}

export async function pdfBirlestir(dosyalar, { ilerle } = {}) {
  const { PDFDocument } = await pdfLibAl();
  const cikti = await PDFDocument.create();
  let n = 0;
  for (const d of dosyalar) {
    let kaynak;
    try { kaynak = await PDFDocument.load(await baytlariOku(d)); } catch (h) { throw new Error(`${d.name}: PDF okunamadı veya parola korumalı. (${h.message})`); }
    const sayfalar = await cikti.copyPages(kaynak, kaynak.getPageIndices());
    sayfalar.forEach((s) => cikti.addPage(s));
    n += 1;
    ilerle?.(n / dosyalar.length, `Birleştiriliyor: ${n}/${dosyalar.length}`);
  }
  return new Blob([await cikti.save()], { type: "application/pdf" });
}

/* ------------------------------------ ana giriş ------------------------------------ */

/**
 * Tek dosyayı dönüştürür.
 * @param {File} dosya @param {string} tur kaynak tür @param {string} hedef hedef tür
 * @param {{ilerle?:(oran:number,metin:string)=>void, iptalKontrol?:()=>void, uyarilar?:string[], parola?:Function, kalite?:number, sayfaBoyutu?:string, icoBoyutlari?:number[], ayirac?:string, bom?:boolean}} ctx
 */
export async function donustur(dosya, tur, hedef, ctx = {}) {
  const f = FORMATLAR[tur];
  if (!f) throw new Error("Desteklenmeyen dosya türü.");
  const ad = adsizAl(dosya.name);
  ctx.iptalKontrol?.();

  if (f.aile === "veri") {
    ctx.ilerle?.(0.3, "Okunuyor…");
    const s = veriDonustur(tur, hedef, await metinOku(dosya), { ayirac: ctx.ayirac, bom: ctx.bom !== false });
    return [{ blob: metinBlob(s.metin, s.mime), ad: `${dosyaAdiTemizle(ad)}.${s.uzanti}` }];
  }

  if (f.aile === "gorsel") {
    if (hedef === "pdf") return [{ blob: await gorsellerdenPdf([{ blob: dosya, ad: dosya.name }], { sayfaBoyutu: ctx.sayfaBoyutu, ilerle: ctx.ilerle, uyarilar: ctx.uyarilar }), ad: `${dosyaAdiTemizle(ad)}.pdf` }];
    ctx.ilerle?.(0.3, "Dönüştürülüyor…");
    const b = await gorselDonustur(dosya, hedef, { kalite: ctx.kalite, icoBoyutlari: ctx.icoBoyutlari, uyarilar: ctx.uyarilar, ad: dosya.name });
    return [{ blob: b, ad: `${dosyaAdiTemizle(ad)}.${FORMATLAR[hedef].uzanti}` }];
  }

  if (tur === "pdf" && ["png", "jpg", "webp"].includes(hedef)) return pdfSayfaGorselleri(dosya, hedef, ctx);

  ctx.ilerle?.(0.05, "Belge okunuyor…");
  const belge = await belgeHtmlAl(dosya, tur, ctx);
  if (belge.taranmis) {
    if (hedef === "docx") { ctx.uyarilar?.push("Bu PDF taranmış görüntü içeriyor (metin katmanı yok). OCR yapılmaz; sayfalar görüntü olarak Word'e konuldu."); return [{ blob: await taranmisDocx(dosya, ctx), ad: `${dosyaAdiTemizle(ad)}.docx` }]; }
    throw new Error("Bu PDF taranmış bir görüntü gibi görünüyor (metin katmanı yok). Metin çıkarılamaz; 'Word' (sayfa görüntüleri) ya da PNG/JPG seçebilirsin.");
  }
  if (tur === "pdf") ctx.uyarilar?.push("PDF'ten dönüştürmede düzen birebir korunmaz: metin, başlık ve listeler tahmin edilerek yeniden oluşturulur; tablolar/sütunlar düz akışa dönebilir.");
  return htmldenCikti(belge.html, hedef, { baslik: belge.baslik, yazar: belge.yazar, ctx });
}

/** Birden çok çıktıyı (ya da tek çıktı + eşlik eden görseller) tek ZIP blobuna koyar. */
export async function zipPaketle(parcalar) {
  const JSZip = await kutuphaneYukle("jszip");
  const z = new JSZip();
  const kullanilan = new Set();
  for (const p of parcalar) {
    let yol = p.ad;
    let i = 2;
    while (kullanilan.has(yol)) yol = p.ad.replace(/(\.[^./]+)?$/, ` (${i++})$1`);
    kullanilan.add(yol);
    z.file(yol, p.blob);
  }
  return z.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export { IptalHatasi };
