/*
 * assets/js/belge-tarayici/girdi.js — Evrensel girdi & ayıklama katmanı.
 * -----------------------------------------------------------------------
 *  JPG/PNG/WEBP/GIF/BMP/AVIF → dosyanın kendisi "çalışma kopyası" olur (ek RAM yok; File diskten okunur)
 *  HEIC/HEIF                 → bir kez çözülüp JPEG çalışma kopyasına çevrilir (heic2any, yalnızca gerekirse)
 *  TIFF (çok sayfalı)        → tarayıcı çözebiliyorsa yerel; değilse UTIF.js (CDN) → her sayfa JPEG
 *  PDF                       → pdfjs-dist: her sayfa SIRAYLA tuvale çizilir → JPEG çalışma kopyası → tuval/sayfa serbest
 *  DOCX                      → JSZip: word/media/* görselleri belge sırasına göre tek tek ayıklanır
 *  Her öge: { ad, blob, w, h, orijinalBayt, kaynakAd }. Yield'ler (onOge) tek tek verilir: tüm sayfalar aynı anda RAM'e girmez.
 * -----------------------------------------------------------------------
 */
import { baytlariOku, uzantiAl, adsizAl, nefes, IptalHatasi } from "../donusturucu/ortak.js";
import { gorselCoz } from "../donusturucu/motor-gorsel.js";
import { kutuphaneYukle } from "../donusturucu/cdn.js";
import { pdfjsAl, pdfBirak } from "../donusturucu/pdf-yukle.js";
import { tuvalAl, tuvalBirak, alanaSigdir } from "./bellek-kalkani.js";

const GORSEL_UZ = new Set(["jpg", "jpeg", "jpe", "jfif", "png", "webp", "gif", "bmp", "avif", "heic", "heif"]);
const TIFF_UZ = new Set(["tif", "tiff"]);
const DOCX_GORSEL_UZ = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"]);

/** Çalışma kopyası: PDF/TIFF/HEIC için uzun kenar sınırı (px). 3508 ≈ A4 @ 300 DPI. */
const CALISMA_KENAR = 3508;
const CALISMA_KALITE = 0.92;

export const KABUL = ".jpg,.jpeg,.png,.webp,.gif,.bmp,.avif,.heic,.heif,.tif,.tiff,.pdf,.docx";

export function girdiTuru(f) {
  const uz = uzantiAl(f.name);
  const t = String(f.type || "").toLowerCase();
  if (uz === "pdf" || t === "application/pdf") return "pdf";
  if (uz === "docx" || t.includes("wordprocessingml")) return "docx";
  if (TIFF_UZ.has(uz) || t === "image/tiff") return "tiff";
  if (GORSEL_UZ.has(uz) || t.startsWith("image/")) return "gorsel";
  return null;
}

/** Çıktıda "aynı biçim" seçilirse sayfa hangi biçimde kodlanacak: JPEG/PNG/WebP korunur, diğerleri JPEG olur. */
function mimeBelirle(blob, uz) {
  const t = String(blob.type || "").toLowerCase();
  if (t === "image/png" || uz === "png") return "image/png";
  if (t === "image/webp" || uz === "webp") return "image/webp";
  return "image/jpeg";
}

const tuvalJpeg = (c, kalite = CALISMA_KALITE) => new Promise((coz, red) => c.toBlob((b) => (b ? coz(b) : red(new Error("Tuval dışa aktarılamadı."))), "image/jpeg", kalite));

function iptalKontrol(ctx) { if (ctx?.iptalEdildi) throw new IptalHatasi(); }

/** Bir dosyayı ögelere ayırır; her öge hazır olunca onOge(oge) çağrılır. Dönüş: {adet, uyarilar[]} */
export async function dosyayiAyikla(file, { onOge, ctx, uyar = () => {} }) {
  const tur = girdiTuru(file);
  if (!tur) throw new Error("Desteklenmeyen dosya türü.");
  if (tur === "pdf") return pdfAyikla(file, onOge, ctx, uyar);
  if (tur === "docx") return docxAyikla(file, onOge, ctx, uyar);
  if (tur === "tiff") return tiffAyikla(file, onOge, ctx, uyar);
  return tekGorsel(file, onOge, uyar);
}

/* ------------------------------ tek görsel (+HEIC) ------------------------------ */

async function tekGorsel(file, onOge, uyar) {
  const uz = uzantiAl(file.name);
  const cozum = await gorselCoz(file, file.name); // bozuk dosya burada hata verir; HEIC çözülür
  try {
    let blob = file;
    if (uz === "heic" || uz === "heif") {
      // HEIC'i her işlemde yeniden çözmemek için JPEG çalışma kopyası
      const k = Math.min(1, CALISMA_KENAR / Math.max(cozum.w, cozum.h));
      const a = alanaSigdir(cozum.w * k, cozum.h * k);
      const c = tuvalAl(a.w, a.h);
      try {
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, a.w, a.h);
        g.drawImage(cozum.cizilebilir, 0, 0, a.w, a.h);
        blob = await tuvalJpeg(c);
      } finally { tuvalBirak(c); }
    } else if (uz === "gif") uyar(`${file.name}: GIF'in yalnızca ilk karesi alındı.`);
    await onOge({ ad: `${adsizAl(file.name)}`, blob, w: cozum.w, h: cozum.h, orijinalBayt: file.size, kaynakAd: file.name, tur: "foto", kaynakMime: mimeBelirle(blob, uz) });
  } finally { cozum.kapat?.(); }
  return { adet: 1 };
}

/* ------------------------------ TIFF ------------------------------ */

async function tiffAyikla(file, onOge, ctx, uyar) {
  // 1) Tarayıcı yerel çözebiliyor mu? (Safari: evet; Chrome/Firefox: hayır)
  try {
    const c = await createImageBitmap(file);
    const w = c.width; const h = c.height; c.close?.();
    await onOge({ ad: adsizAl(file.name), blob: file, w, h, orijinalBayt: file.size, kaynakAd: file.name, tur: "tarama", kaynakMime: "image/jpeg" });
    uyar(`${file.name}: yerel çözümleyici kullanıldı (çok sayfalı TIFF'in yalnızca ilk sayfası).`);
    return { adet: 1 };
  } catch { /* UTIF'e düş */ }
  try { await kutuphaneYukle("pako"); } catch { /* isteğe bağlı: Deflate sıkıştırmalı TIFF için */ }
  const UTIF = await kutuphaneYukle("utif");
  let buf = await baytlariOku(file);
  const ifdler = UTIF.decode(buf);
  const adet = ifdler.length;
  for (let i = 0; i < adet; i += 1) {
    iptalKontrol(ctx);
    const ifd = ifdler[i];
    UTIF.decodeImage(buf, ifd);
    const w = ifd.width; const h = ifd.height;
    let rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd));
    const k = Math.min(1, CALISMA_KENAR / Math.max(w, h));
    const kaynak = tuvalAl(w, h);
    let blob;
    try {
      kaynak.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
      rgba = null;
      if (k < 1) {
        const a = alanaSigdir(w * k, h * k);
        const kucuk = tuvalAl(a.w, a.h);
        try {
          const g = kucuk.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, a.w, a.h);
          g.imageSmoothingQuality = "high";
          g.drawImage(kaynak, 0, 0, a.w, a.h);
          blob = await tuvalJpeg(kucuk);
        } finally { tuvalBirak(kucuk); }
      } else blob = await tuvalJpeg(kaynak);
    } finally { tuvalBirak(kaynak); }
    ifd.data = null; ifd.t = null; // büyük tamponları bırak
    await onOge({ ad: adet > 1 ? `${adsizAl(file.name)}-s${i + 1}` : adsizAl(file.name), blob, w, h, orijinalBayt: Math.round(file.size / adet), kaynakAd: file.name, tur: "tarama", kaynakMime: "image/jpeg" });
    await nefes();
  }
  buf = null;
  return { adet };
}

/* ------------------------------ PDF ------------------------------ */

async function pdfAyikla(file, onOge, ctx, uyar) {
  const pdfjs = await pdfjsAl();
  let u8 = new Uint8Array(await baytlariOku(file));
  const gorev = pdfjs.getDocument({ data: u8, isEvalSupported: false });
  let pdf;
  try { pdf = await gorev.promise; } catch (h) {
    pdfBirak(gorev, null);
    if (h?.name === "PasswordException") throw new Error("PDF parola korumalı; önce parolasını kaldır.");
    throw h;
  }
  const adet = pdf.numPages;
  try {
    for (let n = 1; n <= adet; n += 1) {
      iptalKontrol(ctx);
      const sayfa = await pdf.getPage(n);
      let c = null;
      try {
        const v1 = sayfa.getViewport({ scale: 1 });
        // 72 pt = 1 inç → uzun kenarı CALISMA_KENAR px'e (≈300 DPI A4) sınırla
        const olcek = Math.min(CALISMA_KENAR / Math.max(v1.width, v1.height), 4);
        const a = alanaSigdir(v1.width * olcek, v1.height * olcek);
        const vp = sayfa.getViewport({ scale: a.w / v1.width });
        c = tuvalAl(Math.round(vp.width), Math.round(vp.height));
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await sayfa.render({ canvasContext: g, viewport: vp }).promise;
        const blob = await tuvalJpeg(c);
        await onOge({ ad: `${adsizAl(file.name)}-s${n}`, blob, w: c.width, h: c.height, orijinalBayt: Math.round(file.size / adet), kaynakAd: file.name, tur: "pdf", kaynakMime: "image/jpeg" });
      } finally {
        try { sayfa.cleanup?.(); } catch { /* yok say */ }
        c = tuvalBirak(c);
      }
      await nefes();
    }
  } finally {
    pdfBirak(gorev, pdf);
    pdf = null; u8 = null;
  }
  if (adet > 80) uyar(`${file.name}: ${adet} sayfa — bellek için çıktıyı parça parça (ör. 40 sayfalık gruplar) almanı öneririz.`);
  return { adet };
}

/* ------------------------------ DOCX ------------------------------ */

async function docxAyikla(file, onOge, ctx, uyar) {
  const JSZip = await kutuphaneYukle("jszip");
  let zip = await JSZip.loadAsync(file);
  let sirali = [];
  try {
    const medya = Object.keys(zip.files).filter((p) => /^word\/media\//i.test(p) && !zip.files[p].dir);
    const destekli = medya.filter((p) => DOCX_GORSEL_UZ.has(uzantiAl(p)));
    const atlanan = medya.length - destekli.length;
    if (atlanan > 0) uyar(`${file.name}: ${atlanan} görsel (EMF/WMF/SVG gibi) tarayıcıda çözülemediği için atlandı.`);
    // belge sırası: document.xml içindeki r:embed sırası → rels hedefleri
    try {
      const rels = await zip.file("word/_rels/document.xml.rels")?.async("string");
      const doc = await zip.file("word/document.xml")?.async("string");
      if (rels && doc) {
        const harita = new Map();
        for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
          const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
          const hedef = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
          if (id && hedef) harita.set(id, `word/${hedef.replace(/^\/?(word\/)?/, "")}`);
        }
        const gorulen = new Set();
        for (const m of doc.matchAll(/r:embed="([^"]+)"/g)) {
          const yol = harita.get(m[1]);
          if (yol && destekli.includes(yol) && !gorulen.has(yol)) { gorulen.add(yol); sirali.push(yol); }
        }
      }
    } catch { /* ada göre sırala */ }
    for (const p of destekli) if (!sirali.includes(p)) sirali.push(p);
    if (!sirali.length) throw new Error("Bu Word dosyasında görsel bulunamadı.");
    let i = 0;
    for (const yol of sirali) {
      iptalKontrol(ctx);
      i += 1;
      const uz = uzantiAl(yol);
      const ham = await zip.file(yol).async("blob");
      const blob = new Blob([ham], { type: uz === "png" ? "image/png" : uz === "gif" ? "image/gif" : uz === "bmp" ? "image/bmp" : uz === "webp" ? "image/webp" : uz.startsWith("tif") ? "image/tiff" : "image/jpeg" });
      try {
        const c = await gorselCoz(blob, yol);
        const w = c.w; const h = c.h; c.kapat?.();
        await onOge({ ad: `${adsizAl(file.name)}-g${i}`, blob, w, h, orijinalBayt: blob.size, kaynakAd: file.name, tur: "docx", kaynakMime: blob.type || "image/jpeg" });
      } catch { uyar(`${file.name}: ${yol.split("/").pop()} çözülemedi, atlandı.`); }
      await nefes();
    }
    return { adet: sirali.length };
  } finally { zip = null; sirali = null; }
}
