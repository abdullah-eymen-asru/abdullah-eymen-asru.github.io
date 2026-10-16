/**
 * assets/js/havastil/veri.js — HavaStil veri katmanı: Open-Meteo (hava), Open-Meteo Geocoding + Nominatim (konum arama).
 * -----------------------------------------------------------------------------------------------------------------
 * GİZLİLİK: istekler TARAYICIDAN doğrudan bu üç açık servise gider; koordinat/arama metni site sunucusuna, Supabase'e ya da
 * Worker'a gönderilmez (Worker yalnızca stilist yorumu için SAYISAL özet alır — konum içermez).
 * KOTA: Open-Meteo sınırı IP başınadır (kullanıcının kendi IP'si); Cloudflare Worker kotasından düşmez. Yanıtlar 30 dk
 * localStorage'da önbelleklenir; çevrimdışıyken son bilinen veri "eski" etiketiyle gösterilir.
 * Nominatim politikası gereği otomatik tamamlama YAPILMAZ: sokak/mahalle araması yalnızca Enter/Ara ile, 1 sn aralıkla.
 * Canlı öneriler Open-Meteo Geocoding'den gelir (arama-sırasında-öneri için tasarlanmış, anahtarsız).
 */
const HAVA_URL = "https://api.open-meteo.com/v1/forecast";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MODELLER = "ecmwf_ifs025,icon_seamless,gfs_seamless";
const ONBELLEK_OMRU_MS = 30 * 60 * 1000;
const ONBELLEK_ONEKI = "hv_hava_";

const yuv = (x) => Math.round(x);
const sayi = (x, v = 0) => (Number.isFinite(x) ? x : v);

async function jsonAl(url, zamanAsimiMs = 9000) {
  const kontrol = new AbortController();
  const z = setTimeout(() => kontrol.abort(), zamanAsimiMs);
  try {
    const r = await fetch(url, { signal: kontrol.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(z); }
}

/** Yerel (konumun saat dilimindeki) "YYYY-MM-DD" üzerine gün ekler; saat dilimi kayması olmasın diye UTC aritmetiği. */
function gunEkle(tarih, n) {
  const [y, a, g] = tarih.split("-").map(Number);
  const d = new Date(Date.UTC(y, a - 1, g + n));
  return d.toISOString().slice(0, 10);
}

/** Hava + (başarısızsa sessiz geçen) çoklu model yağış kontrolü → motorun beklediği özet. */
export async function havaGetir(lat, lon) {
  const anahtar = `${ONBELLEK_ONEKI}${lat.toFixed(2)}_${lon.toFixed(2)}`;
  try {
    const k = JSON.parse(localStorage.getItem(anahtar) || "null");
    if (k && Date.now() - k.t < ONBELLEK_OMRU_MS) return { ...k.veri, eski: false, onbellek: true };
  } catch { /* depo kapalı/bozuk */ }

  const temel = `${HAVA_URL}?latitude=${lat}&longitude=${lon}&timezone=auto`;
  try {
    const ana = await jsonAl(`${temel}&current=temperature_2m,apparent_temperature,wind_speed_10m,precipitation&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,uv_index&past_days=1&forecast_days=2`);
    let modeller = null;
    try { modeller = await jsonAl(`${temel}&hourly=precipitation&models=${MODELLER}&forecast_days=2`, 6000); } catch { /* fail-soft: tek model */ }
    const veri = ozetle(ana, modeller);
    try { localStorage.setItem(anahtar, JSON.stringify({ t: Date.now(), veri })); } catch { /* yok say */ }
    return { ...veri, eski: false, onbellek: false };
  } catch (h) {
    try {
      const k = JSON.parse(localStorage.getItem(anahtar) || "null");
      if (k) return { ...k.veri, eski: true, onbellek: true };
    } catch { /* yok say */ }
    throw h;
  }
}

/** Open-Meteo yanıtlarını (saat dilimi = konumun saat dilimi) motor girdisine çevirir. Saf fonksiyon (test edilebilir). */
export function ozetle(ana, modeller) {
  const c = ana.current, H = ana.hourly;
  const simdiSaat = c.time.slice(0, 13); // "YYYY-MM-DDTHH"
  let i = H.time.findIndex((t) => t.startsWith(simdiSaat));
  if (i < 0) i = Math.min(24, H.time.length - 1);
  const bugun = c.time.slice(0, 10);
  const saat = Number(c.time.slice(11, 13));

  // Pencere: bugün şimdiden 22:00'ye (en erken 07:00); akşam geç ise YARIN 07–22.
  let gun = bugun, gunEtiketi = "bugün", bas = Math.max(saat, 7);
  if (saat >= 21) { gun = gunEkle(bugun, 1); gunEtiketi = "yarın"; bas = 7; }
  const pencere = [];
  H.time.forEach((t, k) => {
    if (t.startsWith(gun)) { const s = Number(t.slice(11, 13)); if (s >= bas && s <= 22) pencere.push(k); }
  });
  if (!pencere.length) pencere.push(i);
  const al = (dizi) => pencere.map((k) => dizi[k]).filter(Number.isFinite);
  const app = al(H.apparent_temperature), ham = al(H.temperature_2m);
  const minApp = Math.min(...app), maxApp = Math.max(...app);

  // Son 6 saatte biriken yağış (zemin ıslaklığı) — konum saatine göre
  let recentPrecip = 0;
  for (let k = Math.max(0, i - 6); k < i; k++) recentPrecip += sayi(H.precipitation[k]);

  // Dün aynı saat (past_days=1 → 24 saat önce)
  const dun = i - 24 >= 0 ? H.apparent_temperature[i - 24] : null;
  const yesterdayDiff = Number.isFinite(dun) ? yuv(c.apparent_temperature) - yuv(dun) : null;

  // Olasılıksal risk-averse kural: modellerden BİRİ bile pencerede yağış veriyorsa koruyucu önlem
  const rainProbBase = Math.max(0, ...al(H.precipitation_probability));
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
  if (anaYagis) yagisVerenModel += 1, modelSayisi += 1; else modelSayisi += 1;
  let rainProb = rainProbBase;
  if (yagisVerenModel >= 2) rainProb = Math.max(rainProb, 60);
  else if (yagisVerenModel === 1) rainProb = Math.max(rainProb, 40);
  const modelFarki = yagisVerenModel > 0 && yagisVerenModel < modelSayisi;

  return {
    apparent: yuv(c.apparent_temperature),
    raw: yuv(c.temperature_2m),
    wind: yuv(c.wind_speed_10m),
    uv: yuv(Math.max(0, ...al(H.uv_index))),
    rainProb: yuv(rainProb), rainProbBase: yuv(rainProbBase), modelFarki, modelSayisi, yagisVerenModel,
    delta: yuv(maxApp - minApp), minApp: yuv(minApp), maxApp: yuv(maxApp), minRaw: yuv(Math.min(...ham, c.temperature_2m)),
    recentPrecip: Math.round(recentPrecip * 10) / 10,
    yesterdayDiff, saat, gun: gunEtiketi, guncelleme: c.time,
  };
}

/** Canlı öneri (Open-Meteo Geocoding): şehir/ilçe/semt. */
export async function yerOner(q) {
  const j = await jsonAl(`${GEO_URL}?name=${encodeURIComponent(q)}&count=6&language=tr&format=json`, 6000);
  return (j.results || []).map((r) => ({
    ad: r.name,
    ayrinti: [r.admin2, r.admin1, r.country].filter((x, k, a) => x && a.indexOf(x) === k && x !== r.name).join(", "),
    lat: r.latitude, lon: r.longitude,
    ulke: r.country_code || "", ilAd: r.admin1 || "", // il tespiti için (haber doğrulama); sunucuya GİTMEZ
  }));
}

let sonNominatim = 0;
/** Sokak/mahalle araması (Nominatim): yalnızca açık kullanıcı eylemiyle (Enter); en az 1,1 sn aralık. */
export async function sokakAra(q) {
  const bekle = sonNominatim + 1100 - Date.now();
  if (bekle > 0) await new Promise((r) => setTimeout(r, bekle));
  sonNominatim = Date.now();
  const j = await jsonAl(`${NOMINATIM_URL}?format=jsonv2&limit=6&accept-language=tr&q=${encodeURIComponent(q)}`, 9000);
  return (Array.isArray(j) ? j : []).map((r) => ({
    ad: (r.name || r.display_name.split(",")[0] || q).slice(0, 60),
    ayrinti: r.display_name.split(",").slice(1, 4).join(",").trim(),
    lat: Number(r.lat), lon: Number(r.lon),
    adres: r.display_name || "",
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}
