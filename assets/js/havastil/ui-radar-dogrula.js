/*
 * ui-radar-dogrula.js — Radar "Veri güvenilirliği" kutusu: kullanıcı verinin NE KADAR TAZE ve NE KADAR TUTARLI olduğunu görsün.
 *  • Radar (RainViewer): üretim zamanı, kare yaşı → taze/eski rozeti.
 *  • Tahmin (Open-Meteo): ızgara alınma zamanı.
 *  • ÇAPRAZ KONTROL: konum için üç bağımsız modelin (ECMWF IFS, DWD ICON, NOAA GFS) önümüzdeki 24 saati karşılaştırılır:
 *    yağış var/yok kararında uyum yüzdesi + sıcaklık farkı. Modeller uyuşmuyorsa "belirsiz" denir (uydurma kesinlik yok).
 * Tek istek (Open-Meteo, anahtarsız), yalnızca kutu AÇILINCA / "Yenile"ye basılınca. Cloudflare kotası harcanmaz. innerHTML yok.
 */
import { el, olay } from "./ui-temel.js";

const MODELLER = [["ecmwf_ifs025", "ECMWF IFS"], ["icon_seamless", "DWD ICON"], ["gfs_seamless", "NOAA GFS"]];
const KAYNAKLAR = [
  ["Radar gözlemi — RainViewer (durum, kapsama, limitler)", "https://www.rainviewer.com/api.html"],
  ["Tahmin modelleri — Open-Meteo (model listesi ve güncelleme saatleri)", "https://open-meteo.com/en/docs"],
  ["Open-Meteo model güncelleme durumu", "https://open-meteo.com/en/docs/model-updates"],
  ["Resmî uyarılar — MGM (Meteoroloji Genel Müdürlüğü)", "https://www.mgm.gov.tr"],
  ["Bulut/uydu — EUMETSAT View", "https://view.eumetsat.int/"],
  ["Günlük uydu — NASA GIBS / Worldview", "https://worldview.earthdata.nasa.gov/"],
];
const dkOnce = (ms) => { const dk = Math.max(0, Math.round((Date.now() - ms) / 60000)); return dk < 1 ? "az önce" : dk < 90 ? `${dk} dk önce` : `${Math.round(dk / 60)} sa önce`; };

async function modelKarsilastir(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=precipitation,temperature_2m&models=${MODELLER.map((m) => m[0]).join(",")}&forecast_days=2&timezone=UTC`;
  const j = await omJson(u);                      // kota + API anahtarı kaynağı (openmeteo.js); hata mesajları orada açıklanır
  const zaman = j.hourly.time.map((t) => new Date(`${t}:00Z`).getTime());
  const bas = zaman.findIndex((z) => z >= Date.now() - 3600000), son = Math.min(zaman.length, bas + 24);
  const s = MODELLER.map(([id, ad]) => {
    const yag = j.hourly[`precipitation_${id}`] || [], sic = j.hourly[`temperature_2m_${id}`] || [];
    const pencere = (a) => a.slice(bas, son).filter((x) => x != null);
    const y = pencere(yag), t = pencere(sic);
    return { id, ad, yag: y, toplam: y.reduce((a, b) => a + b, 0), enYuksekSic: t.length ? Math.max(...t) : null, ortSic: t.length ? t.reduce((a, b) => a + b, 0) / t.length : null };
  }).filter((m) => m.yag.length);
  if (s.length < 2) throw new Error("Karşılaştırma için yeterli model yanıtı gelmedi.");
  const n = Math.min(...s.map((m) => m.yag.length));
  let uyum = 0;
  for (let i = 0; i < n; i++) { const var_ = s.map((m) => m.yag[i] >= 0.1); if (var_.every((x) => x === var_[0])) uyum++; }
  const sicFark = Math.max(...s.map((m) => m.ortSic)) - Math.min(...s.map((m) => m.ortSic));
  return { modeller: s, uyumYuzde: Math.round((uyum / n) * 100), sicFark };
}

/** @param {{konum:{lat:number,lon:number}, oku:()=>({gozlem:any, izgara:any})}} o */
export function dogrulamaKutusu({ konum, oku }) {
  const kutu = el("details", { class: "hv-radar-dogrula" }, el("summary", { text: "🔍 Veri güvenilirliği — bu veriye ne kadar güvenebilirim?" }));
  const ic = el("div", { class: "hv-dogrula-ic" });
  kutu.append(ic);
  let calisiyor = false;
  async function doldur() {
    if (calisiyor) return; calisiyor = true;
    const { gozlem, izgara } = oku();
    const satirlar = [];
    const g = gozlem?.json;
    if (g?.generated) {
      const yas = (Date.now() / 1000 - g.generated) / 60, son = g.radar?.past?.at(-1);
      const sonYas = son ? (Date.now() / 1000 - son.time) / 60 : null;
      satirlar.push(el("li", {}, el("strong", { text: "Radar (gözlem): " }), `RainViewer verisi ${Math.round(yas)} dk önce üretildi; en yeni kare ${sonYas != null ? Math.round(sonYas) : "?"} dk eski. `, el("span", { class: `hv-rozet ${sonYas != null && sonYas <= 25 ? "iyi" : "orta"}`, text: sonYas != null && sonYas <= 25 ? "Taze" : "Biraz eski" })));
    } else satirlar.push(el("li", { text: "Radar verisi henüz yüklenmedi (Radar katmanını aç)." }));
    if (izgara?.alinma) satirlar.push(el("li", {}, el("strong", { text: "Tahmin ızgarası: " }), `Open-Meteo'dan ${dkOnce(izgara.alinma)} alındı (${izgara.nLat * izgara.nLon} nokta).`));
    const model = el("li", { text: "Modeller karşılaştırılıyor…" });
    satirlar.push(model);
    ic.replaceChildren(el("ul", { class: "hv-dogrula-liste" }, ...satirlar),
      el("p", { class: "muted", text: "Radar GÖZLEMDİR (şu an ne yağıyor); tahmin MODEL ÇIKTISIDIR (ne yağabilir) — ikisi birebir aynı olmaz. Radar kapsama dışı bölgelerde boş görünebilir. Can/mal güvenliği kararları için MGM resmî uyarılarına bak: mgm.gov.tr." }),
      el("h4", { class: "hv-dogrula-baslik", text: "Kaynakları kendin doğrula" }),
      el("ul", { class: "hv-dogrula-liste hv-dogrula-baglar" }, ...KAYNAKLAR.map(([ad, url]) => el("li", {}, el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: `${ad} ↗` })))));
    try {
      const k = await modelKarsilastir(konum.lat, konum.lon);
      const etiket = k.uyumYuzde >= 85 && k.sicFark <= 2 ? ["iyi", "Modeller uyumlu"] : k.uyumYuzde >= 65 ? ["orta", "Kısmen uyumlu"] : ["kotu", "Belirsiz: modeller ayrışıyor"];
      model.replaceChildren(el("strong", { text: "Çapraz kontrol (önümüzdeki 24 sa, konumun): " }), `3 bağımsız modelin yağış var/yok kararı %${k.uyumYuzde} uyumlu; ortalama sıcaklık farkı ${k.sicFark.toFixed(1)} °C. `, el("span", { class: `hv-rozet ${etiket[0]}`, text: etiket[1] }),
        el("ul", { class: "hv-dogrula-liste" }, ...k.modeller.map((m) => el("li", { text: `${m.ad}: toplam ${m.toplam.toFixed(1)} mm yağış · en yüksek ${m.enYuksekSic != null ? m.enYuksekSic.toFixed(1) : "—"} °C` }))));
    } catch (h) { model.textContent = `Çapraz kontrol yapılamadı: ${h.message}`; }
    calisiyor = false;
  }
  olay(kutu, "toggle", () => { if (kutu.open) doldur(); });
  return kutu;
}
