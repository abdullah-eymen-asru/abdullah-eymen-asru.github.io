/*
 * assets/js/belge-tarayici/disa-aktar.js — Çok formatlı dışa aktarma (SIRALI boru hattı).
 * -----------------------------------------------------------------------
 *  Her sayfa: decode → (kırpma/perspektif) → temizleme → kodlama → tuval 0×0 → sıradaki. Tüm sayfalar asla aynı anda RAM'de değildir.
 *  uret()  : ayara göre DOSYA LİSTESİ üretir  → [{blob, ad}]
 *            cikti "pdf"   : tek PDF (pdf-lib; sayfa başına JPEG gömülür)
 *            cikti "gorsel": biçim jpeg/png/webp/"ayni" (her sayfa kaynak biçiminde); paket "zip" (JSZip DEFLATE) ya da "tek" (tek tek)
 *  indir() : dosyaları indirir (birden fazlaysa kısa aralıkla)   paylas(): Web Share API ile (WhatsApp vb.; destekleyen cihazda)
 * -----------------------------------------------------------------------
 */
import { indir as dosyaIndir, bugunDamga, baytlariOku, nefes, IptalHatasi } from "../donusturucu/ortak.js";
import { pdfLibAl } from "../donusturucu/pdf-yukle.js";
import { kutuphaneYukle } from "../donusturucu/cdn.js";
import { MIME, UZANTI, A4_PT, ogeyiKodla, webpDestekli } from "./sikistir.js";

const tamSayi = (n, g = 3) => String(n).padStart(g, "0");
const kontrol = (ctx) => { if (ctx?.iptalEdildi) throw new IptalHatasi(); };
const MIME_UZ = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Sayfanın çıktı biçimi: "ayni" → kaynak biçimi; WebP üretilemiyorsa JPEG'e düşer. */
async function sayfaBicimi(oge, ayar) {
  let mime = ayar.format === "ayni" ? (oge.kaynakMime || "image/jpeg") : MIME[ayar.format] || "image/jpeg";
  let not = "";
  if (mime === "image/webp" && !(await webpDestekli())) { mime = "image/jpeg"; not = "Tarayıcı WebP üretemiyor; JPEG kullanıldı."; }
  return { mime, uzanti: MIME_UZ[mime] || UZANTI.jpeg, not };
}

export async function pdfOlustur(ogeler, ayar, ctx) {
  const { PDFDocument } = await pdfLibAl();
  let doc = await PDFDocument.create();
  doc.setProducer("Asru Belge Tarayıcı (tarayıcı içi)");
  doc.setCreator("Asru Belge Tarayıcı");
  try {
    for (let i = 0; i < ogeler.length; i += 1) {
      kontrol(ctx);
      ctx?.ilerle(i / ogeler.length, `Sayfa ${i + 1}/${ogeler.length} işleniyor…`);
      const { blob, w, h } = await ogeyiKodla(ogeler[i], ayar, "image/jpeg");
      let bayt = new Uint8Array(await baytlariOku(blob));
      const img = await doc.embedJpg(bayt);
      bayt = null;
      let pw; let ph; let cx; let cy; let cw; let ch;
      if (ayar.sayfa === "a4") {
        const yatay = w > h;
        pw = yatay ? A4_PT.h : A4_PT.w; ph = yatay ? A4_PT.w : A4_PT.h;
        const k = Math.min(pw / w, ph / h);
        cw = w * k; ch = h * k; cx = (pw - cw) / 2; cy = (ph - ch) / 2;
      } else {
        pw = (w * 72) / ayar.dpi; ph = (h * 72) / ayar.dpi; cw = pw; ch = ph; cx = 0; cy = 0;
      }
      doc.addPage([pw, ph]).drawImage(img, { x: cx, y: cy, width: cw, height: ch });
      await nefes();
    }
    ctx?.ilerle(0.97, "PDF derleniyor…");
    let veri = await doc.save({ useObjectStreams: true });
    const blob = new Blob([veri], { type: "application/pdf" });
    veri = null;
    return blob;
  } finally { doc = null; }
}

/** Ayara göre indirilecek/paylaşılacak dosyaları üretir. @returns {{dosyalar:{blob,ad}[], not:string}} */
export async function uret(ogeler, ayar, ctx) {
  if (ayar.cikti !== "gorsel") {
    const blob = await pdfOlustur(ogeler, ayar, ctx);
    return { dosyalar: [{ blob, ad: `belge-${bugunDamga()}.pdf` }], not: "" };
  }
  const gorseller = []; let not = "";
  for (let i = 0; i < ogeler.length; i += 1) {
    kontrol(ctx);
    ctx?.ilerle((i / ogeler.length) * 0.9, `Sayfa ${i + 1}/${ogeler.length} işleniyor…`);
    const f = await sayfaBicimi(ogeler[i], ayar);
    if (f.not) not = f.not;
    const { blob } = await ogeyiKodla(ogeler[i], ayar, f.mime);
    gorseller.push({ blob, ad: `belge-${tamSayi(i + 1)}.${f.uzanti}` });
    await nefes();
  }
  if (gorseller.length === 1 || ayar.paket === "tek") return { dosyalar: gorseller, not };
  const JSZip = await kutuphaneYukle("jszip");
  let zip = new JSZip();
  try {
    for (const g of gorseller) zip.file(g.ad, g.blob, { binary: true });
    ctx?.ilerle(0.92, "ZIP paketleniyor…");
    const paket = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: Math.min(9, Math.max(6, ayar.zipSeviye || 6)) }, streamFiles: true },
      (m) => ctx?.ilerle(0.9 + (m.percent / 100) * 0.1, "ZIP paketleniyor…"));
    return { dosyalar: [{ blob: paket, ad: `belge-${bugunDamga()}.zip` }], not };
  } finally { zip = null; }
}

export async function indir(dosyalar, ctx) {
  for (let i = 0; i < dosyalar.length; i += 1) {
    kontrol(ctx);
    dosyaIndir(dosyalar[i].blob, dosyalar[i].ad);
    if (dosyalar.length > 1) await new Promise((c) => setTimeout(c, 450)); // art arda indirme engelini hafiflet
  }
}

export function paylasilabilir(dosyalar) {
  try {
    const f = dosyalar.map((d) => new File([d.blob], d.ad, { type: d.blob.type }));
    return !!(navigator.canShare && navigator.canShare({ files: f }));
  } catch { return false; }
}

export async function paylas(dosyalar) {
  const f = dosyalar.map((d) => new File([d.blob], d.ad, { type: d.blob.type }));
  await navigator.share({ files: f, title: "Taranan belge" });
}

export const toplamBayt = (dosyalar) => dosyalar.reduce((a, d) => a + d.blob.size, 0);
