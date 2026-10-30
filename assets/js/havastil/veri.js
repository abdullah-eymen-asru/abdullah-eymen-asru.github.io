/**
 * veri.js — HavaStil veri katmanı: Open-Meteo (hava + hava kalitesi + coklu model), Open-Meteo Geocoding, Nominatim (yalnız açık istekle).
 * -----------------------------------------------------------------------------------------------------------------
 * GİZLİLİK: hava istekleri TARAYICIDAN doğrudan Open-Meteo'ya gider; koordinat site sunucusuna/Supabase'e/Worker'a GÖNDERİLMEZ.
 * v3: saatlik rain/showers/cape (yağış fiziği motoru, yagis-fizigi.js) ve yüzey ozonu eklendi.
 * v5: 16 günlük (Open-Meteo deterministik sınırı) saatlik tahmin; kar/don/buzlanma için freezing_level_height, soil_temperature_0cm, snow_depth, snowfall_sum eklendi;
 *     arama tek kaynaklı (tek dil), iptal edilebilir ve önbellekli.
 * v4: 14 günlük tahmin (saatlik plan sekmesi), ham değer konsolu + ECMWF/ICON/GFS model dizileri (Veri doğrulama sekmesi), rakım,
 *     ~110 m yuvarlama KALDIRILDI (tam hassasiyet), küresel adres araması (Nominatim yapılandırılı/serbest + Photon yedeği); önbellek öneki hv_hava5_.
 * KOTA: Open-Meteo sınırı IP başınadır (kullanıcının kendi IP'si). Yanıtlar 30 dk localStorage'da önbelleklenir; çevrimdışıyken
 * son bilinen veri "eski" etiketiyle gösterilir. Nominatim politikası gereği otomatik tamamlama YAPILMAZ (yalnız kullanıcı isterse, 1 sn aralıkla).
 */
import { omOmMi, omJson } from "./openmeteo.js";
const HAVA_URL = "https://api.open-meteo.com/v1/forecast";
const HAVA_KALITESI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MODELLER = "ecmwf_ifs025,icon_seamless,gfs_seamless";
const ONBELLEK_OMRU_MS = 30 * 60 * 1000;
const ONBELLEK_ONEKI = "hv_hava6_";          // v6: 16 gün, kar/don/buzlanma alanları (v5: 14 gün, ham konsol, model dizileri)
export const GUN_SAYISI = 16;                 // Open-Meteo deterministik tahmin üst sınırı (forecast_days=16)
const nokta = (x) => Number(x).toFixed(4);   // koordinat YUVARLANMAZ (kullanıcı izniyle tam hassasiyet); yalnızca önbellek anahtarı 4 ondalık

const yuv = (x) => Math.round(x);
const sayi = (x, v = 0) => (Number.isFinite(x) ? x : v);
const enBuyuk = (d, v = 0) => { const a = d.filter(Number.isFinite); return a.length ? Math.max(...a) : v; };

export async function jsonAl(url, zamanAsimiMs = 9000, disSinyal = null) {
  // Open-Meteo hava/arşiv/hava kalitesi/iklim istekleri: kota + API anahtarı kaynağı (openmeteo.js). Diğer adresler (Nominatim, Photon, geocoding) eskisi gibi.
  if (omOmMi(url)) return omJson(url, { sinyal: disSinyal, zamanAsimiMs });
  const kontrol = new AbortController();
  const z = setTimeout(() => kontrol.abort(), zamanAsimiMs);
  if (disSinyal) { if (disSinyal.aborted) kontrol.abort(); else disSinyal.addEventListener("abort", () => kontrol.abort(), { once: true }); }
  try {
    const r = await fetch(url, { signal: kontrol.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(z); }
}

/** Yerel (konumun saat dilimindeki) "YYYY-MM-DD" üzerine gün ekler; saat dilimi kayması olmasın diye UTC aritmetiği. */
function gunEkle(tarih, n) {
  const [y, a, g] = tarih.split("-").map(Number);
  return new Date(Date.UTC(y, a - 1, g + n)).toISOString().slice(0, 10);
}

/** Hava + (başarısızsa sessiz geçen) çoklu model yağış kontrolü + hava kalitesi → motorun beklediği özet. */
export async function havaGetir(lat, lon, { yenile = false } = {}) {
  const anahtar = `${ONBELLEK_ONEKI}${nokta(lat)}_${nokta(lon)}`;
  try {
    const k = JSON.parse(localStorage.getItem(anahtar) || "null");
    if (!yenile && k && Date.now() - k.t < ONBELLEK_OMRU_MS) return { ...k.veri, alinma: k.t, eski: false, onbellek: true };
  } catch { /* depo kapalı/bozuk */ }

  const temel = `${HAVA_URL}?latitude=${lat}&longitude=${lon}&timezone=auto`;
  try {
    const [ana, modeller, hk, dk] = await Promise.all([
      jsonAl(`${temel}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,relative_humidity_2m,dew_point_2m,pressure_msl,cloud_cover,is_day`
        + `&hourly=temperature_2m,apparent_temperature,weather_code,precipitation_probability,precipitation,snowfall,uv_index,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,pressure_msl,visibility,cloud_cover,shortwave_radiation,is_day,rain,showers,cape,freezing_level_height,soil_temperature_0cm,snow_depth`
        + `&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,uv_index_max,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max`
        + `&past_days=1&forecast_days=${GUN_SAYISI}`),
      jsonAl(`${temel}&hourly=precipitation&models=${MODELLER}&forecast_days=${GUN_SAYISI}`, 7000).catch(() => null),   // fail-soft: tek model
      jsonAl(`${HAVA_KALITESI_URL}?latitude=${lat}&longitude=${lon}&timezone=auto&current=european_aqi,pm10,pm2_5,dust,ozone&hourly=dust,pm10&forecast_days=2`, 6000).catch(() => null),
      jsonAl(`${temel}&minutely_15=precipitation&forecast_minutely_15=12`, 5000).catch(() => null),             // 15 dk'lık yağış (bölgeye göre; yoksa null)
    ]);
    const veri = ozetle(ana, modeller, hk, dk);
    veri.kaynakUrl = `${temel}&forecast_days=${GUN_SAYISI}`;
    const t0 = Date.now();
    try { localStorage.setItem(anahtar, JSON.stringify({ t: t0, veri })); } catch { /* yok say */ }
    return { ...veri, alinma: t0, eski: false, onbellek: false };
  } catch (h) {
    try {
      const k = JSON.parse(localStorage.getItem(anahtar) || "null");
      if (k) return { ...k.veri, alinma: k.t, eski: true, onbellek: true };
    } catch { /* yok say */ }
    throw h;
  }
}

/** Kayıtlı bir konumun önbellekteki son sıcaklığı (konum kartları için; ağ yok). */
export function sonSicaklik(lat, lon) {
  try { const k = JSON.parse(localStorage.getItem(`${ONBELLEK_ONEKI}${nokta(lat)}_${nokta(lon)}`) || "null"); return k?.veri ? { app: k.veri.apparent, t: k.t } : null; } catch { return null; }
}

/** Open-Meteo yanıtlarını (saat dilimi = konumun saat dilimi) motor girdisine çevirir. Saf fonksiyon (test edilebilir). */
export function ozetle(ana, modeller, hk, dk) {
  const v = ozetleAsil(ana, modeller, hk, dk);
  uyumEkle(v, modeller, ana);
  return v;
}

/**
 * Model uyumu (0..1): aynı saat için yağış (≥ 0,1 mm) gören model oranı. PoP = Güven × Kapsam ayrıştırmasında "Güven" olarak kullanılır.
 * Kaynaklar: Open-Meteo ana tahmin + ECMWF / ICON / GFS saatlik yağışı. 2'den az kaynak varsa null (ayrıştırma yapılmaz).
 * Ayrıca bugünden itibaren TÜM saatler (tumSaatler, ≈ 10 gün) Derin analiz'in gün seçicisi için eklenir.
 */
function uyumEkle(v, modeller, ana) {
  const H = ana.hourly;
  const kaynaklar = [new Map(H.time.map((t, k) => [t, H.precipitation?.[k]]))];
  const MH = modeller?.hourly;
  if (MH?.time) for (const a of Object.keys(MH).filter((x) => x.startsWith("precipitation_"))) kaynaklar.push(new Map(MH.time.map((t, k) => [t, MH[a][k]])));
  const uyum = (t) => {
    const d = kaynaklar.map((m) => m.get(t)).filter(Number.isFinite);
    return d.length >= 2 ? Math.round((d.filter((x) => x >= 0.1).length / d.length) * 100) / 100 : null;
  };
  const ekle = (x) => { x.uyum = uyum(x.t); return x; };
  v.saatListe?.forEach(ekle);
  v.yagisPencere?.forEach(ekle);
  const bugun = (ana.current?.time || H.time[0]).slice(0, 10);
  v.tumSaatler = H.time.map((t, k) => (t.slice(0, 10) >= bugun ? ekle(saatOge(H, k)) : null)).filter(Boolean);
  v.modelKaynakSayisi = kaynaklar.length;
  v.rakim = Number.isFinite(ana.elevation) ? Math.round(ana.elevation) : null;   // sıfır izotermi ↔ konum rakımı karşılaştırması (yagis-fizigi.js)
  // Şeffaflık (Veri doğrulama sekmesi): her modelin ham saatlik yağış dizisi (mm). Open-Meteo modellere ayrı PoP VERMEZ; yalnızca miktar.
  v.modelZaman = MH?.time || [];
  v.modelDizi = {};
  if (MH?.time) for (const a of Object.keys(MH).filter((x) => x.startsWith("precipitation_"))) v.modelDizi[a.replace("precipitation_", "")] = MH[a].map((x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null));
  const c = ana.current || {}, cu = ana.current_units || {};
  const ik = H.time.findIndex((t) => t.startsWith((c.time || "").slice(0, 13)));
  v.ham = {
    alinan: c.time || null, rakim: Number.isFinite(ana.elevation) ? Math.round(ana.elevation) : null, tz: ana.timezone || null, tzKisa: ana.timezone_abbreviation || null,
    enlem: ana.latitude ?? null, boylam: ana.longitude ?? null,
    simdi: [
      ["Ölçülen sıcaklık (temperature_2m)", c.temperature_2m, cu.temperature_2m], ["Hissedilen (apparent_temperature)", c.apparent_temperature, cu.apparent_temperature],
      ["Rüzgâr hızı (wind_speed_10m)", c.wind_speed_10m, cu.wind_speed_10m], ["Rüzgâr hamlesi (wind_gusts_10m)", c.wind_gusts_10m, cu.wind_gusts_10m], ["Rüzgâr yönü (wind_direction_10m)", c.wind_direction_10m, cu.wind_direction_10m],
      ["UV indeksi (uv_index, bu saat)", ik >= 0 ? H.uv_index?.[ik] : null, ana.hourly_units?.uv_index || ""], ["Bağıl nem (relative_humidity_2m)", c.relative_humidity_2m, cu.relative_humidity_2m],
      ["Çiğ noktası (dew_point_2m)", c.dew_point_2m, cu.dew_point_2m], ["Basınç (pressure_msl)", c.pressure_msl, cu.pressure_msl], ["Bulut örtüsü (cloud_cover)", c.cloud_cover, cu.cloud_cover],
      ["Yağış (precipitation, son saat)", c.precipitation, cu.precipitation], ["Hava kodu (weather_code, WMO)", c.weather_code, cu.weather_code],
      ["Sıfır izotermi yüksekliği (freezing_level_height, bu saat)", ik >= 0 ? H.freezing_level_height?.[ik] : null, ana.hourly_units?.freezing_level_height || "m"],
      ["Zemin yüzey sıcaklığı (soil_temperature_0cm, bu saat)", ik >= 0 ? H.soil_temperature_0cm?.[ik] : null, ana.hourly_units?.soil_temperature_0cm || "°C"],
      ["Kar yağışı (snowfall, bu saat · modelin kendi dönüşümü)", ik >= 0 ? H.snowfall?.[ik] : null, ana.hourly_units?.snowfall || "cm"],
      ["Yerdeki kar kalınlığı (snow_depth, bu saat)", ik >= 0 ? H.snow_depth?.[ik] : null, ana.hourly_units?.snow_depth || "m"],
    ],
  };
}

function ozetleAsil(ana, modeller, hk, dk) {
  const c = ana.current, H = ana.hourly;
  const simdiSaat = c.time.slice(0, 13);
  let i = H.time.findIndex((t) => t.startsWith(simdiSaat));
  if (i < 0) i = Math.min(24, H.time.length - 1);
  const bugun = c.time.slice(0, 10);
  const saat = Number(c.time.slice(11, 13));

  // Pencere: bugün şimdiden 22:00'ye (en erken 07:00); akşam geç ise YARIN 07–22.
  let gun = bugun, gunEtiketi = "bugün", bas = Math.max(saat, 7);
  if (saat >= 21) { gun = gunEkle(bugun, 1); gunEtiketi = "yarın"; bas = 7; }
  const pencere = [];
  H.time.forEach((t, k) => { if (t.startsWith(gun)) { const s = Number(t.slice(11, 13)); if (s >= bas && s <= 22) pencere.push(k); } });
  if (!pencere.length) pencere.push(i);
  const al = (dizi) => pencere.map((k) => dizi?.[k]).filter(Number.isFinite);
  const app = al(H.apparent_temperature), ham = al(H.temperature_2m);
  const minApp = Math.min(...app), maxApp = Math.max(...app);

  let recentPrecip = 0;
  for (let k = Math.max(0, i - 6); k < i; k++) recentPrecip += sayi(H.precipitation[k]);
  const dun = i - 24 >= 0 ? H.apparent_temperature[i - 24] : null;
  const yesterdayDiff = Number.isFinite(dun) ? yuv(c.apparent_temperature) - yuv(dun) : null;

  // Olasılıksal risk-averse kural: modellerden BİRİ bile pencerede yağış veriyorsa koruyucu önlem
  const rainProbBase = enBuyuk(al(H.precipitation_probability));
  let modelSayisi = 0, yagisVerenModel = 0;
  if (modeller?.hourly?.time) {
    const MH = modeller.hourly;
    const idx = MH.time.map((t, k) => (t.startsWith(gun) && Number(t.slice(11, 13)) >= bas && Number(t.slice(11, 13)) <= 22 ? k : -1)).filter((k) => k >= 0);
    for (const anah of Object.keys(MH).filter((a) => a.startsWith("precipitation_"))) {
      const d = idx.map((k) => MH[anah][k]).filter(Number.isFinite);
      if (!d.length) continue;
      modelSayisi += 1;
      if (d.reduce((a, b) => a + b, 0) >= 0.5 || Math.max(...d) >= 0.3) yagisVerenModel += 1;
    }
  }
  const anaYagis = al(H.precipitation).reduce((a, b) => a + b, 0) >= 0.5;
  if (anaYagis) yagisVerenModel += 1;
  modelSayisi += 1;
  let rainProb = rainProbBase;
  if (yagisVerenModel >= 2) rainProb = Math.max(rainProb, 60);
  else if (yagisVerenModel === 1) rainProb = Math.max(rainProb, 40);
  const modelFarki = yagisVerenModel > 0 && yagisVerenModel < modelSayisi;

  // Hava kalitesi (yoksa null): pencere içindeki en yüksek toz/PM10 + anlık Avrupa AQI
  let kalite = null;
  if (hk?.current) {
    const ph = hk.hourly;
    const idxK = ph?.time ? ph.time.map((t, k) => (t.startsWith(gun) && Number(t.slice(11, 13)) >= bas && Number(t.slice(11, 13)) <= 22 ? k : -1)).filter((k) => k >= 0) : [];
    kalite = {
      aqi: yuv(sayi(hk.current.european_aqi)), pm10: yuv(Math.max(sayi(hk.current.pm10), enBuyuk(idxK.map((k) => ph.pm10?.[k])))),
      pm25: yuv(sayi(hk.current.pm2_5)), ozon: yuv(sayi(hk.current.ozone)), dust: yuv(Math.max(sayi(hk.current.dust), enBuyuk(idxK.map((k) => ph.dust?.[k])))),
    };
  }

  // Zaman dilimleri (sabah 08 / öğle 13 / akşam 19) + saatlik mini grafik verisi
  const gunIdx = (s) => H.time.findIndex((t) => t === `${gun}T${String(s).padStart(2, "0")}:00`);
  const segmentler = [];
  if (gun === bugun) segmentler.push({ ad: "Şimdi", saat, app: yuv(c.apparent_temperature), raw: yuv(c.temperature_2m), rain: yuv(H.precipitation_probability?.[i] ?? 0), wind: yuv(c.wind_speed_10m), precip: sayi(H.precipitation?.[i]) });
  for (const [ad, s] of [["Sabah", 8], ["Öğle", 13], ["Akşam", 19]]) {
    if (gun === bugun && s <= saat) continue;
    const k = gunIdx(s);
    if (k < 0) continue;
    segmentler.push({ ad, saat: s, app: yuv(H.apparent_temperature[k]), raw: yuv(H.temperature_2m[k]), rain: yuv(H.precipitation_probability?.[k] ?? 0), wind: yuv(H.wind_speed_10m?.[k] ?? 0), precip: sayi(H.precipitation?.[k]), hum: yuv(H.relative_humidity_2m?.[k] ?? 60) });
  }
  const saatlik = pencere.map((k) => ({ saat: Number(H.time[k].slice(11, 13)), app: yuv(H.apparent_temperature[k]), rain: yuv(H.precipitation_probability?.[k] ?? 0), precip: sayi(H.precipitation?.[k]) }));

  return {
    apparent: yuv(c.apparent_temperature), raw: yuv(c.temperature_2m),
    wind: yuv(c.wind_speed_10m), gust: yuv(Math.max(sayi(c.wind_gusts_10m), enBuyuk(al(H.wind_gusts_10m)))), windMax: yuv(enBuyuk(al(H.wind_speed_10m))),
    hum: yuv(sayi(c.relative_humidity_2m, 60)), cloud: yuv(sayi(c.cloud_cover, 50)), isDay: c.is_day !== 0,
    rad: yuv(enBuyuk(al(H.shortwave_radiation))), uv: yuv(enBuyuk(al(H.uv_index))),
    precip: Math.round(enBuyuk(al(H.precipitation)) * 10) / 10, snow: Math.round(al(H.snowfall).reduce((a, b) => a + b, 0) * 10) / 10,
    rainProb: yuv(rainProb), rainProbBase: yuv(rainProbBase), modelFarki, modelSayisi, yagisVerenModel,
    delta: yuv(maxApp - minApp), minApp: yuv(minApp), maxApp: yuv(maxApp), minRaw: yuv(Math.min(...ham, c.temperature_2m)), maxRaw: yuv(Math.max(...ham, c.temperature_2m)),
    recentPrecip: Math.round(recentPrecip * 10) / 10, yesterdayDiff, saat, gun: gunEtiketi, guncelleme: c.time,
    kalite, aqi: kalite?.aqi ?? null, dust: kalite?.dust ?? null, pm10: kalite?.pm10 ?? null,
    segmentler, saatlik, tz: ana.timezone || "Europe/Istanbul",
    yagisPencere: pencere.map((k) => saatOge(H, k)), pencereGun: gun,
    ...genisVeri(ana, i, saat, bugun, dk),
  };
}

/** Saatlik dizinin k. elemanı → motorun/arayüzün ortak saat nesnesi (yagis-fizigi.js bu alanları okur). */
const sayiN = (x) => (Number.isFinite(x) ? x : null);
function saatOge(H, k) {
  let onceSivi = 0, onceKar = 0;
  for (let j = Math.max(0, k - 3); j < k; j++) { onceSivi += sayi(H.rain?.[j]) + sayi(H.showers?.[j]); onceKar += sayi(H.snowfall?.[j]); }
  return {
    t: H.time[k], saat: Number(H.time[k].slice(11, 13)), temp: yuv(H.temperature_2m[k]), app: yuv(H.apparent_temperature[k]), kod: H.weather_code?.[k] ?? 0,
    yagisOlasi: yuv(sayi(H.precipitation_probability?.[k])), yagis: sayi(H.precipitation?.[k]), yagmur: sayi(H.rain?.[k]), saganak: sayi(H.showers?.[k]), kar: sayi(H.snowfall?.[k]),
    cape: yuv(sayi(H.cape?.[k])),
    ruzgar: yuv(sayi(H.wind_speed_10m?.[k])), hamle: yuv(sayi(H.wind_gusts_10m?.[k])), yon: yuv(sayi(H.wind_direction_10m?.[k])),
    nem: yuv(sayi(H.relative_humidity_2m?.[k])), bulut: yuv(sayi(H.cloud_cover?.[k])), uv: Math.round(sayi(H.uv_index?.[k]) * 10) / 10, gunduz: H.is_day?.[k] !== 0,
    cig: yuv(sayi(H.dew_point_2m?.[k])), basinc: yuv(sayi(H.pressure_msl?.[k])),
    // v5 kar/don/buzlanma: sıfır izotermi (m), zemin yüzey sıcaklığı (°C; yoksa null), yerdeki kar (cm), önceki 3 saatin sıvı yağışı (mm) ve kar yağışı (cm)
    donma: sayiN(H.freezing_level_height?.[k]) == null ? null : Math.round(H.freezing_level_height[k]),
    yuzey: sayiN(H.soil_temperature_0cm?.[k]) == null ? null : Math.round(H.soil_temperature_0cm[k] * 10) / 10,
    karDerinlik: sayiN(H.snow_depth?.[k]) == null ? null : Math.round(H.snow_depth[k] * 1000) / 10,
    onceSivi: Math.round(onceSivi * 10) / 10, onceKar: Math.round(onceKar * 10) / 10,
  };
}

/** MGM/Apple/Google tarzı geniş veri: şu anki detaylar, 48 saatlik liste, 10 günlük, 15 dakikalık yağış, güneş. */
function genisVeri(ana, i, saat, bugun, dk) {
  const c = ana.current, H = ana.hourly, D = ana.daily || {};
  const saatListe = [];
  for (let k = i; k < Math.min(H.time.length, i + 49); k++) saatListe.push(saatOge(H, k));
  const gunluk = (D.time || []).map((t, k) => ({
    tarih: t, kod: D.weather_code?.[k] ?? 0, max: yuv(D.temperature_2m_max[k]), min: yuv(D.temperature_2m_min[k]),
    appMax: yuv(D.apparent_temperature_max?.[k] ?? D.temperature_2m_max[k]), appMin: yuv(D.apparent_temperature_min?.[k] ?? D.temperature_2m_min[k]),
    dogus: D.sunrise?.[k] || "", batis: D.sunset?.[k] || "", gunUzunlugu: sayi(D.daylight_duration?.[k]),
    uv: Math.round(sayi(D.uv_index_max?.[k]) * 10) / 10, yagisToplam: Math.round(sayi(D.precipitation_sum?.[k]) * 10) / 10, karToplam: Math.round(sayi(D.snowfall_sum?.[k]) * 10) / 10, yagisOlasi: yuv(sayi(D.precipitation_probability_max?.[k])),
    ruzgar: yuv(sayi(D.wind_speed_10m_max?.[k])), hamle: yuv(sayi(D.wind_gusts_10m_max?.[k])),
  })).filter((g) => g.tarih >= bugun);
  // Basınç eğilimi (son 3 saat)
  const basinc = c.pressure_msl, p3 = i >= 3 ? H.pressure_msl?.[i - 3] : null, p12 = i >= 12 ? H.pressure_msl?.[i - 12] : null;
  const basincFark3 = Number.isFinite(p3) && Number.isFinite(basinc) ? Math.round((basinc - p3) * 10) / 10 : null;
  const basincFark12 = Number.isFinite(p12) && Number.isFinite(basinc) ? Math.round((basinc - p12) * 10) / 10 : null;
  const basincEgilim = Number.isFinite(p3) && Number.isFinite(basinc) ? (basinc - p3 > 1 ? "yükseliyor" : basinc - p3 < -1 ? "düşüyor" : "sabit") : "—";
  const gorus = H.visibility?.[i];
  const dakikalik = dk?.minutely_15?.time ? dk.minutely_15.time.map((t, k) => ({ t, mm: sayi(dk.minutely_15.precipitation?.[k]) })).filter((x) => x.t >= c.time.slice(0, 16)).slice(0, 8) : null;
  return {
    kod: c.weather_code ?? 0, ruzgarYon: yuv(sayi(c.wind_direction_10m)), cigNoktasi: yuv(sayi(c.dew_point_2m)), basinc: yuv(sayi(basinc)), basincEgilim, basincFark3, basincFark12,
    gorus: Number.isFinite(gorus) ? yuv(gorus) : null, saatListe, gunluk, dakikalik, bugunDogus: gunluk[0]?.dogus || "", bugunBatis: gunluk[0]?.batis || "",
  };
}

/* ------------------------------ konum arama ------------------------------ */
const ayrintiMetni = (r) => [r.admin2, r.admin1, r.country].filter((x, k, a) => x && a.indexOf(x) === k && x !== r.name).join(", ");

/**
 * Canlı öneri (Open-Meteo Geocoding): şehir/ilçe/semt — dünya geneli. v5: TEK kaynak, TEK istek (Türkçe adlar), önceki istek iptal edilebilir (sinyal),
 * aynı sorgu 2 dk önbellekten gelir. Eski sürümde her tuşta TR + EN iki istek gidiyordu; İngilizce ad artık yalnızca konum SEÇİLİNCE (yurt dışı haber
 * araması için) ve yalnızca gerekirse tek bir `get?id=` isteğiyle tamamlanır (adEnTamamla).
 */
const aramaOnbellek = new Map();
const aramaSonucu = (r) => ({
  id: `om${r.id}`, omId: r.id, ad: r.name, adEn: r.name, ayrinti: ayrintiMetni(r), lat: r.latitude, lon: r.longitude,
  ulke: r.country_code || "", ulkeAd: r.country || "", ulkeAdEn: r.country || "", admin1: r.admin1 || "", admin1En: r.admin1 || "", admin2: r.admin2 || "", nufus: r.population || 0,
});
export async function yerAra(q, { sinyal = null } = {}) {
  const anahtar = String(q).trim().toLocaleLowerCase("tr");
  const o = aramaOnbellek.get(anahtar);
  if (o && Date.now() - o.t < 120000) return o.liste;
  const j = await jsonAl(`${GEO_URL}?name=${encodeURIComponent(q)}&count=10&language=tr&format=json`, 6000, sinyal);
  // Türkiye öncelikli, sonra nüfus
  const liste = (j.results || []).map(aramaSonucu).sort((a, b) => (b.ulke === "TR") - (a.ulke === "TR") || b.nufus - a.nufus);
  if (aramaOnbellek.size > 60) aramaOnbellek.clear();
  aramaOnbellek.set(anahtar, { t: Date.now(), liste });
  return liste;
}
/** Seçilen YURT DIŞI konumun İngilizce adlarını (haber araması için) tek istekle tamamlar; başarısızsa mevcut adla devam edilir. */
export async function adEnTamamla(k) {
  if (!k || k.ulke === "TR" || !k.omId) return k;
  try {
    const j = await jsonAl(`https://geocoding-api.open-meteo.com/v1/get?id=${encodeURIComponent(k.omId)}&language=en&format=json`, 4000);
    const r = j?.results?.[0] || j;
    if (r?.name) return { ...k, adEn: r.name, ulkeAdEn: r.country || k.ulkeAdEn, admin1En: r.admin1 || k.admin1En };
  } catch { /* İngilizce ad olmadan da çalışır */ }
  return k;
}

let sonNominatim = 0;
const PHOTON_URL = "https://photon.komoot.io/api/";
const nomSonucu = (r, q) => {
  const a = r.address || {};
  const sehir = a.city || a.town || a.village || a.municipality || a.county || "";
  return {
    id: `osm${r.osm_type || ""}${r.osm_id}`, ad: (r.name || a.road || r.display_name.split(",")[0] || q).slice(0, 60), adEn: sehir, ayrinti: r.display_name.split(",").slice(1, 5).join(",").trim(),
    lat: Number(r.lat), lon: Number(r.lon), ulke: (a.country_code || "").toUpperCase(), ulkeAd: a.country || "", ulkeAdEn: a.country || "", admin1: a.state || a.province || "", admin1En: a.state || "", admin2: a.county || a.city_district || a.district || sehir || "",
    mahalle: a.suburb || a.neighbourhood || a.quarter || a.city_district || "", sokak: a.road || "", nufus: 0, kaynak: "OpenStreetMap",
  };
};
const photonSonucu = (f, q) => {
  const p = f.properties || {}, [lon, lat] = f.geometry?.coordinates || [];
  const sehir = p.city || p.town || p.village || p.county || "";
  return {
    id: `ph${p.osm_type || ""}${p.osm_id}`, ad: (p.name || p.street || q).slice(0, 60), adEn: sehir, ayrinti: [p.street, p.district, sehir, p.state, p.country].filter((x, i, arr) => x && arr.indexOf(x) === i && x !== p.name).join(", "),
    lat: Number(lat), lon: Number(lon), ulke: (p.countrycode || "").toUpperCase(), ulkeAd: p.country || "", ulkeAdEn: p.country || "", admin1: p.state || "", admin1En: p.state || "", admin2: p.county || p.district || sehir || "",
    mahalle: p.district || p.locality || "", sokak: p.street || "", nufus: 0, kaynak: "Photon (OSM)",
  };
};

/**
 * Küresel adres/sokak/mahalle araması. SERBEST METİN ("Esatpaşa Mahallesi, Ataşehir", "Times Square, New York") ya da
 * HİYERARŞİK alanlar ({ ulke, sehir, ilce, mahalle }) — hiyerarşik alanlar en özelden genele doğru birleştirilip aynı arama motoruna verilir.
 * Yalnızca açık kullanıcı eylemiyle çağrılır (Nominatim politikası: otomatik tamamlama YOK; en az 1,1 sn aralık).
 * Birincil: Nominatim (OpenStreetMap). Boş/hatalı dönerse yedek: Photon (OSM tabanlı). Koordinat YUVARLANMAZ.
 */
export async function adresAra(girdi) {
  const q = typeof girdi === "string" ? girdi.trim() : [girdi?.mahalle, girdi?.ilce, girdi?.sehir, girdi?.ulke].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
  if (q.length < 3) return [];
  const bekle = sonNominatim + 1100 - Date.now();
  if (bekle > 0) await new Promise((r) => setTimeout(r, bekle));
  sonNominatim = Date.now();
  try {
    const j = await jsonAl(`${NOMINATIM_URL}?format=jsonv2&limit=6&addressdetails=1&accept-language=tr,en&q=${encodeURIComponent(q)}`, 9000);
    const liste = (Array.isArray(j) ? j : []).map((r) => nomSonucu(r, q)).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    if (liste.length) return liste;
  } catch { /* yedeğe geç */ }
  const f = await jsonAl(`${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&lang=en`, 9000);
  return (f.features || []).map((x) => photonSonucu(x, q)).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}
/** Eski ad (geriye uyum). */
export const sokakAra = adresAra;

/* ------------------------------ geçmiş gün (v7) ------------------------------ */
const ARSIV_URL = "https://archive-api.open-meteo.com/v1/archive";
export const GECMIS_YAKIN_GUN = 92;                    // Forecast API `past_days` üst sınırı; daha eskisi Historical (ERA5) arşivinden
const GECMIS_ONEKI = "hv_gecmis1_";
const GECMIS_TTL = { forecast: 3 * 3600 * 1000, archive: 24 * 3600 * 1000 };
const tarihGunu = (t) => { const [y, a, g] = t.split("-").map(Number); return Date.UTC(y, a - 1, g) / 86400000; };
/** Konumun "bugün"üne göre kaç gün geride (bugün = 0, dün = 1). */
export const gunGeri = (tarih, bugun) => Math.round(tarihGunu(bugun) - tarihGunu(tarih));
/** Hangi API'nin kullanılacağı (arayüz rozeti ve test için). */
export const gecmisKaynagi = (geri) => (geri <= GECMIS_YAKIN_GUN ? "forecast" : "archive");

const ILERI_SAATLIK = "temperature_2m,apparent_temperature,weather_code,precipitation,rain,showers,snowfall,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,pressure_msl,cloud_cover,is_day,uv_index,cape,freezing_level_height,soil_temperature_0cm,snow_depth";
const ARSIV_SAATLIK = "temperature_2m,apparent_temperature,weather_code,precipitation,rain,snowfall,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,pressure_msl,cloud_cover,is_day,snow_depth";
const ARSIV_EK = "cape,soil_temperature_0_to_7cm";     // her konumda yoksa (HTTP 400) bunlarsız yeniden denenir

/**
 * Seçilen GEÇMİŞ günün 24 saatini döndürür (ölçülen/gerçekleşen değerler).
 *  • ≤ 92 gün: Forecast API + past_days (modelin analiz alanı; PoP/UV/sıfır izotermi de gelir).
 *  • > 92 gün: Historical Weather API (ERA5 yeniden analiz): PoP/UV/sıfır izotermi/sağanak YOKTUR; cape ve zemin sıcaklığı (0–7 cm) varsa kullanılır.
 * Geçmişte yağış "oldu ya da olmadı" olduğundan olasılık yerine gerçekleşen değer kullanılır: yagisOlasi = yağış ≥ 0,1 mm ise 100, değilse 0.
 * @returns {{kaynak:"forecast"|"archive", saatler:object[], geri:number, tz:string, rakim:number|null, onbellek:boolean, notlar:string[]}}
 */
export async function gecmisGunGetir(lat, lon, tarih, bugun) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih || "")) throw new Error("Geçersiz tarih.");
  const b = bugun || new Date().toISOString().slice(0, 10);
  const geri = gunGeri(tarih, b);
  if (geri < 1) throw new Error("Geçmiş için bugünden önceki bir gün seç.");
  const kaynak = gecmisKaynagi(geri);
  const anahtar = `${GECMIS_ONEKI}${kaynak}_${nokta(lat)}_${nokta(lon)}_${tarih}`;
  try {
    const k = JSON.parse(localStorage.getItem(anahtar) || "null");
    if (k && Date.now() - k.t < GECMIS_TTL[kaynak]) return { ...k.veri, onbellek: true };
  } catch { /* depo kapalı/bozuk */ }

  let ana, notlar = [];
  if (kaynak === "forecast") {
    ana = await jsonAl(`${HAVA_URL}?latitude=${lat}&longitude=${lon}&timezone=auto&hourly=${ILERI_SAATLIK}&past_days=${geri}&forecast_days=1`, 12000);
  } else {
    const url = (alanlar) => `${ARSIV_URL}?latitude=${lat}&longitude=${lon}&timezone=auto&start_date=${tarih}&end_date=${tarih}&hourly=${alanlar}`;
    try { ana = await jsonAl(url(`${ARSIV_SAATLIK},${ARSIV_EK}`), 15000); }
    catch (h) { if (!/HTTP 400/.test(String(h?.message))) throw h; ana = await jsonAl(url(ARSIV_SAATLIK), 15000); }
    notlar.push("ERA5 yeniden analiz verisi (≈ 25 km ızgara): yağış olasılığı, UV ve sıfır izotermi arşivde yoktur; zemin değeri 0–7 cm toprak sıcaklığıdır.");
  }
  const H = ana?.hourly;
  if (!H?.time) throw new Error("Open-Meteo geçmiş veri döndürmedi.");
  if (kaynak === "archive" && H.soil_temperature_0_to_7cm) H.soil_temperature_0cm = H.soil_temperature_0_to_7cm;
  const idx = H.time.map((t, k) => (t.startsWith(tarih) ? k : -1)).filter((k) => k >= 0);
  const saatler = idx.map((k) => {
    const x = saatOge(H, k);
    x.yagisOlasi = x.yagis >= 0.1 ? 100 : 0; x.uyum = null; x.gecmis = true;
    return x;
  }).filter((x) => Number.isFinite(x.temp) && Number.isFinite(x.app));
  if (!saatler.length) throw new Error("Bu tarih için saatlik değer bulunamadı (arşivde henüz yayımlanmamış olabilir).");
  const veri = { kaynak, saatler, geri, tz: ana.timezone || "", rakim: Number.isFinite(ana.elevation) ? Math.round(ana.elevation) : null, notlar };
  try { localStorage.setItem(anahtar, JSON.stringify({ t: Date.now(), veri })); } catch { /* yok say */ }
  return { ...veri, onbellek: false };
}
