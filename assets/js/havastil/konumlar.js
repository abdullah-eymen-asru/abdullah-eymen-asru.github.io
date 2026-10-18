/**
 * konumlar.js — Kayıtlı konumlar (cihazda) + son aramalar. Saf depo mantığı (DOM yok).
 * Konum nesnesi: { id, ad (yer adı: şehir/ilçe/mahalle — haber ve hava eşleşmesi bunu kullanır), etiket (kullanıcının koyduğu isim, ör. "Evim - Kadıköy"),
 *                  lat, lon, ikon, ulke, ulkeAd, ulkeAdEn, admin1, admin1En, adEn, ilce, mahalle, sokak, il, bid? }
 * v4: koordinatlar ARTIK YUVARLANMAZ (eski ≈110 m / 3 ondalık kuralı kaldırıldı; kullanıcı kendi isteğiyle kaydettiği noktada tam hassasiyet).
 *     Yalnızca kayan nokta gürültüsü için 6 ondalıkta (≈0,1 m) kırpılır. Eski kayıtlar (3 ondalık) olduğu gibi çalışır: kimlik biçimi aynıdır.
 */
export const IKONLAR = { ev: "🏠", is: "💼", okul: "🎓", aile: "👪", spor: "🏃", gezi: "🧭", diger: "📍" };
export const IKON_ADLARI = { ev: "Ev", is: "İş", okul: "Okul", aile: "Aile", spor: "Spor", gezi: "Gezi", diger: "Diğer" };
const LS = { liste: "hv_konumlar2", eski: "hv_konumlar", aktif: "hv_aktif2", son: "hv_son_arama" };
const OKU = (k, v) => { try { return JSON.parse(localStorage.getItem(k)) ?? v; } catch { return v; } };
const YAZ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* depo kapalı */ } };
/** Tam hassasiyet: 6 ondalık (≈ 0,1 m). Yuvarlama DEĞİL, yalnızca kayan nokta artığını temizler. */
export const duz = (x) => Math.round(Number(x) * 1e6) / 1e6;

export const konumKimligi = (k) => `${duz(k.lat)},${duz(k.lon)}`;
export const ayniKonum = (a, b) => a && b && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
/** Arayüzde gösterilen isim: kullanıcının etiketi, yoksa yer adı. */
export const gorunenAd = (k) => (k?.etiket || k?.ad || "Konum");

/** İstenmeyen alanları atıp güvenli nesne üretir. */
export function temizle(k) {
  const s = (x, n = 60) => (typeof x === "string" ? x.trim().slice(0, n) : undefined);
  const o = { id: konumKimligi(k), ad: s(k.ad, 40) || "Konum", lat: duz(k.lat), lon: duz(k.lon), ikon: IKONLAR[k.ikon] ? k.ikon : "diger" };
  for (const a of ["ulke", "ulkeAd", "ulkeAdEn", "admin1", "admin1En", "adEn", "ilce", "mahalle", "sokak", "il"]) if (s(k[a])) o[a] = s(k[a]);
  if (s(k.etiket, 40)) o.etiket = s(k.etiket, 40);
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
/**
 * Kayıt güncelle. alanlar: { etiket?, ad?, ikon?, lat?, lon?, ... }. Koordinat değişirse kimlik de yeni koordinattan türetilir
 * (çağıran, eski kimliği `id` parametresiyle verir; yeni kayıt listede aynı sırada kalır).
 */
export const guncelle = (liste, id, alanlar) => liste.map((x) => {
  if (x.id !== id) return x;
  const birlesik = { ...x, ...alanlar };
  if (alanlar.etiket === "") delete birlesik.etiket;
  const t = temizle(birlesik);
  return { ...birlesik, ...t, ...(birlesik.bid ? { bid: birlesik.bid } : {}) };
});
export const varsayilanYap = (liste, id) => { const k = liste.find((x) => x.id === id); return k ? [k, ...liste.filter((x) => x.id !== id)] : liste; };
export const kayitliMi = (liste, k) => liste.some((x) => x.id === konumKimligi(k) || (x.ad === k.ad && ayniKonum(x, k)));

/** Son aramalar (kaydedilmemiş; yalnızca cihazda, en çok 6) */
export const sonAramalar = () => OKU(LS.son, []).slice(0, 6);
export function sonAramaEkle(k) {
  const t = temizle(k);
  YAZ(LS.son, [t, ...sonAramalar().filter((x) => x.id !== t.id)].slice(0, 6));
}
export const sonAramalariTemizle = () => YAZ(LS.son, []);
