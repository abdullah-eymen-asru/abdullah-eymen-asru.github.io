/**
 * iklim.js — Mevsimlik eğilim veri katmanı: Open-Meteo CLIMATE API (CMIP6 HighResMIP iklim modelleri, günlük, 1950–2050).
 * Neden: Open-Meteo deterministik saatlik tahmin en çok 16 gün verir. 16 günün ötesi için hava durumu DEĞİL, iklim eğilimi gösterilir:
 *   seçilen ayın modelce beklenen sıcaklık/yağışı, aynı ayın 1991–2020 mevsim normaline göre ne kadar sapıyor (anomali).
 * Yöntem: üç modelin günlük değerleri ortalanır → aylık ortalama sıcaklık (°C) ve aylık yağış toplamı (mm). Normal = 1991–2020 ortalaması.
 *   Eğilim = hedef yılın ±2 yıllık (5 yıllık) penceresinin ortalaması (tek bir yılın modelce rastgele dalgalanması gürültüdür).
 * GİZLİLİK: istek tarayıcıdan doğrudan Open-Meteo'ya gider (koordinat 2 ondalık ≈ 1 km'ye yuvarlanır; iklim ızgarası zaten kabadır). Yanıt AYLIK özet olarak
 *   14 gün localStorage'da önbelleklenir (ham günlük veri saklanmaz).
 */
import { jsonAl } from "./veri.js";

const IKLIM_URL = "https://climate-api.open-meteo.com/v1/climate";
export const IKLIM_MODELLERI = ["EC_Earth3P_HR", "MRI_AGCM3_2_S", "CMCC_CM2_VHR4"];
export const NORMAL_BASLANGIC = 1991, NORMAL_BITIS = 2020, SON_YIL = 2050;
const ONBELLEK = "hv_iklim1_", OMUR_MS = 14 * 24 * 3600 * 1000;
const k2 = (x) => Number(x).toFixed(2);

/** Günlük diziler → { "YYYY-M": { t: ortalama °C, y: toplam mm, n: gün } }. Saf fonksiyon (test edilebilir). */
export function aylikaIndir(yanit) {
  const D = yanit?.daily;
  if (!D?.time) throw new Error("Beklenmeyen iklim yanıtı");
  const anahtarlar = (ad) => Object.keys(D).filter((k) => k === ad || k.startsWith(`${ad}_`));
  const tk = anahtarlar("temperature_2m_mean"), yk = anahtarlar("precipitation_sum");
  if (!tk.length || !yk.length) throw new Error("İklim yanıtında sıcaklık/yağış yok");
  const ort = (keys, i) => { const v = keys.map((k) => D[k][i]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const aylar = {};
  D.time.forEach((tarih, i) => {
    const t = ort(tk, i), y = ort(yk, i);
    if (t == null) return;
    const a = `${Number(tarih.slice(0, 4))}-${Number(tarih.slice(5, 7))}`;
    const o = (aylar[a] ||= { ts: 0, ys: 0, n: 0 });
    o.ts += t; o.ys += y ?? 0; o.n += 1;
  });
  return Object.fromEntries(Object.entries(aylar).map(([a, o]) => [a, { t: Math.round((o.ts / o.n) * 100) / 100, y: Math.round(o.ys * 10) / 10, n: o.n }]));
}

export async function iklimGetir(lat, lon) {
  const anahtar = `${ONBELLEK}${k2(lat)}_${k2(lon)}`;
  try { const k = JSON.parse(localStorage.getItem(anahtar) || "null"); if (k && Date.now() - k.t < OMUR_MS) return { aylar: k.aylar, onbellek: true, modeller: IKLIM_MODELLERI.length }; } catch { /* depo kapalı */ }
  const url = `${IKLIM_URL}?latitude=${k2(lat)}&longitude=${k2(lon)}&start_date=${NORMAL_BASLANGIC}-01-01&end_date=${SON_YIL}-12-31&models=${IKLIM_MODELLERI.join(",")}&daily=temperature_2m_mean,precipitation_sum`;
  const aylar = aylikaIndir(await jsonAl(url, 25000));
  try { localStorage.setItem(anahtar, JSON.stringify({ t: Date.now(), aylar })); } catch { /* yok say */ }
  return { aylar, onbellek: false, modeller: IKLIM_MODELLERI.length };
}

const ortalama = (d) => (d.length ? d.reduce((a, b) => a + b, 0) / d.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** @param {object} aylar aylikaIndir çıktısı  @param {number} y hedef yıl  @param {number} m hedef ay (0–11) */
export function sapmaHesapla(aylar, y, m) {
  const ay = m + 1;
  const yillar = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const al = (yil) => aylar[`${yil}-${ay}`] || null;
  const normalSet = yillar(NORMAL_BASLANGIC, NORMAL_BITIS).map(al).filter(Boolean);
  if (normalSet.length < 20) throw new Error("Normal dönemi için yeterli veri yok");
  const normalSic = ortalama(normalSet.map((x) => x.t)), normalYagis = ortalama(normalSet.map((x) => x.y));
  const pencere = yillar(Math.max(NORMAL_BASLANGIC, y - 2), Math.min(SON_YIL, y + 2)).map(al).filter(Boolean);
  if (!pencere.length) throw new Error("Seçilen yıl için model verisi yok");
  const trendSic = ortalama(pencere.map((x) => x.t)), trendYagis = ortalama(pencere.map((x) => x.y));
  const tek = al(y);
  const seri = yillar(Math.max(NORMAL_BASLANGIC, y - 5), Math.min(SON_YIL, y + 5)).map((yil) => { const o = al(yil); return o ? { yil, sic: r1(o.t - normalSic), yagis: normalYagis > 0 ? Math.round(((o.y - normalYagis) / normalYagis) * 100) : null } : null; }).filter(Boolean);
  return {
    normalSic: r1(normalSic), normalYagis: Math.round(normalYagis), trendSic: r1(trendSic), trendYagis: Math.round(trendYagis),
    sicSapma: r1(trendSic - normalSic), yagisSapmaMm: Math.round(trendYagis - normalYagis), yagisSapmaYuzde: normalYagis > 0 ? Math.round(((trendYagis - normalYagis) / normalYagis) * 100) : null,
    tekYil: tek ? { sic: r1(tek.t), yagis: Math.round(tek.y) } : null, seri, pencereYil: pencere.length,
  };
}
