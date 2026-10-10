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

export const KUTUPHANELER = {
  jszip: {
    paket: "jszip", surum: "3.10.1", dosya: "dist/jszip.min.js", global: "JSZip", lisans: "MIT veya GPL-3.0",
    sri: "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG",
    amac: "ZIP okuma/yazma (EPUB, DOCX, çoklu çıktı paketi)",
  },
  docx: {
    paket: "docx", surum: "9.6.1", dosya: "dist/index.iife.js", global: "docx", lisans: "MIT",
    sri: "sha384-NFScaGYD8NnHsUV2z0M1gCuKoEsGy7LB1EuWKYFsmQbO4k23nzZzEHFySoCvt8Xn",
    amac: "Word (.docx) üretimi",
  },
  marked: {
    paket: "marked", surum: "18.0.2", dosya: "lib/marked.umd.js", global: "marked", lisans: "MIT",
    sri: "sha384-7AnLEKZ+m8uFTgZ3D3njjhz/8KRCyH9OpRs5gJwID3vGDxmSHXvmn/2LnegrLjuT",
    amac: "Markdown → HTML",
  },
  mammoth: {
    paket: "mammoth", surum: "1.8.0", dosya: "mammoth.browser.min.js", global: "mammoth", lisans: "BSD-2-Clause",
    sri: "sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y", amac: "Word (.docx) → HTML",
  },
  dompurify: {
    paket: "dompurify", surum: "3.2.6", dosya: "dist/purify.min.js", global: "DOMPurify", lisans: "Apache-2.0 veya MPL-2.0",
    sri: "sha384-JEyTNhjM6R1ElGoJns4U2Ln4ofPcqzSsynQkmEc/KGy6336qAZl70tDLufbkla+3", amac: "HTML temizleme (XSS koruması); yüklenemezse yerleşik katı temizleyici kullanılır",
  },
  pdfmake: {
    paket: "pdfmake", surum: "0.2.20", dosya: "build/pdfmake.min.js", global: "pdfMake", lisans: "MIT",
    sri: "sha384-G23ofMOEI98f9UnroUBjDi6Ll55Y5E6bOX4VAMJo0nIbuQRIxzn0g4athUOb58zs", amac: "PDF üretimi (Roboto gömülü: Türkçe/Latin-Ext/Kiril/Yunanca)",
    ek: ["build/vfs_fonts.js"],
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
      throw new Error(`${k.paket} ${k.surum} yüklenemedi (internet bağlantını kontrol et). ${sonHata?.message || ""}`.trim());
    })().catch((h) => { sozler.delete(ad); throw h; }));
  }
  return sozler.get(ad);
}

/** Rehber / arayüz için okunabilir liste. */
export const kutuphaneListesi = () =>
  Object.values(KUTUPHANELER).map((k) => ({ ad: k.paket, surum: k.surum, lisans: k.lisans, amac: k.amac, sri: !!k.sri }));
