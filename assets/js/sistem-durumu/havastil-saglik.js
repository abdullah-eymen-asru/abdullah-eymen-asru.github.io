/**
 * assets/js/sistem-durumu/havastil-saglik.js — Sistem Durumu › "HavaStil sağlığı": HavaStil'in dayandığı HER servisin çalışıp çalışmadığı, tek ayrı bölümde.
 *
 * Tasarım ilkeleri
 *  • Mevcut Sistem Durumu sayfasına DOKUNMAZ: kendi <details> bölümüdür, sayfanın en altında, varsayılan KAPALI; yalnızca özet rozeti görünür.
 *    Sayfa 60 sn'de bir yeniden çizilse de bu bölüm AYNI düğüm olarak kalır (durumunu/sonuçlarını kaybetmez) ve kendi kendine istek ATMAZ.
 *  • Gruplar: 1) Hava verisi kaynakları  2) Harita ve radar katmanları  3) Konum arama  4) Yapay zekâ  5) Veritabanı (Supabase)
 *             6) Cloudflare Worker + resmî kaynaklar (MGM · METAR · OpenAQ) — YALNIZCA düğmeyle  7) Bu cihaz.
 *  • Kota: 1–5 ve 7 tarayıcıdan, ücretsiz ve küçük istekle yapılır (Worker kotası harcanmaz). 6. grup Worker'ı çağırır → açıkça düğmeyle.
 *  • Her satır: durum noktası + ad + ne işe yaradığı + sonuç (ms) + resmî durum/doküman bağlantısı + "bozuksa ne olur" cümlesi.
 *  • Hiçbir şey kaydedilmez; hiçbir anahtar okunmaz/gösterilmez (yalnızca "tanımlı mı" bayrağı). CSP: inline stil/olay yok, innerHTML yok.
 *  • Demo/vitrin: bu bölüm çizilmez (Sistem Durumu demoda sahte durumla gösterilir; bkz. demo-sistem-durumu.js).
 */
const el = (t, oz = {}, ...c) => {
  const n = document.createElement(t);
  for (const [k, v] of Object.entries(oz)) { if (v == null || v === false) continue; if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : String(v)); }
  for (const x of c.flat()) if (x != null && x !== false) n.append(x.nodeType ? x : document.createTextNode(String(x)));
  return n;
};

const WORKER = "https://havastil-worker.aeymena.workers.dev";
const ATAS = { ad: "Ataşehir", lat: 40.9923, lon: 29.1244, ulke: "TR", il: "İstanbul", admin1: "İstanbul", ilce: "Ataşehir" };   // sınama noktası (kayıtlı konum yoksa)
const YAVAS_MS = 3500;

async function sonda(url, { ms = 7000, json = true, secenek = {} } = {}) {
  const t0 = performance.now(), k = new AbortController(), z = setTimeout(() => k.abort(), ms);
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: k.signal, ...secenek });
    const veri = json && r.ok ? await r.json().catch(() => null) : null;
    return { ok: r.ok, durum: r.status, ms: Math.round(performance.now() - t0), veri };
  } catch (h) { return { ok: false, durum: 0, ms: Math.round(performance.now() - t0), hata: h?.name === "AbortError" ? "zaman aşımı" : "ulaşılamadı" }; }
  finally { clearTimeout(z); }
}
/** Karo/görsel sondası: CORS gerektirmez; resim yüklenirse servis çalışıyor demektir. */
function resimSonda(url, ms = 7000) {
  return new Promise((coz) => {
    const t0 = performance.now(), im = new Image(); let bitti = false;
    const bit = (ok, hata) => { if (bitti) return; bitti = true; clearTimeout(z); coz({ ok, durum: ok ? 200 : 0, ms: Math.round(performance.now() - t0), hata }); };
    const z = setTimeout(() => bit(false, "zaman aşımı"), ms);
    im.referrerPolicy = "no-referrer"; im.onload = () => bit(true); im.onerror = () => bit(false, "yüklenemedi"); im.src = url;
  });
}
const yavasMi = (r) => r.ok && r.ms > YAVAS_MS;
const tr = (n, d = 1) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: d });

/* ============================== kontrol tanımları ============================== */
/* Her kontrol: { id, grup, ad, ne, baglanti?, bozulursa, dene: async () => { ok, uyari?, yazi, ms } , dugmeli? } */
const tarih = (d) => d.toISOString().slice(0, 10);

function kontroller(ctx) {
  const { konum, supabase } = ctx;
  const q = (o) => new URLSearchParams(o).toString();
  const bos = (r) => r.hata || (r.durum ? `HTTP ${r.durum}` : "yanıt yok");
  const rpc = (ad, args, ok) => async () => {
    const t0 = performance.now();
    try { const { data, error } = await supabase.rpc(ad, args || {}); const ms = Math.round(performance.now() - t0); if (error) return { ok: false, ms, yazi: `Hata: ${error.message || error.code}` }; return { ok: true, ms, yazi: ok ? ok(data) : "Yanıt verdi" }; }
    catch (h) { return { ok: false, ms: Math.round(performance.now() - t0), yazi: `Hata: ${h.message}` }; }
  };
  const tablo = (ad) => async () => {
    const t0 = performance.now();
    try { const { count, error } = await supabase.from(ad).select("*", { count: "exact", head: true }); const ms = Math.round(performance.now() - t0); return error ? { ok: false, ms, yazi: `Hata: ${error.message}` } : { ok: true, ms, yazi: `Okunuyor · senin ${count ?? 0} kaydın var` }; }
    catch (h) { return { ok: false, ms: Math.round(performance.now() - t0), yazi: `Hata: ${h.message}` }; }
  };
  const L = [];

  /* 1) Hava verisi */
  L.push({ id: "om-tahmin", grup: "hava", ad: "Hava tahmini (Open-Meteo)", ne: "Saatlik sıcaklık, yağış, rüzgâr, UV; 16 güne kadar tahmin.", baglanti: ["https://open-meteo.com/en/docs/model-updates", "Model güncellemeleri"],
    bozulursa: "Son kaydedilen tahmin gösterilir ('eski veri' uyarısıyla). Yeni tahmin alınamaz.",
    dene: async () => { const r = await sonda(`https://api.open-meteo.com/v1/forecast?${q({ latitude: konum.lat, longitude: konum.lon, current: "temperature_2m,precipitation", timezone: "auto" })}`); const t = r.veri?.current?.temperature_2m; return { ok: r.ok && Number.isFinite(t), uyari: yavasMi(r), ms: r.ms, yazi: Number.isFinite(t) ? `Çalışıyor · ${konum.ad}'da şu an ${tr(t)}°C${yavasMi(r) ? " (yavaş)" : ""}` : `Yanıt alınamadı (${bos(r)})` }; } });
  L.push({ id: "om-hk", grup: "hava", ad: "Hava kalitesi modeli (Open-Meteo · Copernicus CAMS)", ne: "Toz, ozon, azot gazı… için 4 günlük model tahmini. Yakında istasyon yoksa bu kullanılır.", baglanti: ["https://open-meteo.com/en/docs/air-quality-api", "Hava kalitesi API'si"],
    bozulursa: "Hava kalitesi paneli boş kalır ya da son kaydedilen değeri gösterir; tahmin ve kıyafet önerileri etkilenmez.",
    dene: async () => { const r = await sonda(`https://air-quality-api.open-meteo.com/v1/air-quality?${q({ latitude: konum.lat, longitude: konum.lon, current: "european_aqi,pm2_5", timezone: "auto" })}`); const p = r.veri?.current?.pm2_5; return { ok: r.ok && r.veri?.current != null, uyari: yavasMi(r), ms: r.ms, yazi: r.ok && r.veri?.current ? `Çalışıyor · ince toz ${p != null ? `${tr(p)} µg/m³` : "—"} · Avrupa AQI ${r.veri.current.european_aqi ?? "—"}` : `Yanıt alınamadı (${bos(r)})` }; } });
  L.push({ id: "om-arsiv", grup: "hava", ad: "Geçmiş hava arşivi (Open-Meteo)", ne: "'Dün/geçen hafta' karşılaştırmaları ve doğrulama için geçmiş gözlem-analiz verisi.", baglanti: ["https://open-meteo.com/en/docs/historical-weather-api", "Arşiv API'si"],
    bozulursa: "Geçmiş gün kıyasları görünmez; canlı tahmin etkilenmez.",
    dene: async () => { const g = new Date(Date.now() - 4 * 86400000); const r = await sonda(`https://archive-api.open-meteo.com/v1/archive?${q({ latitude: konum.lat, longitude: konum.lon, start_date: tarih(g), end_date: tarih(g), hourly: "temperature_2m", timezone: "auto" })}`); const n = r.veri?.hourly?.temperature_2m?.length; return { ok: r.ok && n > 0, uyari: yavasMi(r), ms: r.ms, yazi: n > 0 ? `Çalışıyor · ${n} saatlik kayıt` : `Yanıt alınamadı (${bos(r)})` }; } });

  /* 2) Harita ve radar */
  L.push({ id: "radar", grup: "harita", ad: "Canlı radar (RainViewer)", ne: "Yağış radarı kareleri ve 'yağış geliyor mu' görünümü.", baglanti: ["https://www.rainviewer.com/api.html", "RainViewer API"],
    bozulursa: "Radar haritası açılmaz; yağış tahmini (Open-Meteo) yine çalışır.",
    dene: async () => { const r = await sonda("https://api.rainviewer.com/public/weather-maps.json"); const n = r.veri?.radar?.past?.length; return { ok: r.ok && n > 0, uyari: yavasMi(r), ms: r.ms, yazi: n > 0 ? `Çalışıyor · ${n} radar karesi${r.veri.generated ? ` · üretim ${new Date(r.veri.generated * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : ""}` : `Yanıt alınamadı (${bos(r)})` }; } });
  L.push({ id: "radar-karo", grup: "harita", ad: "Radar görüntü sunucusu (RainViewer karoları)", ne: "Radar karelerinin harita üstünde çizilen görselleri.", baglanti: ["https://www.rainviewer.com/api/transition-faq.html", "RainViewer sürüm notu"],
    bozulursa: "Radar kareleri boş görünür.", dene: async () => { const j = await sonda("https://api.rainviewer.com/public/weather-maps.json"); const yol = j.veri?.radar?.past?.at?.(-1)?.path; if (!yol) return { ok: false, ms: j.ms, yazi: `Radar kare listesi alınamadı (${bos(j)})` }; const r = await resimSonda(`${j.veri.host || "https://tilecache.rainviewer.com"}${yol}/256/1/0/0/2/1_1.png`); return { ok: r.ok, uyari: yavasMi(r), ms: j.ms + r.ms, yazi: r.ok ? "Görsel sunucusu yanıt veriyor" : `Ulaşılamadı (${r.hata})` }; } });
  L.push({ id: "osm", grup: "harita", ad: "Harita zemini (OpenStreetMap)", ne: "Radar ve konum seçicideki standart harita.", baglanti: ["https://operations.osmfoundation.org/policies/tiles/", "Karo kullanım politikası"],
    bozulursa: "Harita zemini boş/gri görünür; radar kareleri ve tahminler etkilenmez.", dene: async () => { const r = await resimSonda("https://tile.openstreetmap.org/0/0/0.png"); return { ok: r.ok, uyari: yavasMi(r), ms: r.ms, yazi: r.ok ? "Karo sunucusu yanıt veriyor" : `Ulaşılamadı (${r.hata})` }; } });
  L.push({ id: "uydu", grup: "harita", ad: "Uydu görüntüsü (NASA GIBS)", ne: "Bulut/uydu katmanı (MODIS gerçek renk).", baglanti: ["https://nasa-gibs.github.io/gibs-api-docs/", "GIBS API dokümanı"],
    bozulursa: "Uydu katmanı boş görünür.", dene: async () => { const t = tarih(new Date(Date.now() - 36 * 3600 * 1000)); const r = await resimSonda(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${t}/GoogleMapsCompatible_Level9/1/0/0.jpg`); return { ok: r.ok, uyari: yavasMi(r), ms: r.ms, yazi: r.ok ? "Görüntü sunucusu yanıt veriyor" : `Ulaşılamadı (${r.hata})` }; } });
  L.push({ id: "arcgis", grup: "harita", ad: "Uydu zemini (Esri World Imagery)", ne: "Uydu zemin haritası seçeneği.", baglanti: ["https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9", "Esri World Imagery"],
    bozulursa: "'Uydu' harita zemini boş görünür; standart harita çalışır.", dene: async () => { const r = await resimSonda("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0"); return { ok: r.ok, uyari: yavasMi(r), ms: r.ms, yazi: r.ok ? "Zemin sunucusu yanıt veriyor" : `Ulaşılamadı (${r.hata})` }; } });
  L.push({ id: "eumetsat", grup: "harita", ad: "Avrupa uydu servisi (EUMETSAT)", ne: "Avrupa/Türkiye bulut görüntüsü (WMS).", baglanti: ["https://view.eumetsat.int/", "EUMETSAT View"],
    bozulursa: "Avrupa bulut katmanı boş görünür.", dene: async () => { const r = await resimSonda("https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.1.1&request=GetMap&layers=mumi:wideareacoverage_rgb_natural&styles=&bbox=-180,-90,180,90&width=64&height=32&srs=EPSG:4326&format=image/png"); return { ok: r.ok, uyari: yavasMi(r), ms: r.ms, yazi: r.ok ? "WMS yanıt veriyor" : `Ulaşılamadı (${r.hata})` }; } });

  /* 3) Konum arama */
  L.push({ id: "geokod", grup: "konum", ad: "Konum arama (Open-Meteo Geocoding)", ne: "Şehir/ilçe adından koordinat bulma; konum ekleme.", baglanti: ["https://open-meteo.com/en/docs/geocoding-api", "Geocoding API'si"],
    bozulursa: "Yeni konum aranamaz; kayıtlı konumların hava durumu çalışır. Yedek: Photon / Nominatim.",
    dene: async () => { const r = await sonda(`https://geocoding-api.open-meteo.com/v1/search?${q({ name: "Ataşehir", count: 1, language: "tr" })}`); const n = r.veri?.results?.length; return { ok: r.ok && n > 0, uyari: yavasMi(r), ms: r.ms, yazi: n > 0 ? `Çalışıyor · "${r.veri.results[0].name}" bulundu` : `Sonuç yok (${bos(r)})` }; } });
  L.push({ id: "photon", grup: "konum", ad: "Konum arama yedeği (Photon)", ne: "Ana arama bulamazsa mahalle/adres düzeyinde yedek.", baglanti: ["https://photon.komoot.io/", "Photon"],
    bozulursa: "Mahalle düzeyinde arama yapılamaz; ilçe düzeyi çalışır.",
    dene: async () => { const r = await sonda(`https://photon.komoot.io/api/?${q({ q: "Ataşehir", limit: 1, lang: "en" })}`); const n = r.veri?.features?.length; return { ok: r.ok && n > 0, uyari: yavasMi(r), ms: r.ms, yazi: n > 0 ? "Çalışıyor" : `Sonuç yok (${bos(r)})` }; } });
  L.push({ id: "nominatim", grup: "konum", ad: "Adres çözümleme (Nominatim · OpenStreetMap)", ne: "Koordinattan/adresten konum adı bulma (ters çözümleme).", baglanti: ["https://operations.osmfoundation.org/policies/nominatim/", "Kullanım politikası"],
    bozulursa: "Konum adı yazılamaz; koordinatla çalışmaya devam eder.",
    dene: async () => { const r = await sonda(`https://nominatim.openstreetmap.org/search?${q({ q: "Ataşehir İstanbul", format: "jsonv2", limit: 1 })}`); const n = Array.isArray(r.veri) ? r.veri.length : 0; return { ok: r.ok && n > 0, uyari: yavasMi(r), ms: r.ms, yazi: n > 0 ? "Çalışıyor" : `Sonuç yok (${bos(r)})` }; } });

  /* 4) Yapay zekâ */
  L.push({ id: "openrouter", grup: "ai", ad: "Yapay zekâ model listesi (OpenRouter)", ne: "Kendi anahtarını kullanan üyelerin model seçimi. Anahtar GÖNDERİLMEZ; herkese açık liste okunur.", baglanti: ["https://openrouter.ai/models", "OpenRouter modelleri"],
    bozulursa: "Yalnızca OpenRouter model seçimi listelenemez; Groq tabanlı yorum etkilenmez.",
    dene: async () => { const r = await sonda("https://openrouter.ai/api/v1/models", { ms: 9000 }); const n = r.veri?.data?.length; return { ok: r.ok && n > 0, uyari: yavasMi(r), ms: r.ms, yazi: n > 0 ? `Çalışıyor · ${n} model` : `Yanıt alınamadı (${bos(r)})` }; } });

  /* 5) Veritabanı */
  L.push({ id: "db-yetki", grup: "db", ad: "HavaStil yetki kontrolü", ne: "HavaStil bu hesaba açık mı? (Yetki Ayarları › Özellikler)", bozulursa: "HavaStil kapalı görünür ya da açılmaz. Migration 0099 çalıştırıldı mı?",
    dene: rpc("havastil_yetkisi_var_mi", {}, (d) => (d === true ? "Çalışıyor · bu hesapta HavaStil AÇIK" : "Çalışıyor · bu hesapta HavaStil KAPALI")) });
  L.push({ id: "db-kaynak", grup: "db", ad: "Veri kaynağı ayarları", ne: "Hangi resmî kaynakların açık olduğu, tazelik ve yarıçap ayarları.", bozulursa: "Resmî kaynaklar ayarı okunamaz; varsayılanlarla (yalnızca model + havalimanı) çalışır. Migration 0146–0148.",
    dene: rpc("hava_kaynak_ayar_oku", {}, (d) => (d ? `Çalışıyor · MGM ${d.gozlem_acik?.mgm ? "açık" : "kapalı"} · havalimanı ${d.gozlem_acik?.metar ? "açık" : "kapalı"} · istasyon ${d.kalite_istasyon_acik ? "açık" : "kapalı"} · ölçümle doğrulama ${d.dogrulama_acik ? "açık" : "kapalı"}` : "Çalışıyor · bu hesaba ayar gösterilmiyor (HavaStil yetkisi yok)")) });
  L.push({ id: "db-konum", grup: "db", ad: "Kayıtlı konumlar", ne: "Eklediğin şehirler ve sıralaması.", bozulursa: "Kayıtlı konumlar görünmez; geçici konumla çalışılır.", dene: tablo("havastil_konumlari") });
  L.push({ id: "db-tercih", grup: "db", ad: "Kişisel tercihler", ne: "Tolerans, çanta, stil gibi ayarların.", bozulursa: "Tercihler kaydedilmez/okunmaz; varsayılanlar kullanılır.", dene: tablo("havastil_tercihleri") });
  L.push({ id: "db-om", grup: "db", ad: "Open-Meteo kota sayacı", ne: "Günlük tahmin isteği hakkın ve kullanımın.", bozulursa: "Kota gösterilmez; tahmin yine alınır. Migration 0100+.",
    dene: rpc("openmeteo_ayar_oku", {}, () => "Çalışıyor") });
  L.push({ id: "db-groq", grup: "db", ad: "Yapay zekâ günlük hakkı", ne: "Groq tabanlı yorum için kalan günlük hakkın.", bozulursa: "Kalan hak gösterilemez; yorum denemesi sunucuda ayrıca denetlenir.",
    dene: rpc("havastil_groq_kota_durumu", {}, () => "Çalışıyor") });
  L.push({ id: "db-misafir", grup: "db", ad: "Vitrin (misafir) erişimi", ne: "Oturumsuz ziyaretçi HavaStil vitrinini görebilir mi?", bozulursa: "Vitrin açılmayabilir. Migration 0102.",
    dene: rpc("havastil_misafir_acik_mi", {}, (d) => (d === true ? "Çalışıyor · vitrin AÇIK" : "Çalışıyor · vitrin KAPALI")) });

  /* 7) Bu cihaz */
  L.push({ id: "cihaz-sw", grup: "cihaz", ad: "HavaStil çevrimdışı önbelleği (servis çalışanı)", ne: "Sayfa kabuğu ve son görülen tahmin; internet yokken de açılmasını sağlar.", bozulursa: "Çevrimdışı açılmaz; çevrimiçi kullanım etkilenmez. Sayfayı Ctrl+F5 ile yenile.",
    dene: async () => {
      if (!("serviceWorker" in navigator)) return { ok: true, uyari: true, ms: 0, yazi: "Bu tarayıcı servis çalışanını desteklemiyor (sorun değil)" };
      const reg = await navigator.serviceWorker.getRegistration("/panel/havastil/").catch(() => null);
      if (!reg) return { ok: true, uyari: true, ms: 0, yazi: "Henüz kayıtlı değil: HavaStil'i bir kez açınca kurulur" };
      const adlar = (await caches.keys().catch(() => [])).filter((a) => a.startsWith("havastil-"));
      return { ok: true, ms: 0, yazi: `Kayıtlı${reg.active ? " ve etkin" : ""} · önbellek: ${adlar.join(", ") || "boş"}` };
    } });
  L.push({ id: "cihaz-onbellek", grup: "cihaz", ad: "Bu cihazdaki hava önbelleği", ne: "Son çekilen tahminler (yenileme hızlı olsun diye 30 dk tutulur).", bozulursa: "Her açılışta yeniden çekilir (biraz yavaş).",
    dene: async () => { let n = 0, en = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /^hv_hava/.test(k)) { n++; const t = JSON.parse(localStorage.getItem(k) || "null")?.t; if (t && t > en) en = t; } } } catch { return { ok: true, uyari: true, ms: 0, yazi: "Tarayıcı depolaması kapalı" }; }
      return { ok: true, ms: 0, yazi: n ? `${n} konumun tahmini kayıtlı · en yeni ${new Date(en).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : "Henüz kayıtlı tahmin yok" }; } });
  return L;
}

/** Worker + resmî kaynaklar: Worker kotasını harcar → yalnızca düğmeyle. */
function workerKontrolleri(ctx) {
  const { konum } = ctx;
  const L = [];
  L.push({ id: "w-saglik", grup: "worker", ad: "HavaStil Worker'ı (Cloudflare)", ne: "Resmî kaynakları, haberleri ve yapay zekâyı sunucu tarafında aracılık eden Worker.", baglanti: ["https://www.cloudflarestatus.com", "Cloudflare durumu"],
    bozulursa: "MGM, havalimanı, OpenAQ, haber ve yapay zekâ çalışmaz; yalnızca tahmin modeli kalır.",
    dene: async () => {
      const r = await sonda(`${WORKER}/saglik`); const j = r.veri;
      if (!r.ok || !j) return { ok: false, ms: r.ms, yazi: `Ulaşılamadı (${r.hata || `HTTP ${r.durum}`}). Worker silinmiş/kapatılmış ya da günlük kotası dolmuş olabilir.` };
      const eks = [];
      if (!j.groq_anahtari_var) eks.push("Groq anahtarı yok");
      if (!j.anahtar_sifresi_var) eks.push("HAVA_ANAHTAR_SIFRESI yok (siteden anahtar girilemez)");
      if (j.surum != null && j.surum < 6) eks.push(`Worker sürümü eski (${j.surum}); yeniden yayınla`);
      return { ok: true, uyari: eks.length > 0 || yavasMi(r), ms: r.ms, yazi: `Çalışıyor · sürüm ${j.surum ?? "?"}${eks.length ? ` · dikkat: ${eks.join("; ")}` : " · gerekli sırlar tanımlı"}` };
    } });
  const gerekli = (m) => async () => m;
  const kaynak = (id, ad, ne, baglanti, bozulursa) => L.push({ id: `w-${id}`, grup: "worker", ad, ne, baglanti, bozulursa, resmi: id, dene: gerekli(null) });
  kaynak("mgm", "Meteoroloji Genel Müdürlüğü (MGM) — resmî ölçüm", "Konumuna en yakın MGM istasyonunun anlık ölçümü; tahminle karşılaştırma ve düzeltme.", ["https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=%C4%B0stanbul&ilce=Ata%C5%9Fehir", "MGM'de Ataşehir"], "Resmî ölçümle doğrulama çalışmaz; model değerleri olduğu gibi kalır. (MGM belgelenmemiş bir uç nokta kullanır; alan adları değişebilir.)");
  kaynak("metar", "Havalimanı resmî raporu (METAR · NOAA)", "Yakın havalimanının resmî hava raporu (sıcaklık, rüzgâr, basınç).", ["https://aviationweather.gov/data/metar/?ids=LTFJ&hours=3", "Sabiha Gökçen METAR"], "Havalimanı ölçümü gelmez; MGM ya da model kullanılır.");
  kaynak("openaq", "Hava kalitesi istasyonları (OpenAQ)", "Konumuna yakın ölçüm istasyonlarının kirletici değerleri. Türkiye'de istasyon sayısı sınırlıdır.", ["https://explore.openaq.org/", "OpenAQ haritası"], "İstasyon verisi gelmez; hava kalitesi için Copernicus modeli kullanılır (bu normaldir).");
  L.push({ id: "w-haber", grup: "worker", ad: "Uyarılar ve haberler (Worker havuzu)", ne: "Hava uyarıları ve yerel haber başlıkları.", bozulursa: "Uyarı/haber şeridi boş kalır; tahmin etkilenmez.", haber: true, dene: gerekli(null) });
  L.push({ id: "w-ai", grup: "worker", ad: "Yapay zekâ yorumu (Groq · Worker)", ne: "Tahmini ve ölçümü yorumlayan yapay zekâ. Sınama çok kısa bir istek yapar (günlük hakkından 1 düşer).", baglanti: ["https://status.groq.com", "Groq durumu"], bozulursa: "Yapay zekâ yorumu gelmez; sayısal analiz ve öneriler etkilenmez.", yapayZeka: true, dene: gerekli(null) });
  void konum;
  return L;
}

const GRUPLAR = [
  ["hava", "🌡️", "Hava verisi", "Tahmin ve hava kalitesi modeli — HavaStil'in temeli."],
  ["harita", "🗺️", "Harita", "Radar, uydu ve harita zeminleri."],
  ["konum", "📍", "Konum", "Şehir/adres bulma servisleri."],
  ["ai", "🤖", "Yapay zekâ", "Model listesi (yorum motoru Worker sekmesinde)."],
  ["db", "🗄️", "Veritabanı", "Yetki, ayar, konum ve kota kayıtları (Supabase)."],
  ["worker", "☁️", "Worker", "MGM · havalimanı · OpenAQ · haber · yapay zekâ. Kota harcar: yalnızca site sahibi ve yöneticiler, yalnızca düğmeyle."],
  ["cihaz", "💻", "Bu cihaz", "Çevrimdışı önbellek ve kayıtlı tahminler."],
];

/* "Hata/uyarı olunca ne yapmalı?" — kullanıcı dilinde, adım adım. Satıra özel yoksa grubunki kullanılır. */
const ORTAK_ILK = "Önce satırdaki ⟳ ile bir kez daha dene (anlık kesintiler kendiliğinden geçer).";
const COZUM_GRUP = {
  hava: [ORTAK_ILK, "Hâlâ kırmızıysa 'Kaynak' bağlantısından sağlayıcının sayfasına bak. Sağlayıcı kesintisiyse yapılacak bir şey yok: HavaStil son kaydedilen veriyi gösterir.", "Yalnız sende kırmızıysa reklam/izleme engelleyici ya da ağ filtresi servisi engelliyor olabilir; kapatıp yeniden dene."],
  harita: [ORTAK_ILK, "Yalnız bu katman kırmızıysa haritada o katman boş görünür; diğer katmanlar ve tahmin etkilenmez.", "Birkaç saat sonra da düzelmezse 'Kaynak' sayfasında adres/kural değişikliği var mı bak (ücretsiz servisler zaman zaman adres değiştirir)."],
  konum: [ORTAK_ILK, "Bir arama servisi kırmızıysa HavaStil diğerine geçer; yeni konum eklerken sonuç gelmezse ilçe adıyla ara.", "Çok sık denersen servis geçici engel koyabilir: 1–2 dakika bekle."],
  ai: [ORTAK_ILK, "Yalnız OpenRouter model listesini etkiler; Groq tabanlı yorum çalışmaya devam eder."],
  db: ["Sayfayı yenile ve oturumun açık olduğundan emin ol.", "Hata metninde tablo/işlev/sütun adı geçiyorsa ilgili migration çalıştırılmamıştır: Supabase › SQL Editor'de migration'ı (satırdaki not) çalıştır.", "'permission denied' ya da 'JWT' geçiyorsa çıkış yapıp yeniden giriş yap."],
  worker: ["Önce Worker satırını sına. Kırmızıysa diğer satırlar anlamsızdır, önce onu düzelt.", "Cloudflare panelinde › Workers › havastil-worker › Metrics: günlük 100.000 istek dolmuş olabilir (UTC 00:00'da sıfırlanır).", "Yeni dağıttıysan Deployments'tan önceki sürüme dön (Rollback); gerekli sırların (Variables and Secrets) tanımlı olduğunu kontrol et."],
  cihaz: ["Sayfayı Ctrl+F5 (Mac: ⌘⇧R) ile yenile.", "Düzelmezse tarayıcı ayarlarından bu site için depolamayı temizle; HavaStil'i bir kez açınca önbellek yeniden kurulur."],
};
const COZUM_OZEL = {
  "w-openaq": ["Kırmızı değil, sarıysa sorun yok: OpenAQ'da Türkiye'de istasyon azdır; bu durumda hava kalitesi Copernicus modeliyle gösterilir.", "Kırmızıysa Worker'a OpenAQ anahtarı tanımlı mı bak (HavaStil › Doğrulama & Ayar › Veri kaynakları)."],
  "w-mgm": ["MGM'nin ücretsiz, belgesiz servisi zaman zaman yanıt vermez; HavaStil model verisine döner, tahmin etkilenmez.", "Kırmızı sürerse satırdaki 'Resmî site' bağlantısını aç: sayfa da açılmıyorsa sorun MGM'dedir, beklemek yeterli."],
  "w-metar": ["NOAA servisi geçici yanıt vermemiş olabilir; ⟳ ile tekrar dene.", "Havalimanı kodunun doğru olduğunu 'Resmî rapor' bağlantısından kontrol et."],
  "w-ai": ["'Çok sık sınadın' görürsen bir dakika bekle (dakikada 6 sınırı var).", "Groq anahtarı eksik/süresi dolmuşsa Worker'da GROQ_API_KEY sırrını yenile.", "Günlük Groq hakkı bittiyse ertesi gün (UTC) kendiliğinden döner."],
  "db-tercih": ["Migration 0099 (havastil_tercihleri tablosu) çalıştırılmış olmalı.", "Hata sürerse çıkış yapıp yeniden giriş yap."],
};
const cozumun = (k) => COZUM_OZEL[k.id] || COZUM_GRUP[k.grup] || [];

/* ============================== arayüz ============================== */
export function havastilSaglikBolumu({ supabase, oturum, yonetici = false }) {
  const durum = new Map();                        // id → { sev: bekle|ok|uyari|hata|yok, yazi, ms }
  const acik = new Set();                         // elle açılan ayrıntılar (yeniden çizimde korunur)
  let kontrolListesi = [], workerListesi = [], konum = ATAS, calisiyor = false, aktif = "hava", otoSecildi = false;

  const gruplar = GRUPLAR.filter(([id]) => id !== "worker" || yonetici);
  const ozetRozet = el("span", { class: "sd-hv-rozet sd-hv-rozet--yok", text: "henüz sınanmadı" });
  const kok = el("details", { class: "sd-hv" });
  const gov = el("div", { class: "sd-hv-govde" });
  kok.append(el("summary", {}, el("span", { "aria-hidden": "true", text: "🌦️ " }), el("strong", { text: "HavaStil sağlığı" }), el("span", { class: "muted sd-hv-alt", text: " · kullandığı tüm servisler" }), ozetRozet), gov);

  const tumListe = () => [...kontrolListesi, ...(yonetici ? workerListesi : [])];
  const grubunListesi = (id) => (id === "worker" ? workerListesi : kontrolListesi.filter((k) => k.grup === id));
  const grupSev = (id) => { const sv = grubunListesi(id).map((k) => durum.get(k.id)?.sev || "yok"); return sv.includes("hata") ? "hata" : sv.includes("uyari") ? "uyari" : sv.includes("bekle") ? "bekle" : sv.every((x) => x === "yok") ? "yok" : "ok"; };
  const SEV_METIN = { bekle: "…", ok: "✓", uyari: "!", hata: "✕", yok: "–" };
  
  const sekmeBar = el("div", { class: "sd-hv-sekmeler", role: "tablist", "aria-label": "HavaStil servis grupları" });
  const panel = el("section", { class: "sd-hv-panel", role: "tabpanel" });
  const altEylem = el("div", { class: "sd-eylemler" });
  const yenileBtn = el("button", { type: "button", class: "sd-btn", text: "⟳ Ücretsiz kontrolleri yeniden sına" });
  const workerBtn = el("button", { type: "button", class: "sd-btn", text: "☁️ Worker ve resmî kaynakları sına" });

  function sekmeleriCiz() {
    sekmeBar.replaceChildren(...gruplar.map(([id, ikon, ad]) => {
      const sev = grupSev(id);
      const b = el("button", { type: "button", role: "tab", class: `sd-hv-sekme sd-hv-sekme--${sev}${id === aktif ? " aktif" : ""}`, "aria-selected": id === aktif ? "true" : "false", title: `${ad}: ${sev === "ok" ? "sağlıklı" : sev === "uyari" ? "uyarı var" : sev === "hata" ? "sorun var" : "sınanmadı/sınanıyor"}` },
        el("span", { "aria-hidden": "true", text: ikon }), el("span", { text: ad }), el("i", { class: "sd-hv-nokta", "aria-hidden": "true" }));
      b.addEventListener("click", () => { aktif = id; tumunuCiz(); });
      return b;
    }));
  }
  function satirCiz(k) {
    const d = durum.get(k.id) || { sev: "yok", yazi: "Henüz sınanmadı" };
    const sorunlu = d.sev === "hata" || d.sev === "uyari";
    const b = el("button", { type: "button", class: "sd-hv-yeniden", "aria-label": `${k.ad} yeniden sına`, title: "Yalnız bu satırı yeniden sına", text: "⟳" });
    b.addEventListener("click", () => (k.grup === "worker" && k.id !== "w-saglik" ? workerSina() : bir(k)));
    const adimlar = sorunlu ? cozumun(k) : [];
    const det = el("details", { class: "sd-hv-detay" },
      el("summary", { text: sorunlu ? "Ne yapmalı?" : "Ayrıntı" }),
      el("p", { class: "sd-hv-ne", text: k.ne }),
      sorunlu && k.bozulursa ? el("p", { class: "sd-hv-oneri", text: `Bozulursa: ${k.bozulursa}` }) : null,
      adimlar.length ? el("ol", { class: "sd-hv-adimlar" }, ...adimlar.map((a) => el("li", { text: a }))) : null,
      k.baglanti ? el("a", { class: "sd-hv-link", href: k.baglanti[0], target: "_blank", rel: "noopener noreferrer", "aria-label": `${k.baglanti[1]} (yeni sekmede açılır)`, text: `Kaynak: ${k.baglanti[1]} ↗` }) : null);
    det.open = acik.has(k.id) || (sorunlu && d.sev === "hata");
    det.addEventListener("toggle", () => { if (det.open) acik.add(k.id); else acik.delete(k.id); });
    return el("li", { class: `sd-hv-satir sd-hv-${d.sev}` },
      el("span", { class: "sd-hv-isaret", "aria-hidden": "true", text: SEV_METIN[d.sev] }),
      el("div", { class: "sd-hv-metin" },
        el("strong", { text: k.ad }),
        el("small", { class: "sd-hv-sonuc", role: "status", text: d.yazi + (d.ms != null && d.sev !== "bekle" && d.ms > 0 ? ` · ${d.ms} ms` : "") }),
        det),
      b);
  }
  function panelCiz() {
    const g = GRUPLAR.find(([id]) => id === aktif) || GRUPLAR[0];
    const liste = grubunListesi(g[0]);
    altEylem.replaceChildren(g[0] === "worker" ? workerBtn : yenileBtn);
    panel.replaceChildren(el("p", { class: "muted sd-hv-grup-ac", text: g[3] }),
      el("ul", { class: "sd-hv-liste" }, ...liste.map(satirCiz)),
      ...(g[0] === "worker" ? [el("p", { class: "muted sd-hv-grup-ac", text: "Worker sınaması: Worker'a + haber ve yapay zekâ için birkaç istek atar (yapay zekâ günlük hakkından 1 düşer). Yalnız site sahibi ve yöneticiler çalıştırabilir." })] : []),
      altEylem);
  }
  function ozetGuncelle() {
    const hepsi = tumListe().map((k) => durum.get(k.id)).filter((d) => d && d.sev !== "yok" && d.sev !== "bekle");
    const hata = hepsi.filter((d) => d.sev === "hata").length, uyari = hepsi.filter((d) => d.sev === "uyari").length, ok = hepsi.filter((d) => d.sev === "ok").length;
    if (!hepsi.length) { ozetRozet.className = "sd-hv-rozet sd-hv-rozet--yok"; ozetRozet.textContent = "henüz sınanmadı"; return; }
    ozetRozet.className = `sd-hv-rozet sd-hv-rozet--${hata ? "hata" : uyari ? "uyari" : "ok"}`;
    ozetRozet.textContent = hata ? `${hata} sorun` : uyari ? `${uyari} uyarı` : "hepsi çalışıyor";
    ozetRozet.title = `${hepsi.length} sınama: ${ok} sağlıklı, ${uyari} uyarı, ${hata} sorun`;
    if (!otoSecildi && hata && !calisiyor) { const g = gruplar.find(([id]) => grupSev(id) === "hata"); if (g) { aktif = g[0]; otoSecildi = true; } }   // ilk sorunlu sekmeye kendiliğinden geç
  }
  function tumunuCiz() { ozetGuncelle(); sekmeleriCiz(); panelCiz(); }

  async function bir(k) {
    durum.set(k.id, { sev: "bekle", yazi: "Sınanıyor…" }); tumunuCiz();
    try {
      const s = await k.dene();
      if (s == null) durum.set(k.id, { sev: "yok", yazi: "Düğmeyle sınanır" });
      else durum.set(k.id, { sev: !s.ok ? "hata" : s.uyari ? "uyari" : "ok", yazi: s.yazi, ms: s.ms });
    } catch (h) { durum.set(k.id, { sev: "hata", yazi: `Sınama çalışmadı: ${h.message || h}` }); }
    tumunuCiz();
  }

  /** Resmî kaynaklar + haber + yapay zekâ: Worker KOTASI harcar → yalnızca site sahibi/yönetici, yalnızca düğmeyle. (Sunucu da kendi yetkisini denetler.) */
  async function workerSina() {
    if (!yonetici || workerBtn.disabled) return;
    workerBtn.disabled = true; workerBtn.textContent = "Sınanıyor…";
    try {
      await bir(workerListesi[0]);
      const ayakta = durum.get("w-saglik")?.sev !== "hata";
      for (const k of workerListesi.slice(1)) durum.set(k.id, { sev: "bekle", yazi: ayakta ? "Sınanıyor…" : "Worker yanıt vermediği için sınanmadı" });
      tumunuCiz();
      if (ayakta) {
        const hk = await import("../havastil/hava-kaynak.js");
        const sonuc = await hk.kaynakTesti(konum).catch((h) => [{ id: "hepsi", durum: "hata", ayrinti: h.message }]);
        for (const id of ["mgm", "metar", "openaq"]) {
          const k = workerListesi.find((x) => x.id === `w-${id}`), r = sonuc.find((x) => x.id === id);
          if (!k) continue;
          durum.set(k.id, !r ? { sev: "hata", yazi: "Sınama sonucu alınamadı" } : { sev: r.durum === "ok" ? "ok" : r.durum === "atlandi" ? "uyari" : "hata", yazi: r.ayrinti, ms: r.ms });
          if (id === "openaq" && r?.durum === "hata" && /istasyon yok/.test(r.ayrinti || "")) durum.set(k.id, { sev: "uyari", yazi: r.ayrinti, ms: r.ms });   // kapsama sınırı, arıza değil
        }
        tumunuCiz();
        await Promise.all([haberSina(), yzSina()]);
      }
    } finally { workerBtn.disabled = false; workerBtn.textContent = "☁️ Worker ve resmî kaynakları sına"; tumunuCiz(); }
  }
  async function jetonlu(yol) {
    const jeton = (await supabase.auth.getSession()).data?.session?.access_token; const t0 = performance.now();
    try {
      const r = await fetch(`${WORKER}${yol}`, { headers: { Authorization: `Bearer ${jeton}` }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(20000) });
      return { ok: r.ok, durum: r.status, ms: Math.round(performance.now() - t0), veri: await r.json().catch(() => null) };
    } catch (h) { return { ok: false, durum: 0, ms: Math.round(performance.now() - t0), hata: h.name === "TimeoutError" ? "zaman aşımı" : "ulaşılamadı" }; }
  }
  async function haberSina() {
    const k = workerListesi.find((x) => x.id === "w-haber"); const r = await jetonlu("/haberler?havuz=tr");
    const n = r.veri?.haberler?.length, kay = (r.veri?.kaynaklar || []);
    const kotu = kay.filter((x) => x.durum !== "ok").length;
    durum.set(k.id, r.ok && n != null ? { sev: kotu === kay.length && kay.length ? "hata" : kotu ? "uyari" : "ok", yazi: `Çalışıyor · ${n} başlık · ${kay.length - kotu}/${kay.length} kaynak yanıt veriyor${kotu ? " (bazı haber siteleri yanıt vermedi; normaldir)" : ""}`, ms: r.ms }
      : { sev: "hata", yazi: `Yanıt alınamadı (${r.durum === 401 ? "oturum/yetki" : r.hata || `HTTP ${r.durum}`})`, ms: r.ms });
    tumunuCiz();
  }
  async function yzSina() {
    const k = workerListesi.find((x) => x.id === "w-ai"); const r = await jetonlu("/tani"); const adim = r.veri?.adimlar || [];
    const groq = adim.find((a) => a.ad === "Groq çağrısı") || adim.find((a) => a.ad === "Groq anahtarı"), kotu = adim.find((a) => !a.ok);
    durum.set(k.id, r.ok && adim.length ? (kotu ? { sev: "hata", yazi: `${kotu.ad}: ${kotu.ayrinti}`, ms: r.ms } : { sev: "ok", yazi: groq?.ayrinti || "Çalışıyor", ms: r.ms })
      : { sev: "hata", yazi: r.durum === 429 ? "Çok sık sınadın; bir dakika bekle" : `Yanıt alınamadı (${r.hata || `HTTP ${r.durum}`})`, ms: r.ms });
    tumunuCiz();
  }

  const AGIR = new Set(["harita", "konum", "ai"]);                               // üçüncü taraf sunucular: yalnızca bölüm açılınca ya da düğmeyle
  async function hepsiniSina({ hafif = false } = {}) {
    if (calisiyor) return; calisiyor = true; yenileBtn.disabled = true; yenileBtn.textContent = "Sınanıyor…";
    await Promise.all(kontrolListesi.filter((k) => !hafif || !AGIR.has(k.grup)).map((k) => bir(k)));
    yenileBtn.disabled = false; yenileBtn.textContent = "⟳ Ücretsiz kontrolleri yeniden sına"; calisiyor = false; tumunuCiz();
  }
  yenileBtn.addEventListener("click", () => hepsiniSina());
  workerBtn.addEventListener("click", () => workerSina());

  async function kur() {
    // Sınama noktası: kullanıcının İLK kayıtlı konumu (yoksa Ataşehir): her kullanıcı KENDİ verisiyle sınar.
    try { const { data } = await supabase.from("havastil_konumlari").select("*").order("sira", { ascending: true }).limit(1); const k = data?.[0];
      if (k && Number.isFinite(Number(k.lat ?? k.enlem)) && Number.isFinite(Number(k.lon ?? k.boylam))) konum = { ...ATAS, ad: k.ad || k.name || "Kayıtlı konum", lat: Number(k.lat ?? k.enlem), lon: Number(k.lon ?? k.boylam), ulke: k.ulke || k.country_code || "TR" };
    } catch { /* sınama noktası Ataşehir kalır */ }
    kontrolListesi = kontroller({ konum, supabase }); workerListesi = workerKontrolleri({ konum });
    gov.replaceChildren(
      el("p", { class: "muted sd-hv-giris", text: `Sınama noktası: ${konum.ad}${yonetici ? "" : " (senin kayıtlı konumun)"}. Bu sekmelerdeki kontroller tarayıcından yapılır ve sunucu kotasını harcamaz. ⟳ yalnız o satırı yeniden sınar.` }),
      sekmeBar, panel,
      ...(yonetici ? [] : [el("p", { class: "muted sd-hv-giris", text: "Worker, MGM, havalimanı, haber ve yapay zekâ sınamaları sunucu kotası harcadığı için yalnızca site sahibi ve yöneticiler tarafından çalıştırılabilir." })]));
    tumunuCiz();
  }
  let ilk = false, agirYapildi = false;
  async function baslat(hafif) {
    if (!ilk) { ilk = true; await kur(); await hepsiniSina({ hafif: true }); }
    if (!hafif && !agirYapildi) { agirYapildi = true; await Promise.all(kontrolListesi.filter((k) => AGIR.has(k.grup)).map((k) => bir(k))); }
  }
  kok.addEventListener("toggle", () => { if (kok.open) baslat(false).catch(() => {}); });
  setTimeout(() => { if (oturum) baslat(true).catch(() => {}); }, 1500);   // kapalıyken yalnız hafif (kendi altyapımız) kontroller; rozet dolsun
  return kok;
}
