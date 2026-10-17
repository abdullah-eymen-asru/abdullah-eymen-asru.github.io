/**
 * konumlar.js — Kayıtlı konumlar (cihazda) + son aramalar. Saf depo mantığı (DOM yok).
 * Konum nesnesi: { id, ad, lat, lon, ikon, ulke, ulkeAd, ulkeAdEn, admin1, admin1En, adEn, ilce, mahalle, sokak, il, bid? }
 * Koordinatlar kaydedilirken ≈110 m'ye (3 ondalık) yuvarlanır; ad+koordinat aynıysa tekrar eklenmez.
 */
export const IKONLAR = { ev: "🏠", is: "💼", okul: "🎓", aile: "👪", spor: "🏃", gezi: "🧭", diger: "📍" };
export const IKON_ADLARI = { ev: "Ev", is: "İş", okul: "Okul", aile: "Aile", spor: "Spor", gezi: "Gezi", diger: "Diğer" };
const LS = { liste: "hv_konumlar2", eski: "hv_konumlar", aktif: "hv_aktif2", son: "hv_son_arama" };
const OKU = (k, v) => { try { return JSON.parse(localStorage.getItem(k)) ?? v; } catch { return v; } };
const YAZ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* depo kapalı */ } };
const y3 = (x) => Math.round(Number(x) * 1000) / 1000;

export const konumKimligi = (k) => `${y3(k.lat).toFixed(3)},${y3(k.lon).toFixed(3)}`;
export const ayniKonum = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

/** İstenmeyen alanları atıp güvenli nesne üretir. */
export function temizle(k) {
  const s = (x, n = 60) => (typeof x === "string" ? x.slice(0, n) : undefined);
  const o = { id: konumKimligi(k), ad: s(k.ad, 40) || "Konum", lat: y3(k.lat), lon: y3(k.lon), ikon: IKONLAR[k.ikon] ? k.ikon : "diger" };
  for (const a of ["ulke", "ulkeAd", "ulkeAdEn", "admin1", "admin1En", "adEn", "ilce", "mahalle", "sokak", "il"]) if (s(k[a])) o[a] = s(k[a]);
  if (k.bid) o.bid = k.bid;
  return o;
}

export function listeyiOku() {
  let l = OKU(LS.liste, null);
  if (!l) {                                    // eski sürümden (hv_konumlar: {ad,lat,lon,il,bid}) taşı
    const eski = OKU(LS.eski, []);
    l = (Array.isArray(eski) ? eski : []).filter((k) => k && Number.isFinite(k.lat) && Number.isFinite(k.lon)).map(temizle);
    if (l.length) YAZ(LS.liste, l);
  }
  return l.filter((k) => k && Number.isFinite(k.lat) && Number.isFinite(k.lon)).slice(0, 20);
}
export const listeyiYaz = (l) => YAZ(LS.liste, l.slice(0, 20));
export const aktifOku = (varsayilan) => { const a = OKU(LS.aktif, null); return a && Number.isFinite(a.lat) ? a : varsayilan; };
export const aktifYaz = (k) => YAZ(LS.aktif, k);

export function ekle(liste, konum) {
  const k = temizle(konum);
  const i = liste.findIndex((x) => x.id === k.id || (x.ad === k.ad && ayniKonum(x, k)));
  if (i >= 0) { const g = [...liste]; g[i] = { ...g[i], ...k }; return g; }
  return liste.length >= 20 ? liste : [...liste, k];
}
export const sil = (liste, id) => liste.filter((x) => x.id !== id);
export const guncelle = (liste, id, alanlar) => liste.map((x) => (x.id === id ? { ...x, ...alanlar, ad: (alanlar.ad ?? x.ad).slice(0, 40) } : x));
export const varsayilanYap = (liste, id) => { const k = liste.find((x) => x.id === id); return k ? [k, ...liste.filter((x) => x.id !== id)] : liste; };
export const kayitliMi = (liste, k) => liste.some((x) => x.id === konumKimligi(k) || (x.ad === k.ad && ayniKonum(x, k)));

/** Son aramalar (kaydedilmemiş; yalnızca cihazda, en çok 6) */
export const sonAramalar = () => OKU(LS.son, []).slice(0, 6);
export function sonAramaEkle(k) {
  const t = temizle(k);
  YAZ(LS.son, [t, ...sonAramalar().filter((x) => x.id !== t.id)].slice(0, 6));
}
export const sonAramalariTemizle = () => YAZ(LS.son, []);
