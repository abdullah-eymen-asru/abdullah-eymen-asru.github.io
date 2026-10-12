/*
 * assets/js/belge-tarayici/bellek-kalkani.js — Agresif bellek temizleme & "RAM Kalkanı".
 * -----------------------------------------------------------------------
 *  Onlarca yüksek çözünürlüklü sayfa işlenirken tarayıcının çökmemesi için TÜM geçici kaynaklar tek yerden yönetilir:
 *   - tuvalAl()/tuvalBirak() : her tuval kayıt defterine (donusturucu/bellek.js) girer; bırakılırken
 *                              clearRect + width=0/height=0 + referans null (Safari'de tuval belleğini bırakmanın yolu).
 *   - gecici()               : try/finally ile "aç → kullan → mutlaka bırak" kalıbı (hata olsa bile sızıntı olmaz).
 *   - nesneUrl()/urlBirak()  : URL.createObjectURL / revokeObjectURL (donusturucu/ortak.js kayıt defteri üzerinden).
 *   - bellekDurumu()         : arayüzdeki canlı sayaç (açık tuval, açık URL) — sızıntıyı gözle doğrulamak için.
 *  Not: JavaScript'te baytları "sıfırlamak" garanti edilemez; hedef, referansı hemen koparıp GC'ye bırakmaktır.
 * -----------------------------------------------------------------------
 */
import { urlOlustur, urlSerbest, aktifUrlSayisi, IOS_MU } from "../donusturucu/ortak.js";
import { tuvalKaydet, sifirla as bellekSifirla } from "../donusturucu/bellek.js";

const acikTuvaller = new Set();

/** iOS Safari tuval alanı ~16,7 MP ile sınırlıdır; masaüstünde güvenli üst sınır daha geniştir. */
export const MAKS_TUVAL_ALANI = () => (IOS_MU() ? 14_000_000 : 64_000_000);
/** Kaynak (decode) tuvalinin en uzun kenarı: perspektif örneklemesi için ImageData tutulur, bu yüzden sınırlıdır. */
export const KAYNAK_MAKS_KENAR = () => (IOS_MU() ? 3000 : 4096);

export function tuvalAl(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  acikTuvaller.add(c);
  tuvalKaydet(c);
  return c;
}

export function tuvalBirak(c) {
  if (!c) return null;
  try { const g = c.getContext?.("2d"); if (g) g.clearRect(0, 0, c.width, c.height); } catch { /* yok say */ }
  try { c.width = 0; c.height = 0; } catch { /* yok say */ }
  acikTuvaller.delete(c);
  return null;
}

/** Verilen tuvaller ile iş yapar; hata/iptal olsa bile hepsi bırakılır. fn(...tuvaller) */
export async function gecici(boyutlar, fn) {
  const tuvaller = boyutlar.map(([w, h]) => tuvalAl(w, h));
  try { return await fn(...tuvaller); } finally { for (const c of tuvaller) tuvalBirak(c); }
}

export const nesneUrl = (blob) => urlOlustur(blob);
export const urlBirak = (u) => urlSerbest(u);

export const bellekDurumu = () => ({ tuval: acikTuvaller.size, url: aktifUrlSayisi() });

/** Açık kalan her şeyi (tuval, URL, kayıtlı nesneler) serbest bırakır. */
export function hepsiniBirak() {
  for (const c of [...acikTuvaller]) tuvalBirak(c);
  bellekSifirla();
}

/** Alan sınırını aşan hedef boyutu orantılı küçültür. */
export function alanaSigdir(w, h) {
  const sinir = MAKS_TUVAL_ALANI();
  const alan = w * h;
  if (alan <= sinir) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), kuculdu: false };
  const k = Math.sqrt(sinir / alan);
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), kuculdu: true };
}
