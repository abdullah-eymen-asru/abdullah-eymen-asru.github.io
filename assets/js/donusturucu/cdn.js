/*
 * assets/js/donusturucu/cdn.js — Açık kaynak kütüphanelerin SÜRÜM SABİTLİ, tembel (lazy) yüklenmesi.
 * -----------------------------------------------------------------------
 *  GÜVENLİK
 *   - Her kütüphane TAM sürüme sabitlenir (aralık / "latest" YOK). Sürümler yayımlandıktan en az 2 hafta
 *     sonra seçildi (yeni yayımlanan paketlerdeki olası kötü amaçlı sürümlere karşı).
 *   - Önce jsDelivr, olmazsa unpkg (aynı npm paketi/aynı dosya yolu) denenir.
 *   - "sri" dolu olan kütüphaneler Subresource Integrity ile doğrulanır (bayt değişirse yüklenmez).
 *     Boş olanlar için hash üretimi: rehber/05-donusturucu.md § SRI.
 *   - Kullanıcının DOSYASI bu dosyadan asla ağa çıkmaz; yalnızca kütüphane kodu indirilir.
 *   - PDF.js + pdf-lib: mevcut Akademik Kütüphane yükleyicisi (assets/js/akademik/motor.js) yeniden kullanılır
 *     (bkz. pdf-yukle.js).
 * -----------------------------------------------------------------------
 */

import { hata as trHata } from "../core/hata-metni.js";
export const KUTUPHANELER = {
  jszip: {
    paket: "jszip", surum: "3.10.2", dosya: "dist/jszip.min.js", global: "JSZip", lisans: "MIT veya GPL-3.0",
    sri: "sha384-DdGlNq+wVXAn83gXqwyeFHB7iyXy6L0rLrNzgDmhKWPjiJLg9vj6qosYmZmkMfQ+",
    amac: "ZIP okuma/yazma (EPUB, DOCX, çoklu çıktı paketi)",
  },
  docx: {
    paket: "docx", surum: "9.15.1", dosya: "dist/index.iife.js", global: "docx", lisans: "MIT",
    sri: "sha384-ud8085E8t6iW4uUom5nN5cpzTZ4OdsNKB/AKWfOsI62tzsoV2X7r7/o4KWESO8rq",
    amac: "Word (.docx) üretimi",
  },
  marked: {
    paket: "marked", surum: "18.1.2", dosya: "lib/marked.umd.js", global: "marked", lisans: "MIT",
    sri: "sha384-nCN5FOaVTXXYilftBH/VQuC9ypBYOxrctAZn2x7ggYClXaporWSzM0y+ODhb8MTi",
    amac: "Markdown → HTML",
  },
  mammoth: {
    paket: "mammoth", surum: "1.13.0", dosya: "mammoth.browser.min.js", global: "mammoth", lisans: "BSD-2-Clause",
    sri: "sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO", amac: "Word (.docx) → HTML",
  },
  dompurify: {
    paket: "dompurify", surum: "3.4.17", dosya: "dist/purify.min.js", global: "DOMPurify", lisans: "Apache-2.0 veya MPL-2.0",
    sri: "sha384-P0JNneQf81HOl9VwNXK76cQ9VMD6Nfsnepxb0cCOg8+UzEdzgPHAPV4wVQrvYQSx", amac: "HTML temizleme (XSS koruması); yüklenemezse yerleşik katı temizleyici kullanılır",
  },
  pdfmake: {
    paket: "pdfmake", surum: "0.2.20", dosya: "build/pdfmake.min.js", global: "pdfMake", lisans: "MIT",
    sri: "sha384-G23ofMOEI98f9UnroUBjDi6Ll55Y5E6bOX4VAMJo0nIbuQRIxzn0g4athUOb58zs", amac: "PDF üretimi (Roboto gömülü: Türkçe/Latin-Ext/Kiril/Yunanca)",
    ek: ["build/vfs_fonts.js"],
  },
  utif: {
    paket: "utif", surum: "3.1.0", dosya: "UTIF.js", global: "UTIF", lisans: "MIT",
    sri: "sha384-RyBmXHdfZ/Uon+ud+/AqSyWpUWnKYt2tkRG/P4gWoRUGDU+qIAV3tGBPNlYTBZEF", amac: "TIFF çözme (Chrome/Firefox çözemez; Safari yerel çözer) — Belge Tarayıcı",
  },
  pako: {
    paket: "pako", surum: "2.1.0", dosya: "dist/pako.min.js", global: "pako", lisans: "MIT AND Zlib",
    sri: "sha384-rNlaE5fs9dGIjmxWDALQh/RBAaGRYT5ChrzHo6tRfgrZ36iRFAiquP5g41Jsv+0j", amac: "Deflate sıkıştırmalı TIFF'ler için (UTIF'in isteğe bağlı bağımlılığı)",
  },
  pptxgenjs: {
    paket: "pptxgenjs", surum: "4.0.1", dosya: "dist/pptxgen.bundle.js", global: "PptxGenJS", lisans: "MIT",
    sri: "sha384-qb0Xhi7LLYpvW1HCK6oMrmDLSY9sy7vwm6ZlV6KjtrlL9yg30+YN4neTwnmX+Kp8",
    amac: "PowerPoint (.pptx) üretimi — hiçbir şey sunucuya gitmez",
  },
  heic2any: {
    paket: "heic2any", surum: "0.0.4", dosya: "dist/heic2any.min.js", global: "heic2any", lisans: "MIT",
    sri: "sha384-OTofQ0MEeiSgh62havBcemCIK0gqj809wX6UA0uPISNMRnR6NZyCdGzX3SbLrgwL", amac: "HEIC/HEIF (iPhone) görsellerini çözme — WebAssembly gerektirir ('wasm-unsafe-eval')",
  },
};

const CDN_TABANLARI = [
  (p, s, d) => `https://cdn.jsdelivr.net/npm/${p}@${s}/${d}`,
  (p, s, d) => `https://unpkg.com/${p}@${s}/${d}`,
];

function scriptYukle(src, sri) {
  return new Promise((coz, red) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    if (sri) { s.integrity = sri; s.crossOrigin = "anonymous"; }
    s.referrerPolicy = "no-referrer";
    s.onload = () => { s.remove(); coz(); };
    s.onerror = () => { s.remove(); red(new Error(`Yüklenemedi: ${src}`)); };
    document.head.append(s);
  });
}

const sozler = new Map();
// Test/özel dağıtım için: globalThis.__DN_CDN__ = (paket, surum, dosya) => url
const cdnTabanlari = () => (globalThis.__DN_CDN__ ? [globalThis.__DN_CDN__, ...CDN_TABANLARI] : CDN_TABANLARI);

export function kutuphaneYukle(ad) {
  const k = KUTUPHANELER[ad];
  if (!k) return Promise.reject(new Error(`Bilinmeyen kütüphane: ${ad}`));
  if (globalThis[k.global] && (ad !== "pdfmake" || globalThis.pdfMake?.vfs)) return Promise.resolve(globalThis[k.global]);
  if (!sozler.has(ad)) {
    sozler.set(ad, (async () => {
      let sonHata;
      for (const taban of cdnTabanlari()) {
        try {
          await scriptYukle(taban(k.paket, k.surum, k.dosya), k.sri);
          for (const ek of k.ek || []) await scriptYukle(taban(k.paket, k.surum, ek), null);
          if (!globalThis[k.global]) throw new Error(`${k.paket}: beklenen genel nesne (${k.global}) bulunamadı.`);
          return globalThis[k.global];
        } catch (h) { sonHata = h; }
      }
      throw new Error(`${k.paket} ${k.surum} yüklenemedi (internet bağlantını kontrol et). ${trHata(sonHata, "")}`.trim());
    })().catch((h) => { sozler.delete(ad); throw h; }));
  }
  return sozler.get(ad);
}

/** Rehber / arayüz için okunabilir liste. */
export const kutuphaneListesi = () =>
  Object.values(KUTUPHANELER).map((k) => ({ ad: k.paket, surum: k.surum, lisans: k.lisans, amac: k.amac, sri: !!k.sri }));
