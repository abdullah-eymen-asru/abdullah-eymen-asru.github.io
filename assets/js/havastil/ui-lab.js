/**
 * ui-lab.js — "🔍 Veri Kaynağı & Karar Doğrulama" (v4). HERKESE AÇIK (demo/vitrin dahil) şeffaflık laboratuvarı.
 * Amaç: kullanıcı bu modülün veri UYDURMADIĞINI görsün — her sayının kaynağı, her kararın formülü ve tetiklenen kural ekranda.
 *   1) Ham Meteoroloji Konsolu  — Open-Meteo'nun döndürdüğü ham değerler (alan adı + değer + birim), alınma zamanı, rakım, saat dilimi.
 *   2) Model karşılaştırması    — ECMWF IFS · DWD ICON · NOAA GFS saatlik yağış miktarları yan yana + ana tahminin PoP'u.
 *      DÜRÜST NOT: Open-Meteo modellere AYRI yağış olasılığı yayınlamaz; yalnızca miktar (mm). "Yağış görüyor mu" oyu (≥ 0,1 mm) buradan türetilir.
 *   3) CLO + kural dökümü       — (33 − T_etkin) / 15 − aktivite, adım adım; tolerans/nem/ıslaklık düzeltmeleri; tetiklenen yağış-fizik kuralları.
 *   4) Haber doğrulama katmanı  — filtreden geçen güncel uyarı: başlık, kaynak, yayın saati, kapsam; elenen sayıları. (Vitrinde Worker çağrılmaz.)
 * Burada yeni hesap YOKTUR: kendi çekirdek fonksiyonları (hedefClo, saatAnaliz, yagisMotoru) aynı girdilerle yeniden gösterilir.
 */
import { el, kart, ipucu, bolumBasligi, rozet, zamanOnce } from "./ui-temel.js";
import { hedefClo, SENARYOLAR } from "./cekirdek.js";
import { ESIK } from "./yagis-fizigi.js";

const pad = (s) => String(s).padStart(2, "0");
const sayiMetni = (v, n = 1) => (Number.isFinite(v) ? String(Math.round(v * 10 ** n) / 10 ** n) : "—");
const MODEL_AD = { ecmwf_ifs025: "ECMWF IFS", icon_seamless: "DWD ICON", gfs_seamless: "NOAA GFS" };
const saatYerel = (iso, tz) => { try { return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: tz || undefined }).format(new Date(iso)); } catch { return iso; } };

const tablo = (basliklar, satirlar, sinif = "") => el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region" },
  el("table", { class: `hv-matris ${sinif}`.trim() }, el("thead", {}, el("tr", {}, ...basliklar.map((b) => el("th", { scope: "col", text: b })))), el("tbody", {}, ...satirlar)));

/* ------------------------------ 1) ham konsol ------------------------------ */
function hamKarti(d) {
  const h = d.hava, r = h.ham;
  if (!r) return kart("hv-lab-kart", bolumBasligi("1 · Ham meteoroloji konsolu"), ipucu("Ham veri bu önbellek sürümünde yok; ↻ ile yenile."));
  const govde = r.simdi.map(([ad, deger, birim]) => el("tr", {}, el("td", { class: "hv-lab-alan", text: ad }), el("td", { class: "hv-lab-deger", text: Number.isFinite(deger) ? String(deger) : "—" }), el("td", { text: birim || "" })));
  return kart("hv-lab-kart", bolumBasligi("1 · Ham meteoroloji konsolu"),
    ipucu("Aşağıdaki sayılar Open-Meteo'dan geldiği gibidir; yuvarlama ve yorum yalnızca diğer sekmelerdedir. Alan adları Open-Meteo API'sinin gerçek adlarıdır."),
    tablo(["Alan (Open-Meteo)", "Ham değer", "Birim"], govde, "hv-lab-tablo"),
    el("div", { class: "hv-lab-meta" },
      rozet(`Kaynak: api.open-meteo.com`), rozet(`Ölçüm zamanı: ${r.alinan ? r.alinan.replace("T", " ") : "—"} (${r.tzKisa || r.tz || "yerel"})`),
      rozet(`Rakım: ${Number.isFinite(r.rakim) ? `${r.rakim} m` : "—"}`), rozet(`Nokta: ${Number(d.konum.lat).toFixed(5)}, ${Number(d.konum.lon).toFixed(5)}`),
      rozet(`${h.onbellek ? "Önbellekten" : "Canlı"} · ${zamanOnce(h.alinma || Date.now())}${h.eski ? " · ESKİ veri" : ""}`, h.eski ? "hv-rozet-onemli" : "hv-rozet-ok")),
    h.kaynakUrl ? el("details", { class: "hv-yardim" }, el("summary", { text: "İsteği kendin doğrula (API adresi)" }), el("p", { class: "hv-ipucu hv-lab-url", text: `${h.kaynakUrl}&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,precipitation&hourly=precipitation_probability,precipitation,cape,uv_index` })) : null);
}

/* ------------------------------ 2) üç model ------------------------------ */
function modelKarti(d) {
  const h = d.hava, ham = h.modelDizi || {}, anahtarlar = Object.keys(ham);
  if (!anahtarlar.length) return kart("hv-lab-kart", bolumBasligi("2 · ECMWF · ICON · GFS karşılaştırması"), ipucu("Çoklu model verisi alınamadı (ağ ya da sınır). Yalnızca ana tahmin kullanılıyor; Güven × Kapsam ayrıştırması bu durumda yapılmaz."));
  const idx = new Map(h.modelZaman.map((t, i) => [t, i]));
  const sl = (h.tumSaatler || []).slice(Math.max(0, (h.tumSaatler || []).findIndex((x) => x.t === h.saatListe?.[0]?.t)), undefined).slice(0, 24);
  const goren = (mm) => Number.isFinite(mm) && mm >= 0.1;
  const toplam = Object.fromEntries(anahtarlar.map((a) => [a, 0])), oy = Object.fromEntries(anahtarlar.map((a) => [a, 0]));
  const satirlar = sl.map((x) => {
    const i = idx.get(x.t);
    const mmler = anahtarlar.map((a) => (i != null ? ham[a][i] : null));
    mmler.forEach((m, k) => { if (Number.isFinite(m)) toplam[anahtarlar[k]] += m; if (goren(m)) oy[anahtarlar[k]] += 1; });
    const anaMm = x.yagis, kaynakOy = [anaMm, ...mmler].filter(Number.isFinite), gorenSay = kaynakOy.filter(goren).length;
    return el("tr", { class: gorenSay >= 3 ? "s2" : gorenSay >= 1 ? "s1" : "" },
      el("th", { scope: "row", text: `${pad(x.saat)}:00` }), el("td", { class: x.yagisOlasi >= 30 ? "" : "sessiz", text: `%${x.yagisOlasi}` }),
      el("td", { class: goren(anaMm) ? "" : "sessiz", text: sayiMetni(anaMm) }), ...mmler.map((m) => el("td", { class: goren(m) ? "" : "sessiz", text: Number.isFinite(m) ? sayiMetni(m) : "—" })),
      el("td", { text: `${gorenSay}/${kaynakOy.length}` }));
  });
  const ozet = el("div", { class: "hv-lab-modeller" }, ...anahtarlar.map((a) => el("div", { class: "hv-lab-model" }, el("small", { text: MODEL_AD[a] || a }), el("strong", { text: `${sayiMetni(toplam[a])} mm` }), el("small", { text: `${oy[a]} saatte yağış görüyor` }))));
  return kart("hv-lab-kart", bolumBasligi("2 · ECMWF · ICON · GFS karşılaştırması"),
    ipucu("Önümüzdeki 24 saat için üç büyük modelin yağış tahmini yan yana. Dürüst not: Open-Meteo modellere ayrı “olasılık” vermez; yalnızca yağış miktarı (mm) verir. “%PoP” ana (harmanlanmış) tahminin olasılığıdır; “görüyor” oyu ≥ 0,1 mm yağış gösteren kaynaklardır."),
    ozet,
    tablo(["Saat", "Ana PoP", "Ana mm", ...anahtarlar.map((a) => `${MODEL_AD[a] || a} mm`), "Yağış gören"], satirlar, "hv-lab-tablo"),
    el("p", { class: "hv-ipucu", text: "Güven = yağış gören kaynakların oranı (ana tahmin + 3 model). Kapsam = PoP ÷ Güven. Bu yüzden modeller ayrışırsa Güven düşer ve “yağmur olur ama belirsiz” denir." }));
}

/* ------------------------------ 3) CLO + kural dökümü ------------------------------ */
function cloKarti(d) {
  const h = d.hava, s = d.sonuc, t = d.tercih, f = d.fizik;
  const sen = SENARYOLAR[t.sen] || SENARYOLAR.toplu;
  const hedef = hedefClo({ apparent: h.apparent, raw: h.raw, hum: h.hum, precip: h.precip }, t.tol, t.sen);
  const adim = (no, ad, deger, aciklama) => el("li", { class: "hv-lab-adim" }, el("span", { class: "hv-lab-no", text: String(no) }), el("div", {}, el("strong", { text: ad }), el("code", { text: deger }), aciklama ? el("small", { class: "hv-ipucu", text: aciklama }) : null));
  const nem = (h.raw ?? 20) <= 10 && (h.hum ?? 0) >= 85, islak = (h.precip ?? 0) >= 0.5;
  const etkin0 = h.apparent + (Number(t.tol) || 0), etkin = etkin0 - (nem ? 1 : 0) - (islak ? 1 : 0);
  const adimlar = [
    adim(1, "Hissedilen sıcaklık", `T_hissedilen = ${h.apparent}°C`, "Open-Meteo apparent_temperature (rüzgâr + nem etkisi dâhil)."),
    adim(2, "Kişisel tolerans", `${h.apparent} ${t.tol >= 0 ? "+" : "−"} ${Math.abs(t.tol)} = ${etkin0}°C`, t.tol ? `Sen “${t.tol > 0 ? "çabuk terlerim" : "çabuk üşürüm"}” seçtin.` : "Normal: düzeltme yok."),
    adim(3, "Nem / ıslaklık düzeltmesi", `${nem ? "−1" : "0"} (soğuk+nemli) ${islak ? "−1" : "+0"} (ıslak) → T_etkin = ${etkin}°C`, [nem ? "≤10°C ve nem ≥ %85: −1°C" : "", islak ? "yağış ≥ 0,5 mm: −1°C" : "", !nem && !islak ? "Koşullar tetiklenmedi." : ""].filter(Boolean).join(" · ")),
    adim(4, "Ham yalıtım ihtiyacı", `(33 − ${etkin}) / 15 = ${((33 - etkin) / 15).toFixed(2)} CLO`, "33°C: derinin konfor sıcaklığı; 15: °C başına CLO ölçeği."),
    adim(5, "Aktivite payı", `− ${sen.aktivite.toFixed(2)} (${sen.ad})`, sen.ipucu),
    adim(6, "Sınırlama [0,25 … 2,6]", `HEDEF = ${hedef.clo.toFixed(2)} CLO`, "Çok düşük/yüksek değerler insan için anlamlı aralığa kırpılır."),
    adim(7, "Seçilen kombin toplamı", `0,10 + 0,85 × Σ parça CLO = ${s.clo.toplam.toFixed(2)} (fark ${s.clo.fark >= 0 ? "+" : ""}${s.clo.fark.toFixed(2)})`, "Parçaların yalıtım değerleri katalog.js'te; kombin hedefe en yakın olacak şekilde seçilir."),
  ];
  const kurallar = (f?.kurallar || []).map((k) => el("div", { class: `hv-kural${k.tetik ? " tetik" : ""}` },
    el("div", { class: "hv-kural-ust" }, el("strong", { text: k.ad }), rozet(k.tetik ? "Tetiklendi" : "Tetiklenmedi", k.tetik ? "hv-rozet-onemli" : "")), el("small", { class: "hv-ipucu", text: `Koşul: ${k.kosul}` }), el("small", { text: k.ozet })));
  const tetik = (s.tetik?.liste || []).map((x) => el("div", { class: "hv-kural tetik" }, el("div", { class: "hv-kural-ust" }, el("strong", { text: `${x.ikon} ${x.ad}` }), rozet(x.olcum || "aktif")), x.esik ? el("small", { class: "hv-ipucu", text: `Eşik: ${x.esik}` }) : null, el("small", { text: `Etki: ${x.etki}` })));
  return kart("hv-lab-kart", bolumBasligi("3 · Matematiksel CLO ve kural dökümü"),
    ipucu("Kombin kararı bir yapay zekâ tahmini değildir: aşağıdaki formül ve eşik tablosundan deterministik olarak çıkar. Aynı girdi her zaman aynı sonucu verir."),
    el("ol", { class: "hv-lab-adimlar" }, ...adimlar),
    el("h3", { class: "hv-alt-baslik", text: "Yağış & fırtına çelişki kuralları (yagis-fizigi.js · ESIK)" }), el("div", { class: "hv-kurallar" }, ...kurallar),
    el("p", { class: "hv-ipucu", text: `Eşikler: sahte alarm PoP ≥ %${ESIK.zararsizPop} & E < ${ESIK.zararsizHacim} mm · sürpriz sağanak PoP ≤ %${ESIK.surprizPop} & CAPE > ${ESIK.surprizCape} · fırtına CAPE > ${ESIK.firtinaCape} J/kg veya hamle > ${ESIK.firtinaHamle} km/s → şemsiye iptal, kapüşonlu teknik kabuk.` }),
    tetik.length ? [el("h3", { class: "hv-alt-baslik", text: "Şu an aktif tetikleyiciler (hangi veri hangi öneriyi doğurdu)" }), el("div", { class: "hv-kurallar" }, ...tetik)] : null,
    el("p", { class: "hv-anlam" }, el("strong", { text: "Sonuç hükmü: " }), el("span", { text: s.hukum })));
}

/* ------------------------------ 4) haber doğrulama ------------------------------ */
function haberKarti(d) {
  const hb = d.haber;
  const baslik = bolumBasligi("4 · Haber doğrulama katmanı");
  if (d.vitrin) return kart("hv-lab-kart", baslik, ipucu("Vitrin modunda haber akışı bilerek kapalıdır (Cloudflare Worker kotası korunur). Üye hesabında burada filtreden geçen güncel uyarı; başlığı, kaynağı ve yayın saatiyle listelenir."));
  if (!d.haberAcik) return kart("hv-lab-kart", baslik, ipucu("Haber doğrulama Ayarlar'da kapalı; hiçbir haber kontrolü yapılmıyor."));
  if (!hb) return kart("hv-lab-kart", baslik, ipucu("🛰️ Haberler kontrol ediliyor…"));
  if (hb.durum !== "ok" && hb.durum !== "temiz") return kart("hv-lab-kart", baslik, ipucu("Haber servisine şu an ulaşılamadı; kombin kararı haberden bağımsız olarak hava verisiyle verildi."));
  const tz = d.hava?.tz;
  const satirlar = hb.uyarilar.map((u) => el("tr", { class: u.uygulandi ? "s2" : "" },
    el("td", {}, u.link ? el("a", { href: u.link, target: "_blank", rel: "noopener noreferrer", text: u.baslik }) : el("span", { text: u.baslik })),
    el("td", { text: u.kurum || u.kaynakAd }), el("td", { text: u.yayin ? saatYerel(u.yayin, tz) : "—" }), el("td", { text: u.kapsamAd ? `${u.kapsamAd} (${u.kapsam})` : "—" }),
    el("td", { text: u.uygulandi ? "✔ uygulandı" : "uygulanmadı" })));
  const e = hb.teshis?.elenen || {};
  return kart("hv-lab-kart", baslik,
    ipucu(hb.uyarilar.length ? "Filtreden (tık tuzağı → zaman → yer → resmî kurum/ajans güvenilirliği → hava verisiyle uyum) geçen güncel uyarılar:" : "Bu konum için filtreden geçen güncel uyarı yok; kombin yalnızca hava verisine dayanıyor."),
    hb.uyarilar.length ? tablo(["Başlık", "Kaynak", "Yayın saati", "Kapsam", "Durum"], satirlar, "hv-lab-tablo") : null,
    el("p", { class: "hv-ipucu", text: `Ayıklanan: ${e.clickbait ?? 0} sansasyonel · ${e.zaman ?? 0} eski/gelecek · ${e.konum ?? 0} başka yer · havuz: ${hb.teshis?.havuzBoyutu ?? "—"} haber · ${zamanOnce(hb.guncelleme || Date.now())} güncellendi.` }));
}

export function dogrulaSekmesi(d, kb) {
  if (!d.hava || !d.sonuc) return kart("hv-bos", ipucu("Hava verisi yükleniyor…"));
  return el("div", { class: "hv-sekme-govde" },
    el("p", { class: "hv-uzman-giris", text: "Bu sayfa herkese açıktır. Amaç: HavaStil'in veri uydurmadığını göstermek — ham sayılar, üç büyük modelin karşılaştırması, kararın matematiği ve haber doğrulaması tek yerde." }),
    hamKarti(d), modelKarti(d), cloKarti(d), haberKarti(d));
}
