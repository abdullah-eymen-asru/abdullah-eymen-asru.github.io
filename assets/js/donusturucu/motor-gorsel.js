/*
 * assets/js/donusturucu/motor-gorsel.js — Görsel dönüştürme (Canvas tabanlı, %100 istemci).
 *  Girdi : JPG/PNG/WebP/AVIF/BMP/ICO/SVG/GIF(ilk kare)/HEIC-HEIF (heic2any, yalnızca gerekirse)
 *  Çıktı : JPG/PNG/WebP/AVIF (tarayıcı destekliyorsa) + BMP + ICO (PNG gömülü) + SVG (gömülü raster) + PDF (pdf-lib)
 *  Sınırlar: iOS Safari canvas alanı ~16,7 MP ile sınırlıdır → büyük görseller otomatik ölçeklenir ve kullanıcıya bildirilir.
 */
import { baytlariOku, dataUrlBaytlari, baytlardanDataUrl, IOS_MU, uzantiAl } from "./ortak.js";
import { kutuphaneYukle } from "./cdn.js";

const MAKS_ALAN = () => (IOS_MU() ? 16_000_000 : 120_000_000);

function heicMi(u8, ad) {
  if (/\.(heic|heif)$/i.test(ad || "")) return true;
  if (u8.length < 12) return false;
  const marka = String.fromCharCode(...u8.subarray(4, 12));
  return /^ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(marka);
}

function boyutAyarla(w, h, uyarilar) {
  const alan = w * h;
  const sinir = MAKS_ALAN();
  if (alan <= sinir) return { w, h };
  const k = Math.sqrt(sinir / alan);
  uyarilar?.push(`Görsel çok büyük (${Math.round(alan / 1e6)} MP); cihaz sınırı nedeniyle ${Math.round(w * k)}×${Math.round(h * k)} px'e küçültüldü.`);
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)) };
}

function imgYukle(url) {
  return new Promise((coz, red) => {
    const i = new Image();
    i.decoding = "async";
    i.onload = () => coz(i);
    i.onerror = () => red(new Error("Görsel çözülemedi (bozuk ya da desteklenmeyen biçim)."));
    i.src = url;
  });
}

/** Blob/File → { cizilebilir, w, h, kapat() }. */
export async function gorselCoz(blob, ad = "") {
  let kaynak = blob;
  const u8 = new Uint8Array(await baytlariOku(blob.slice(0, 16)));
  const uzanti = uzantiAl(ad);
  if (heicMi(u8, ad)) {
    let nativeOk = null;
    try { nativeOk = await createImageBitmap(blob); } catch { /* yerel çözüm yok */ }
    if (nativeOk) return { cizilebilir: nativeOk, w: nativeOk.width, h: nativeOk.height, kapat: () => nativeOk.close?.() };
    let heic2any;
    try { heic2any = await kutuphaneYukle("heic2any"); } catch (h) { throw new Error(`HEIC çözücü yüklenemedi: ${h.message}`); }
    try {
      const sonuc = await heic2any({ blob, toType: "image/png" });
      kaynak = Array.isArray(sonuc) ? sonuc[0] : sonuc;
    } catch (h) {
      throw new Error(`HEIC çözülemedi. Sitenin CSP'sinde 'wasm-unsafe-eval' yoksa WebAssembly engellenir (rehber/05-donusturucu.md). Ayrıntı: ${h?.message || h}`);
    }
  }
  const svg = uzanti === "svg" || blob.type === "image/svg+xml";
  if (!svg) {
    try {
      const bmp = await createImageBitmap(kaynak);
      return { cizilebilir: bmp, w: bmp.width, h: bmp.height, kapat: () => bmp.close?.() };
    } catch { /* <img> yoluna düş */ }
  }
  let blobUrl = URL.createObjectURL(svg ? new Blob([await kaynak.arrayBuffer()], { type: "image/svg+xml" }) : kaynak);
  try {
    const i = await imgYukle(blobUrl);
    let w = i.naturalWidth;
    let h = i.naturalHeight;
    if (!w || !h) { w = 1024; h = 768; } // ölçüsüz SVG
    return { cizilebilir: i, w, h, kapat: () => {} };
  } finally {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
}

function tuval(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function kanvasBlob(c, mime, kalite) {
  return new Promise((coz, red) => c.toBlob((b) => (b ? coz(b) : red(new Error("Tuval dışa aktarılamadı."))), mime, kalite));
}

const destekCache = new Map();
/** Tarayıcı bu biçimi gerçekten ÜRETEBİLİYOR mu? (Safari webp'yi sessizce png'ye çevirir.) */
export async function cikisDestekleniyor(mime) {
  if (mime === "image/png" || mime === "image/jpeg") return true;
  if (!destekCache.has(mime)) {
    destekCache.set(mime, (async () => {
      try {
        const b = await kanvasBlob(tuval(2, 2), mime, 0.8);
        return b.type === mime;
      } catch { return false; }
    })());
  }
  return destekCache.get(mime);
}

function bmpKodla(c) {
  const w = c.width;
  const h = c.height;
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, 0, w, h).data;
  const satir = Math.ceil((w * 3) / 4) * 4;
  const boyut = 54 + satir * h;
  const buf = new ArrayBuffer(boyut);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4d);
  v.setUint32(2, boyut, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, satir * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * satir;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + 3] / 255;
      // saydamlık beyaz zemine karıştırılır (BMP 24-bit alfa taşımaz)
      u8[o++] = Math.round(d[i + 2] * a + 255 * (1 - a));
      u8[o++] = Math.round(d[i + 1] * a + 255 * (1 - a));
      u8[o++] = Math.round(d[i] * a + 255 * (1 - a));
    }
  }
  return new Blob([buf], { type: "image/bmp" });
}

async function icoKodla(g, boyutlar) {
  const kaynakEn = Math.max(g.w, g.h);
  let liste = (boyutlar?.length ? boyutlar : [16, 32, 48, 64, 128, 256]).filter((s) => s <= 256);
  const kucukler = liste.filter((s) => s <= kaynakEn);
  liste = kucukler.length ? kucukler : [Math.min(256, 16)];
  const pngler = [];
  for (const s of liste) {
    const c = tuval(s, s);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    const k = Math.min(s / g.w, s / g.h);
    const dw = Math.max(1, Math.round(g.w * k));
    const dh = Math.max(1, Math.round(g.h * k));
    ctx.drawImage(g.cizilebilir, (s - dw) / 2, (s - dh) / 2, dw, dh);
    pngler.push({ s, bayt: new Uint8Array(await (await kanvasBlob(c, "image/png")).arrayBuffer()) });
  }
  const bas = 6 + 16 * pngler.length;
  const toplam = bas + pngler.reduce((a, p) => a + p.bayt.length, 0);
  const buf = new ArrayBuffer(toplam);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, pngler.length, true);
  let ofset = bas;
  pngler.forEach((p, i) => {
    const e = 6 + i * 16;
    u8[e] = p.s >= 256 ? 0 : p.s; u8[e + 1] = p.s >= 256 ? 0 : p.s; u8[e + 2] = 0; u8[e + 3] = 0;
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, p.bayt.length, true); v.setUint32(e + 12, ofset, true);
    u8.set(p.bayt, ofset);
    ofset += p.bayt.length;
  });
  return new Blob([buf], { type: "image/x-icon" });
}

function svgSar(png, w, h) {
  const url = baytlardanDataUrl(png, "image/png");
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" xlink:href="${url}" href="${url}"/></svg>\n`], { type: "image/svg+xml" });
}

/**
 * Tek görseli hedef biçime çevirir.
 * @param {Blob} blob @param {string} hedef jpg|png|webp|avif|bmp|ico|svg
 * @param {{kalite?:number, arkaPlan?:string, icoBoyutlari?:number[], uyarilar?:string[], ad?:string}} s
 * @returns {Promise<Blob>}
 */
export async function gorselDonustur(blob, hedef, s = {}) {
  const g = await gorselCoz(blob, s.ad);
  try {
    const { w, h } = boyutAyarla(g.w, g.h, s.uyarilar);
    if (hedef === "ico") return await icoKodla(g, s.icoBoyutlari);
    const c = tuval(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: hedef === "bmp" });
    ctx.imageSmoothingQuality = "high";
    if (hedef === "jpg" || hedef === "bmp") { ctx.fillStyle = s.arkaPlan || "#ffffff"; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(g.cizilebilir, 0, 0, w, h);
    const kalite = s.kalite ?? 0.92;
    switch (hedef) {
      case "jpg": return await kanvasBlob(c, "image/jpeg", kalite);
      case "png": return await kanvasBlob(c, "image/png");
      case "webp": case "avif": {
        const mime = hedef === "webp" ? "image/webp" : "image/avif";
        const b = await kanvasBlob(c, mime, kalite);
        if (b.type !== mime) throw new Error(`Bu tarayıcı ${hedef.toUpperCase()} üretemiyor; PNG ya da JPG seç.`);
        return b;
      }
      case "bmp": return bmpKodla(c);
      case "svg": return svgSar(new Uint8Array(await (await kanvasBlob(c, "image/png")).arrayBuffer()), w, h);
      default: throw new Error(`Desteklenmeyen görsel çıktısı: ${hedef}`);
    }
  } finally {
    g.kapat();
  }
}

/**
 * pdf-lib ile görsellerden PDF. sayfaBoyutu: "gorsel" (görselin ölçüsü) | "a4".
 * @param {{blob:Blob, ad:string}[]} gorseller
 */
export async function gorsellerdenPdf(gorseller, { sayfaBoyutu = "gorsel", kenar = 0, ilerle, uyarilar } = {}) {
  const { pdfLibAl } = await import("./pdf-yukle.js");
  const { PDFDocument } = await pdfLibAl();
  const pdf = await PDFDocument.create();
  let n = 0;
  for (const { blob, ad } of gorseller) {
    const u8 = new Uint8Array(await baytlariOku(blob));
    const jpeg = u8[0] === 0xff && u8[1] === 0xd8;
    const png = u8[0] === 0x89 && u8[1] === 0x50;
    let resim;
    let w;
    let h;
    if (jpeg || png) {
      // JPEG/PNG bayt olarak gömülür (yeniden kodlama yok → kayıpsız, hızlı). Ölçü için çöz.
      resim = jpeg ? await pdf.embedJpg(u8) : await pdf.embedPng(u8);
      w = resim.width; h = resim.height;
    } else {
      const png2 = await gorselDonustur(blob, "png", { ad, uyarilar });
      resim = await pdf.embedPng(new Uint8Array(await png2.arrayBuffer()));
      w = resim.width; h = resim.height;
    }
    let sw; let sh; let cw; let ch; let x; let y;
    if (sayfaBoyutu === "a4") {
      sw = 595.28; sh = 841.89;
      if (w > h) { [sw, sh] = [sh, sw]; }
      const kw = sw - 2 * kenar; const kh = sh - 2 * kenar;
      const k = Math.min(kw / w, kh / h);
      cw = w * k; ch = h * k; x = (sw - cw) / 2; y = (sh - ch) / 2;
    } else {
      const pt = 0.75; // 96 dpi px → pt
      sw = w * pt + 2 * kenar; sh = h * pt + 2 * kenar; cw = w * pt; ch = h * pt; x = kenar; y = kenar;
    }
    const sayfa = pdf.addPage([sw, sh]);
    sayfa.drawImage(resim, { x, y, width: cw, height: ch });
    n += 1;
    ilerle?.(n / gorseller.length, `Sayfa ${n}/${gorseller.length}`);
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}

/** Veri URI'sinden (docx/pdf/epub gömme için) { bayt, tip, w, h } — desteklenmeyen türler PNG'ye çevrilir. */
export async function gorselHazirla(src, izinli = ["png", "jpg"]) {
  const v = dataUrlBaytlari(src);
  if (!v) return null;
  const mime = v.mime.toLowerCase();
  const tip = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/gif" ? "gif" : mime === "image/bmp" ? "bmp" : null;
  const blob = new Blob([v.bayt], { type: mime });
  let g;
  try { g = await gorselCoz(blob, ""); } catch { return null; }
  try {
    if (tip && izinli.includes(tip)) return { bayt: v.bayt, tip, w: g.w, h: g.h };
    const { w, h } = boyutAyarla(g.w, g.h);
    const c = tuval(w, h);
    c.getContext("2d").drawImage(g.cizilebilir, 0, 0, w, h);
    const b = await kanvasBlob(c, "image/png");
    return { bayt: new Uint8Array(await b.arrayBuffer()), tip: "png", w, h };
  } finally { g.kapat(); }
}

export async function sayfaGorseliMime(canvas, hedef, kalite = 0.92) {
  if (hedef === "jpg") {
    const c = tuval(canvas.width, canvas.height);
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
    return kanvasBlob(c, "image/jpeg", kalite);
  }
  if (hedef === "webp") {
    const b = await kanvasBlob(canvas, "image/webp", kalite);
    if (b.type !== "image/webp") throw new Error("Bu tarayıcı WebP üretemiyor; PNG ya da JPG seç.");
    return b;
  }
  return kanvasBlob(canvas, "image/png");
}
