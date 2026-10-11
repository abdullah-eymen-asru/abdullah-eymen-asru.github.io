/*
 * assets/js/donusturucu/bellek.js — Bellek hijyeni (ortak cihaz / hassas belge gizliliği).
 * -----------------------------------------------------------------------
 * Dosya verisi (File/Blob/ArrayBuffer/Uint8Array, PDFDocumentProxy, tuval, JSZip) yalnızca bu sekmenin belleğindedir;
 * ama kullanıcı başka menüye geçince ya da dönüştürücüyü kapatınca JS referansları ve DOM düğümleri yaşamaya devam edebilir.
 * Bu modül: (1) "kayıt defteri" tutar — açılan her şey buraya kaydolur, (2) güvenli sil: hepsini yok eder.
 *
 *  sifirla():  URL.revokeObjectURL → bırakılabilir nesneler (yokEt/destroy/close) → tuvaller clearRect + 0×0 →
 *              önizleme düğümleri DOM'dan söker → kayıtlı referansları null'lar. GC'ye bırakılır.
 *  Not: JavaScript'te baytları "sıfırlamak" garanti edilemez; hedef, referansı koparıp tuvalleri ve URL'leri hemen
 *  serbest bırakmaktır (tarayıcı GC'si zamanını kendi seçer). Sayfa yenilemesi en kesin temizliktir.
 * -----------------------------------------------------------------------
 */
import { tumUrlleriSerbestBirak } from "./ortak.js";

const birakilacaklar = new Set(); // { birak: fn } — yokEt / destroy / close
const tuvaller = new Set();
const dugumler = new Set();
let referanslar = {}; // ad -> değer (ArrayBuffer, Uint8Array, JSZip …)

export function kaydet(nesne, birak) {
  const k = { nesne, birak };
  birakilacaklar.add(k);
  return () => birakilacaklar.delete(k);
}
export const tuvalKaydet = (c) => { if (c) tuvaller.add(c); return c; };
export const dugumKaydet = (d) => { if (d) dugumler.add(d); return d; };
export function referansKoy(ad, deger) { referanslar[ad] = deger; return deger; }

function tuvalTemizle(c) {
  try { const g = c.getContext?.("2d"); if (g) g.clearRect(0, 0, c.width, c.height); } catch { /* yok say */ }
  try { c.width = 0; c.height = 0; } catch { /* yok say (Safari: tuval belleğini bırakmanın yolu) */ }
}

export function sifirla({ ekstraDugumler = [] } = {}) {
  for (const k of birakilacaklar) {
    try { const s = k.birak?.(k.nesne); if (s && typeof s.catch === "function") s.catch(() => {}); } catch { /* yok say */ }
    k.nesne = null;
  }
  birakilacaklar.clear();
  tumUrlleriSerbestBirak();
  for (const c of tuvaller) tuvalTemizle(c);
  tuvaller.clear();
  for (const d of [...dugumler, ...ekstraDugumler]) {
    try { d.querySelectorAll?.("canvas").forEach(tuvalTemizle); d.replaceChildren?.(); } catch { /* yok say */ }
  }
  dugumler.clear();
  for (const k of Object.keys(referanslar)) referanslar[k] = null;
  referanslar = {};
}
