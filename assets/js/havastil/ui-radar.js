/*
 * ui-radar.js — HAVASTİL RADAR (harita tabanlı; Windy / Zoom Earth / MGM benzeri).
 * -----------------------------------------------------------------------------------------------------------------
 * Katmanlar
 *   GÖZLEM (RainViewer, anahtarsız): 🌧️ Radar (son ~2 saat + 30 dk tahmin) · 🛰️ Uydu (kızılötesi bulut)
 *   TAHMİN (Open-Meteo ızgara, anahtarsız; saatlik, 10 güne kadar): 🌧️ Yağış · ☁️ Bulut · 🌬️ Rüzgâr (hareketli parçacıklar) · 💨 Hamle · 🌡️ Sıcaklık · 🧭 Basınç · 💧 Nem
 * Harita: Leaflet (cdnjs, sürüm sabit). Fare tekerleği, trackpad (Ctrl+tekerlek / sıkıştırma), dokunmatik sıkıştırma, çift tıklama, +/−, tam ekran, bölge kısayolları.
 * Kota/gizlilik: tahmin ızgarası YALNIZCA düğmeyle / bölge değişince / ilk açılışta TEK istekle çekilir (kaydırınca otomatik istek YOK) ve bellekte tutulur.
 *   İstekler tarayıcıdan doğrudan genel servislere gider; hesabına/sunucumuza veri yazılmaz.
 * NOT: MGM'nin kendi radar verisi herkese açık bir API sunmadığı için kullanılmaz; RainViewer küresel radar kompozitidir (kapsama bölgeye göre değişir).
 */
import { el, olay } from "./ui-temel.js";
import { gorunenAd } from "./konumlar.js";

const LEAFLET_SURUM = "1.9.4";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_SURUM}`;
const GUN = 10;                                           // Open-Meteo saatlik tahmin penceresi (en çok 16)
const BOLGELER = { konum: ["📍 Konumum", null, 7], turkiye: ["🇹🇷 Türkiye", [[35.6, 25.5], [42.4, 45.2]]], avrupa: ["🇪🇺 Avrupa", [[34, -12], [66, 42]]], dunya: ["🌍 Dünya", [[-58, -170], [75, 175]]] };
const KATMANLAR = [
  ["radar", "🌧️", "Radar", "gozlem"], ["uydu", "🛰️", "Uydu", "gozlem"],
  ["yagis", "🌧️", "Yağış", "tahmin"], ["bulut", "☁️", "Bulut", "tahmin"], ["ruzgar", "🌬️", "Rüzgâr", "tahmin"],
  ["hamle", "💨", "Hamle", "tahmin"], ["sicaklik", "🌡️", "Sıcaklık", "tahmin"], ["basinc", "🧭", "Basınç", "tahmin"], ["nem", "💧", "Nem", "tahmin"],
];
const DEGISKEN = { yagis: "precipitation", bulut: "cloud_cover", ruzgar: "wind_speed_10m", hamle: "wind_gusts_10m", sicaklik: "temperature_2m", basinc: "pressure_msl", nem: "relative_humidity_2m" };
const BIRIM = { yagis: "mm/sa", bulut: "%", ruzgar: "km/sa", hamle: "km/sa", sicaklik: "°C", basinc: "hPa", nem: "%" };

/* renk ölçekleri: [değer, [r,g,b,a]] */
const OLCEK = {
  yagis: [[0, [0, 0, 0, 0]], [0.1, [120, 190, 255, 120]], [0.5, [60, 140, 255, 170]], [2, [30, 190, 120, 200]], [5, [250, 220, 40, 215]], [10, [250, 130, 30, 230]], [25, [220, 30, 40, 240]], [50, [170, 40, 200, 250]]],
  bulut: [[0, [255, 255, 255, 0]], [30, [235, 240, 250, 60]], [70, [225, 232, 245, 140]], [100, [210, 220, 238, 205]]],
  ruzgar: [[0, [60, 120, 220, 0]], [10, [70, 190, 210, 70]], [25, [90, 210, 120, 120]], [40, [245, 215, 70, 160]], [60, [245, 140, 50, 190]], [90, [220, 50, 50, 210]], [130, [170, 50, 200, 230]]],
  hamle: [[0, [60, 120, 220, 0]], [20, [70, 190, 210, 70]], [40, [90, 210, 120, 120]], [60, [245, 215, 70, 165]], [90, [245, 140, 50, 195]], [120, [220, 50, 50, 215]], [160, [170, 50, 200, 235]]],
  sicaklik: [[-30, [150, 60, 220, 190]], [-15, [70, 90, 230, 190]], [0, [80, 190, 240, 190]], [10, [90, 210, 150, 190]], [20, [245, 225, 80, 195]], [30, [245, 140, 50, 205]], [40, [220, 50, 40, 215]], [50, [140, 20, 60, 225]]],
  basinc: [[960, [120, 60, 200, 190]], [990, [70, 130, 230, 190]], [1005, [120, 210, 230, 170]], [1013, [235, 235, 235, 150]], [1025, [245, 190, 90, 180]], [1040, [220, 70, 60, 200]]],
  nem: [[0, [230, 180, 90, 150]], [40, [235, 235, 150, 90]], [70, [120, 210, 190, 130]], [100, [40, 110, 220, 190]]],
};
function renk(olc, v) {
  if (v == null || Number.isNaN(v)) return [0, 0, 0, 0];
  if (v <= olc[0][0]) return olc[0][1];
  for (let i = 1; i < olc.length; i++) if (v <= olc[i][0]) { const [a, ca] = olc[i - 1], [b, cb] = olc[i]; const f = (v - a) / (b - a); return ca.map((x, k) => x + (cb[k] - x) * f); }
  return olc[olc.length - 1][1];
}

let leafletSoz = null;
function leafletYukle() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletSoz) return leafletSoz;
  leafletSoz = new Promise((coz, red) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = `${CDN}/leaflet.css`; document.head.append(css);
    const s = document.createElement("script"); s.src = `${CDN}/leaflet.js`; s.crossOrigin = "anonymous";
    s.onload = () => (window.L ? coz(window.L) : red(new Error("Harita kütüphanesi başlatılamadı.")));
    s.onerror = () => { leafletSoz = null; red(new Error("Harita kütüphanesi yüklenemedi (ağ ya da engelleyici).")); };
    document.head.append(s);
  });
  return leafletSoz;
}

/** Yaşayan harita (tek örnek). Sekme değişince radarDurdur() çağrılır → animasyon/bellek serbest kalır. */
let canli = null;
export function radarDurdur() { if (canli) { try { canli.durdur(); } catch { /* yok say */ } canli = null; } }

const ISO = (t) => new Date(`${t}:00Z`).getTime();
const saatYaz = (ms, gun = true) => new Date(ms).toLocaleString("tr-TR", gun ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

/* ------------------------------ tahmin ızgarası (Open-Meteo) ------------------------------ */
async function izgaraGetir(sinir, hedefNokta, sinyal) {
  let [[g, b], [k, d]] = sinir;                                                  // güney-batı, kuzey-doğu
  const enBoy = Math.max(0.5, d - b) / Math.max(0.5, k - g);
  g = Math.max(-85, g); k = Math.min(85, k);
  const nLon = Math.max(5, Math.round(Math.sqrt(hedefNokta * enBoy))), nLat = Math.max(4, Math.round(hedefNokta / nLon));
  const dLat = (k - g) / (nLat - 1), dLon = (d - b) / (nLon - 1);
  const lat = [], lon = [];
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) { lat.push((g + i * dLat).toFixed(3)); lon.push((((b + j * dLon + 540) % 360) - 180).toFixed(3)); }
  const degiskenler = ["temperature_2m", "precipitation", "cloud_cover", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "pressure_msl", "relative_humidity_2m"];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.join(",")}&longitude=${lon.join(",")}&hourly=${degiskenler.join(",")}&forecast_days=${GUN}&wind_speed_unit=kmh&timezone=UTC`;
  const r = await fetch(url, { signal: sinyal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (r.status === 429) throw new Error("Open-Meteo günlük/dakikalık kotası doldu. Biraz sonra tekrar dene ya da daha düşük detay seç.");
  if (!r.ok) throw new Error(`Tahmin servisi ${r.status} döndürdü.`);
  let j = await r.json(); if (!Array.isArray(j)) j = [j];
  const zaman = j[0].hourly.time.map(ISO), n = zaman.length;
  const veri = {}; for (const v of degiskenler) veri[v] = new Float32Array(j.length * n);
  j.forEach((nokta, idx) => { for (const v of degiskenler) { const a = nokta.hourly[v]; for (let h = 0; h < n; h++) veri[v][idx * n + h] = a[h] ?? NaN; } });
  return { g, b, dLat, dLon, nLat, nLon, n, zaman, veri, alinma: Date.now() };
}
/** (lat,lon,zaman-indeksi[ondalıklı]) → değer; ızgara dışı NaN */
function ornekle(iz, ad, lat, lon, t) {
  const fy = (lat - iz.g) / iz.dLat;
  const x = (((lon - iz.b) % 360) + 360) % 360 / iz.dLon;
  if (fy < 0 || fy > iz.nLat - 1 || x < 0 || x > iz.nLon - 1) return NaN;
  const i0 = Math.min(iz.nLat - 2, Math.floor(fy)), j0 = Math.min(iz.nLon - 2, Math.floor(x)), ay = fy - i0, ax = x - j0;
  const h0 = Math.max(0, Math.min(iz.n - 1, Math.floor(t))), h1 = Math.min(iz.n - 1, h0 + 1), at = t - h0;
  const a = iz.veri[ad], N = iz.n;
  const s = (i, j) => { const o = (i * iz.nLon + j) * N; return a[o + h0] * (1 - at) + a[o + h1] * at; };
  return (s(i0, j0) * (1 - ax) + s(i0, j0 + 1) * ax) * (1 - ay) + (s(i0 + 1, j0) * (1 - ax) + s(i0 + 1, j0 + 1) * ax) * ay;
}
function ruzgarUV(iz, lat, lon, t) {
  const hiz = ornekle(iz, "wind_speed_10m", lat, lon, t); if (Number.isNaN(hiz)) return null;
  // yön açısı dairesel: bileşenlerine ayırıp ızgara değerlerini ayrı ayrı örneklemek için hızla birlikte u/v hesapla (yaklaşık: yönü en yakın saat/noktadan oku)
  const dir = ornekle(iz, "wind_direction_10m", lat, lon, Math.round(t)) * Math.PI / 180;
  return [-hiz * Math.sin(dir), -hiz * Math.cos(dir), hiz];
}

/* ------------------------------ Leaflet katmanları ------------------------------ */
function alanKatmani(L, harita, durum) {
  const Kat = L.Layer.extend({
    onAdd(m) {
      this.c = L.DomUtil.create("canvas", "hv-radar-alan"); this.c.setAttribute("aria-hidden", "true");
      m.getContainer().appendChild(this.c);                                                        // harita bölmesinin üstünde, kontrollerin altında
      this.c.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:450;width:100%;height:100%";
      m.on("move zoom resize", this.planla, this); this.planla();
    },
    onRemove(m) { m.off("move zoom resize", this.planla, this); this.c.remove(); },
    planla() { if (this.r) return; this.r = requestAnimationFrame(() => { this.r = 0; this.ciz(); }); },
    ciz() {
      const m = harita, boy = m.getSize(), K = 5;
      const w = Math.ceil(boy.x / K), h = Math.ceil(boy.y / K);
      if (this.c.width !== w) this.c.width = w; if (this.c.height !== h) this.c.height = h;
      const g = this.c.getContext("2d"); g.clearRect(0, 0, w, h);
      const iz = durum.izgara, ad = DEGISKEN[durum.katman]; if (!iz || !ad) return;
      const img = g.createImageData(w, h), olc = OLCEK[durum.katman], t = durum.t;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ll = m.containerPointToLatLng([x * K + K / 2, y * K + K / 2]);
        const c = renk(olc, ornekle(iz, ad, ll.lat, ll.lng, t)); const o = (y * w + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3] * (durum.opaklik ?? 1);
      }
      g.putImageData(img, 0, 0);
      this.c.style.imageRendering = "auto";
    },
  });
  return new Kat();
}
function parcacikKatmani(L, harita, durum) {
  const Kat = L.Layer.extend({
    onAdd(m) {
      this.c = L.DomUtil.create("canvas", "hv-radar-parcacik"); this.c.setAttribute("aria-hidden", "true");
      m.getContainer().appendChild(this.c);
      this.c.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:460;width:100%;height:100%";
      this.boyutla(); this.sifirla();
      m.on("resize", this.boyutla, this); m.on("movestart zoomstart", this.temizle, this); m.on("moveend zoomend", this.sifirla, this);
      this.dur = false; this.adim = this.adim.bind(this); this.raf = requestAnimationFrame(this.adim);
    },
    onRemove(m) { cancelAnimationFrame(this.raf); this.dur = true; m.off("resize", this.boyutla, this); m.off("movestart zoomstart", this.temizle, this); m.off("moveend zoomend", this.sifirla, this); this.c.remove(); },
    boyutla() { const s = harita.getSize(); this.c.width = s.x; this.c.height = s.y; this.sifirla(); },
    temizle() { this.c.getContext("2d").clearRect(0, 0, this.c.width, this.c.height); },
    sifirla() { const s = harita.getSize(); const n = Math.min(2600, Math.round(s.x * s.y / 900)); this.p = Array.from({ length: n }, () => this.yeni(s)); this.temizle(); },
    yeni(s) { return { x: Math.random() * s.x, y: Math.random() * s.y, omur: 30 + Math.random() * 70 }; },
    adim() {
      if (this.dur) return; this.raf = requestAnimationFrame(this.adim);
      const iz = durum.izgara; if (!iz || document.hidden || durum.katman !== "ruzgar" && durum.katman !== "hamle") { return; }
      const g = this.c.getContext("2d"), s = harita.getSize();
      g.globalCompositeOperation = "destination-out"; g.fillStyle = "rgba(0,0,0,0.07)"; g.fillRect(0, 0, s.x, s.y);
      g.globalCompositeOperation = "source-over"; g.lineWidth = 1.2;
      const z = harita.getZoom(), olcek = 0.012 * Math.pow(2, z) / 8;                       // px / (km/sa) / kare
      for (const q of this.p) {
        const ll = harita.containerPointToLatLng([q.x, q.y]);
        const uv = ruzgarUV(iz, ll.lat, ll.lng, durum.t);
        if (!uv || --q.omur < 0) { Object.assign(q, this.yeni(s)); continue; }
        const nx = q.x + uv[0] * olcek, ny = q.y - uv[1] * olcek;
        const a = Math.min(1, uv[2] / 50); g.strokeStyle = `rgba(255,255,255,${0.35 + 0.5 * a})`;
        g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(nx, ny); g.stroke();
        q.x = nx; q.y = ny; if (nx < 0 || ny < 0 || nx > s.x || ny > s.y) Object.assign(q, this.yeni(s));
      }
    },
  });
  return new Kat();
}

/* ------------------------------ sekme ------------------------------ */
export function radarSekmesi(d, kb) {
  const konum = d.konum || { lat: 41.0, lon: 29.0 };
  // Aynı konum için canlı harita varsa YENİDEN KURMA (hava yenilenince/ayar değişince kb.ciz() çağrılır; harita, katman ve zaman çubuğu durumu kaybolmasın)
  const anahtar = `${Number(konum.lat).toFixed(3)},${Number(konum.lon).toFixed(3)}`;
  if (canli && canli.anahtar === anahtar && canli.kok) { setTimeout(() => canli?.boyutTazele?.(), 60); return canli.kok; }
  radarDurdur();
  const kok = el("section", { class: "hv-radar", "aria-label": "Hava radarı" });
  const durum = { katman: "radar", t: 0, izgara: null, oynat: false, hiz: 1, detay: 70, bolge: "konum", opaklik: 0.9, gozlem: { kareler: [], i: 0, katmanlar: new Map(), host: "" } };

  const baslik = el("div", { class: "hv-radar-ust" },
    el("div", {}, el("strong", { text: "🛰️ Radar" }), el("small", { class: "muted", text: ` · 📍 ${gorunenAd(konum)}` })),
    el("div", { class: "hv-radar-bolgeler", role: "group", "aria-label": "Bölge" }));
  const katmanSerit = el("div", { class: "hv-radar-katmanlar", role: "tablist", "aria-label": "Harita katmanı" });
  const harita = el("div", { class: "hv-radar-harita", role: "application", "aria-label": "Harita: sürükleyerek kaydır, tekerlek/sıkıştırma ile yakınlaştır" });
  const durumSatir = el("p", { class: "hv-radar-durum muted", role: "status", "aria-live": "polite" });
  const efsane = el("div", { class: "hv-radar-efsane", "aria-hidden": "true" });
  const zaman = el("div", { class: "hv-radar-zaman" });
  const oynatDugme = el("button", { type: "button", class: "hv-btn", "aria-label": "Oynat/durdur", text: "▶" });
  const geri = el("button", { type: "button", class: "hv-btn", "aria-label": "Bir saat geri", text: "⏮" });
  const ileri = el("button", { type: "button", class: "hv-btn", "aria-label": "Bir saat ileri", text: "⏭" });
  const suan = el("button", { type: "button", class: "hv-btn", text: "Şimdi" });
  const cubuk = el("input", { type: "range", min: "0", max: "0", step: "1", value: "0", class: "hv-radar-cubuk", "aria-label": "Zaman" });
  const zamanYazi = el("output", { class: "hv-radar-zamanyazi", "aria-live": "off" });
  const hizSec = el("select", { class: "hv-girdi hv-girdi-kucuk", "aria-label": "Oynatma hızı" }, ...[["1", "1×"], ["2", "2×"], ["4", "4×"]].map(([v, a]) => el("option", { value: v, text: a })));
  const detaySec = el("select", { class: "hv-girdi hv-girdi-kucuk", "aria-label": "Tahmin ızgarası detayı", title: "Daha yüksek detay = daha çok istek" }, ...[["45", "Düşük detay"], ["70", "Orta detay"], ["120", "Yüksek detay"]].map(([v, a]) => el("option", { value: v, text: a })));
  detaySec.value = "70";
  const yukleDugme = el("button", { type: "button", class: "hv-btn hv-btn-birincil", text: "⟳ Bu görünüm için tahmini yükle", hidden: true });
  zaman.append(geri, oynatDugme, ileri, cubuk, zamanYazi, suan, hizSec);
  kok.append(baslik, katmanSerit, el("div", { class: "hv-radar-kap" }, harita, efsane), zaman, el("div", { class: "hv-radar-alt" }, detaySec, yukleDugme, durumSatir),
    el("p", { class: "muted hv-radar-kaynak", text: "Veri: RainViewer (radar/uydu) · Open-Meteo (tahmin) · harita © OpenStreetMap, © CARTO. Radar kapsaması bölgeye göre değişir; tahmin katmanları model çıktısıdır, kesin değildir." }));

  let L, map, tabanKat, alanKat, parcKat, isaret, sonYuklenenSinir = null, yukluSinyal = null, zamanlayici = null, kapali = false;
  const koyu = () => document.documentElement.dataset.theme === "dark" || window.matchMedia?.("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";

  /* --- katman düğmeleri --- */
  KATMANLAR.forEach(([id, ik, ad, tur]) => {
    const b = el("button", { type: "button", class: "hv-radar-kat", role: "tab", "aria-selected": String(id === durum.katman), "data-id": id, title: tur === "gozlem" ? "Gerçek zamanlı gözlem (son 2 saat)" : "Model tahmini (saatlik, 10 güne kadar)" }, el("span", { "aria-hidden": "true", text: ik }), el("span", { text: ad }));
    olay(b, "click", () => katmanDegis(id)); katmanSerit.append(b);
  });
  const bolgeKutu = baslik.querySelector(".hv-radar-bolgeler");
  Object.entries(BOLGELER).forEach(([id, [ad]]) => { const b = el("button", { type: "button", class: "hv-btn hv-btn-ince", "data-id": id, text: ad }); olay(b, "click", () => bolgeGit(id)); bolgeKutu.append(b); });
  [["⛶", "Tam ekran", () => tamEkran()], ["◎", "Konumum (GPS)", () => gps()]].forEach(([i, a, f]) => { const b = el("button", { type: "button", class: "hv-btn hv-btn-ince", title: a, "aria-label": a, text: i }); olay(b, "click", f); bolgeKutu.append(b); });

  function durumYaz(m, hata = false) { durumSatir.textContent = m || ""; durumSatir.classList.toggle("hv-uyari", hata); }
  function efsaneCiz() {
    const k = durum.katman;
    if (k === "radar") { efsane.replaceChildren(el("span", { text: "Hafif" }), el("i", { class: "hv-ef-bar radar" }), el("span", { text: "Şiddetli yağış" })); return; }
    if (k === "uydu") { efsane.replaceChildren(el("span", { text: "Sıcak/açık" }), el("i", { class: "hv-ef-bar uydu" }), el("span", { text: "Soğuk/kalın bulut" })); return; }
    const olc = OLCEK[k]; const aralik = olc[olc.length - 1][0] - olc[0][0];
    const bar = el("i", { class: "hv-ef-bar" }); bar.style.background = `linear-gradient(90deg,${olc.map(([v, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.35, c[3] / 255)}) ${(((v - olc[0][0]) / aralik) * 100).toFixed(0)}%`).join(",")})`;
    efsane.replaceChildren(el("span", { text: `${olc[0][0]} ${BIRIM[k]}` }), bar, el("span", { text: `${olc[olc.length - 1][0]} ${BIRIM[k]}` }));
  }

  /* --- zaman çubuğu --- */
  function zamanKur() {
    const gozlem = KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem";
    if (gozlem) { cubuk.max = String(Math.max(0, durum.gozlem.kareler.length - 1)); cubuk.value = String(durum.gozlem.i); }
    else if (durum.izgara) { const simdi = durum.izgara.zaman.findIndex((z) => z >= Date.now() - 3600000); durum.simdiIdx = Math.max(0, simdi); cubuk.max = String(durum.izgara.n - 1); cubuk.value = String(Math.round(durum.t)); }
    else { cubuk.max = "0"; cubuk.value = "0"; }
    zamanYazisi();
  }
  function zamanYazisi() {
    const gozlem = KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem";
    if (gozlem) { const k = durum.gozlem.kareler[durum.gozlem.i]; zamanYazi.textContent = k ? `${saatYaz(k.time * 1000, false)}${k.tahmin ? " · tahmin" : " · gözlem"}` : "—"; }
    else if (durum.izgara) { const ms = durum.izgara.zaman[Math.round(durum.t)]; const fark = Math.round((ms - Date.now()) / 3600000); zamanYazi.textContent = `${saatYaz(ms)} · ${fark >= 0 ? `+${fark}` : fark} sa`; }
    else zamanYazi.textContent = "Tahmin yüklenmedi";
  }
  function kareGit(i) {
    const gozlem = KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem";
    if (gozlem) { const n = durum.gozlem.kareler.length; if (!n) return; durum.gozlem.i = (i + n) % n; gozlemKareGoster(); }
    else if (durum.izgara) { durum.t = Math.max(0, Math.min(durum.izgara.n - 1, i)); alanKat?.planla(); }
    cubuk.value = String(gozlem ? durum.gozlem.i : Math.round(durum.t)); zamanYazisi();
  }

  /* --- gözlem katmanları (RainViewer) --- */
  async function gozlemYukle() {
    if (durum.gozlem.yuklendi) return;
    const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error("Radar servisi yanıt vermedi.");
    const j = await r.json(); durum.gozlem.host = j.host || "https://tilecache.rainviewer.com"; durum.gozlem.json = j; durum.gozlem.yuklendi = true;
  }
  function gozlemKareleriKur() {
    const j = durum.gozlem.json; if (!j) return;
    for (const [, k] of durum.gozlem.katmanlar) k.remove(); durum.gozlem.katmanlar.clear();
    if (durum.katman === "radar") durum.gozlem.kareler = [...(j.radar?.past || []).map((x) => ({ ...x, tahmin: false })), ...(j.radar?.nowcast || []).map((x) => ({ ...x, tahmin: true }))];
    else durum.gozlem.kareler = (j.satellite?.infrared || []).map((x) => ({ ...x, tahmin: false }));
    durum.gozlem.i = Math.max(0, (j.radar?.past?.length || durum.gozlem.kareler.length) - 1);
    if (durum.katman === "uydu") durum.gozlem.i = Math.max(0, durum.gozlem.kareler.length - 1);
  }
  function gozlemKareGoster() {
    const k = durum.gozlem.kareler[durum.gozlem.i]; if (!k) return;
    for (const [yol, kat] of durum.gozlem.katmanlar) kat.setOpacity(yol === k.path ? durum.opaklik : 0);
    if (!durum.gozlem.katmanlar.has(k.path)) {
      const renkKodu = durum.katman === "radar" ? "2/1_1" : "0/0_0";                         // radar: Universal Blue, yumuşat, kar; uydu: renksiz IR
      const kat = L.tileLayer(`${durum.gozlem.host}${k.path}/256/{z}/{x}/{y}/${renkKodu}.png`, { opacity: durum.opaklik, maxNativeZoom: 7, maxZoom: 12, zIndex: 400, attribution: "RainViewer", crossOrigin: true });
      kat.addTo(map); durum.gozlem.katmanlar.set(k.path, kat);
    }
    zamanYazisi();
  }

  /* --- tahmin ızgarası --- */
  async function tahminYukle(neden = "") {
    yukluSinyal?.abort(); yukluSinyal = new AbortController();
    const b = map.getBounds(), pad = 0.1, dy = (b.getNorth() - b.getSouth()) * pad, dx = (b.getEast() - b.getWest()) * pad;
    const sinir = [[b.getSouth() - dy, b.getWest() - dx], [b.getNorth() + dy, b.getEast() + dx]];
    durumYaz("Tahmin ızgarası yükleniyor…"); yukleDugme.disabled = true;
    try {
      const iz = await izgaraGetir(sinir, Number(detaySec.value), yukluSinyal.signal);
      durum.izgara = iz; sonYuklenenSinir = sinir;
      durum.simdiIdx = Math.max(0, iz.zaman.findIndex((z) => z >= Date.now() - 3600000));
      if (neden !== "koru") durum.t = durum.simdiIdx;
      yukleDugme.hidden = true; zamanKur(); alanKat?.planla();
      durumYaz(`Tahmin: ${iz.nLat * iz.nLon} nokta · ${saatYaz(iz.alinma, false)} itibarıyla · en çok ${GUN} gün`);
    } catch (h) { if (h.name !== "AbortError") durumYaz(h.message || "Tahmin yüklenemedi.", true); }
    finally { yukleDugme.disabled = false; }
  }
  function gorunumDisindaMi() {
    if (!sonYuklenenSinir || !map) return !durum.izgara;
    const b = map.getBounds(); const [[g, w], [k, e]] = sonYuklenenSinir;
    return b.getSouth() < g - 0.01 || b.getNorth() > k + 0.01 || b.getWest() < w - 0.01 || b.getEast() > e + 0.01;
  }

  /* --- katman / bölge değişimi --- */
  async function katmanDegis(id) {
    durum.katman = id; oynat(false);
    katmanSerit.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
    const tur = KATMANLAR.find((x) => x[0] === id)[3];
    for (const [, k] of durum.gozlem.katmanlar) k.remove(); durum.gozlem.katmanlar.clear();
    if (alanKat) { map.removeLayer(alanKat); alanKat = null; }
    if (parcKat) { map.removeLayer(parcKat); parcKat = null; }
    efsaneCiz();
    if (tur === "gozlem") {
      yukleDugme.hidden = true; durumYaz("Radar verisi alınıyor…");
      try { await gozlemYukle(); if (durum.katman !== id) return; gozlemKareleriKur(); gozlemKareGoster(); zamanKur(); durumYaz(id === "radar" ? "Canlı radar · son ~2 saat ve 30 dk tahmin" : "Kızılötesi uydu görüntüsü"); }
      catch (h) { durumYaz(`${h.message} (RainViewer erişilemiyor olabilir)`, true); }
    } else {
      alanKat = alanKatmani(L, map, durum); alanKat.addTo(map);
      if (id === "ruzgar" || id === "hamle") { parcKat = parcacikKatmani(L, map, durum); parcKat.addTo(map); }
      if (!durum.izgara) await tahminYukle(); else { zamanKur(); alanKat.planla(); yukleDugme.hidden = !gorunumDisindaMi(); }
    }
  }
  function bolgeGit(id) {
    durum.bolge = id; bolgeKutu.querySelectorAll("button[data-id]").forEach((b) => b.classList.toggle("aktif", b.dataset.id === id));
    if (id === "konum") map.setView([konum.lat, konum.lon], 7); else map.fitBounds(BOLGELER[id][1], { animate: true, padding: [10, 10] });
    durum.izgara = null; sonYuklenenSinir = null;
    setTimeout(() => { if (kapali) return; const tur = KATMANLAR.find((x) => x[0] === durum.katman)[3]; if (tur === "tahmin") tahminYukle(); }, 600);
  }
  function gps() {
    if (!navigator.geolocation) { durumYaz("Bu tarayıcı konum vermiyor.", true); return; }
    navigator.geolocation.getCurrentPosition((p) => { map.setView([p.coords.latitude, p.coords.longitude], 8); isaretKoy(p.coords.latitude, p.coords.longitude, "Konumun"); }, () => durumYaz("Konum izni verilmedi.", true), { timeout: 8000 });
  }
  function tamEkran() { const k = kok; if (document.fullscreenElement) document.exitFullscreen(); else (k.requestFullscreen || k.webkitRequestFullscreen)?.call(k); setTimeout(() => map.invalidateSize(), 300); }
  function isaretKoy(lat, lon, ad) { isaret?.remove(); isaret = L.marker([lat, lon], { icon: L.divIcon({ className: "hv-radar-isaret", html: "<span></span>", iconSize: [18, 18] }), title: ad }).addTo(map); }

  /* --- oynatma --- */
  function oynat(ac) {
    durum.oynat = ac; oynatDugme.textContent = ac ? "⏸" : "▶"; clearInterval(zamanlayici);
    if (!ac) return;
    const gozlem = KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem";
    zamanlayici = setInterval(() => {
      if (document.hidden) return;
      if (gozlem) kareGit(durum.gozlem.i + 1);
      else if (durum.izgara) { const sonraki = durum.t + 1 >= durum.izgara.n ? (durum.simdiIdx || 0) : durum.t + 1; kareGit(sonraki); }
    }, (gozlem ? 700 : 420) / durum.hiz);
  }
  olay(oynatDugme, "click", () => oynat(!durum.oynat));
  olay(geri, "click", () => { oynat(false); kareGit((KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem" ? durum.gozlem.i : Math.round(durum.t)) - 1); });
  olay(ileri, "click", () => { oynat(false); kareGit((KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem" ? durum.gozlem.i : Math.round(durum.t)) + 1); });
  olay(suan, "click", () => { oynat(false); if (KATMANLAR.find((x) => x[0] === durum.katman)[3] === "gozlem") { gozlemKareleriKur(); gozlemKareGoster(); zamanKur(); } else if (durum.izgara) kareGit(durum.simdiIdx || 0); });
  olay(cubuk, "input", () => { oynat(false); kareGit(Number(cubuk.value)); });
  olay(hizSec, "change", () => { durum.hiz = Number(hizSec.value); if (durum.oynat) oynat(true); });
  olay(detaySec, "change", () => { durum.izgara = null; sonYuklenenSinir = null; if (KATMANLAR.find((x) => x[0] === durum.katman)[3] === "tahmin") tahminYukle(); });
  olay(yukleDugme, "click", () => tahminYukle("koru"));

  /* --- harita --- */
  leafletYukle().then((Lib) => {
    if (kapali) return; L = Lib;
    map = L.map(harita, { center: [konum.lat, konum.lon], zoom: 7, minZoom: 2, maxZoom: 12, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100, scrollWheelZoom: true, touchZoom: true, doubleClickZoom: true, worldCopyJump: true, zoomControl: true, attributionControl: true, inertia: true });
    const tema = koyu() ? "dark_all" : "light_all";
    tabanKat = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tema}/{z}/{x}/{y}{r}.png`, { subdomains: "abcd", maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>' }).addTo(map);
    isaretKoy(konum.lat, konum.lon, gorunenAd(konum));
    // etiketler (şehir adları) üstte: CARTO "only_labels" yerine taban zaten etiket içerir.
    map.on("moveend", () => { if (KATMANLAR.find((x) => x[0] === durum.katman)[3] === "tahmin") yukleDugme.hidden = !gorunumDisindaMi(); });
    map.on("click", (e) => {
      const iz = durum.izgara; if (!iz || KATMANLAR.find((x) => x[0] === durum.katman)[3] !== "tahmin") return;
      const t = durum.t, f = (ad, n = 0) => { const v = ornekle(iz, ad, e.latlng.lat, e.latlng.lng, t); return Number.isNaN(v) ? "—" : v.toFixed(n); };
      L.popup({ className: "hv-radar-popup" }).setLatLng(e.latlng).setContent(`<strong>${saatYaz(iz.zaman[Math.round(t)])}</strong><br>🌡️ ${f("temperature_2m", 1)} °C · 🌧️ ${f("precipitation", 1)} mm/sa<br>☁️ ${f("cloud_cover")} % · 💧 ${f("relative_humidity_2m")} %<br>🌬️ ${f("wind_speed_10m")} km/sa (hamle ${f("wind_gusts_10m")}) · 🧭 ${f("pressure_msl")} hPa`).openOn(map);
    });
    bolgeKutu.querySelector('[data-id="konum"]').classList.add("aktif");
    efsaneCiz(); katmanDegis("radar");
  }).catch((h) => durumYaz(h.message, true));

  canli = { anahtar, kok, boyutTazele() { try { map?.invalidateSize(); } catch { /* yok say */ } }, durdur() { kapali = true; oynat(false); yukluSinyal?.abort(); try { map?.remove(); } catch { /* yok say */ } map = null; } };
  return kok;
}
