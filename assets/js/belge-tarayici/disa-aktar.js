/*
 * assets/js/belge-tarayici/disa-aktar.js — Çok formatlı dışa aktarma (SIRALI boru hattı).
 * -----------------------------------------------------------------------
 *  Her sayfa: decode → perspektif → temizleme → kodlama → tuval 0×0 → sıradaki. Tüm sayfalar asla aynı anda RAM'de değildir.
 *  PDF  : pdf-lib; sayfa başına JPEG gömülür (PDF'e WebP/PNG gömülmez); bayt dizisi gömüldükten hemen sonra null.
 *  ZIP  : JSZip DEFLATE (seviye 6–9), streamFiles; üretim bitince tamponlar null.
 *  Tek tek : kısa aralıkla indirme (tarayıcılar art arda indirmeyi engelleyebilir → ZIP öner).
 * -----------------------------------------------------------------------
 */
import { indir, bugunDamga, baytlariOku, nefes, IptalHatasi } from "../donusturucu/ortak.js";
import { pdfLibAl } from "../donusturucu/pdf-yukle.js";
import { kutuphaneYukle } from "../donusturucu/cdn.js";
import { MIME, UZANTI, A4_PT, ogeyiKodla, webpDestekli } from "./sikistir.js";

const tamSayi = (n, g = 3) => String(n).padStart(g, "0");
const kontrol = (ctx) => { if (ctx?.iptalEdildi) throw new IptalHatasi(); };

async function etkinFormat(ayar) {
  if (ayar.format === "webp" && !(await webpDestekli())) return { mime: MIME.jpeg, uzanti: "jpg", not: "Tarayıcı WebP üretemiyor; JPEG kullanıldı." };
  return { mime: MIME[ayar.format], uzanti: UZANTI[ayar.format], not: "" };
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
      const sayfa = doc.addPage([pw, ph]);
      sayfa.drawImage(img, { x: cx, y: cy, width: cw, height: ch });
      await nefes();
    }
    ctx?.ilerle(0.97, "PDF derleniyor…");
    let veri = await doc.save({ useObjectStreams: true });
    const blob = new Blob([veri], { type: "application/pdf" });
    veri = null;
    return blob;
  } finally { doc = null; }
}

export async function pdfIndir(ogeler, ayar, ctx) {
  const blob = await pdfOlustur(ogeler, ayar, ctx);
  indir(blob, `belge-${bugunDamga()}.pdf`);
  return { boyut: blob.size, adet: ogeler.length };
}

export async function gorselleriIndir(ogeler, ayar, ctx) {
  const f = await etkinFormat(ayar);
  let toplam = 0;
  for (let i = 0; i < ogeler.length; i += 1) {
    kontrol(ctx);
    ctx?.ilerle(i / ogeler.length, `Görsel ${i + 1}/${ogeler.length}…`);
    const { blob } = await ogeyiKodla(ogeler[i], ayar, f.mime);
    toplam += blob.size;
    indir(blob, `belge-${tamSayi(i + 1)}.${f.uzanti}`);
    await new Promise((c) => setTimeout(c, 450)); // art arda indirme engelini hafiflet
  }
  return { boyut: toplam, adet: ogeler.length, not: f.not };
}

export async function zipIndir(ogeler, ayar, ctx) {
  const JSZip = await kutuphaneYukle("jszip");
  const f = await etkinFormat(ayar);
  let zip = new JSZip();
  try {
    for (let i = 0; i < ogeler.length; i += 1) {
      kontrol(ctx);
      ctx?.ilerle((i / ogeler.length) * 0.9, `Sayfa ${i + 1}/${ogeler.length} işleniyor…`);
      const { blob } = await ogeyiKodla(ogeler[i], ayar, f.mime);
      zip.file(`belge-${tamSayi(i + 1)}.${f.uzanti}`, blob, { binary: true });
      await nefes();
    }
    ctx?.ilerle(0.92, "ZIP paketleniyor…");
    let paket = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: Math.min(9, Math.max(6, ayar.zipSeviye || 6)) }, streamFiles: true },
      (m) => ctx?.ilerle(0.9 + (m.percent / 100) * 0.1, "ZIP paketleniyor…"),
    );
    indir(paket, `belge-${bugunDamga()}.zip`);
    const boyut = paket.size;
    paket = null;
    return { boyut, adet: ogeler.length, not: f.not };
  } finally { zip = null; }
}
