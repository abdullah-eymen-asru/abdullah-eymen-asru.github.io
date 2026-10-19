/**
 * ui-kar.js — Derin analiz › [❄️ Kar & Don Dinamiği] görünümü (v5). Yalnızca GÖSTERİM: tüm sayılar yagis-fizigi.js (saatAnaliz / yagisMotoru) çıktısından gelir.
 *   1) Çift fazlı yağış özeti: faz (yağmur · kar · karışık), taze kar kalınlığı (cm), sıvı eşdeğer (SWE mm), SLR 1:10 ↔ 1:15 bandı, WMO kar kodları.
 *   2) Saatlik taze kar (cm/sa) + saat saat ayrıntı tablosu (SWE × SLR = cm; modelin kendi snowfall cm değeri şeffaflık için yanında).
 *   3) Kar örtüsü birikimi (kümülatif cm) + modelin yerdeki kar kalınlığı (snow_depth).
 *   4) Sıfır izotermi (m) ↔ konum rakımı ↔ kar sınırı.
 *   5) Gizli buzlanma (black ice): zemin yüzey sıcaklığı + nem/yağış geçmişiyle saat saat risk.
 *   6) Taktik: kar/buzlanmada şemsiye iptal, derin kauçuk dişli kar botu, termal içlik, yün/polar ara kat, bere + eldiven.
 * Ortak yapı taşları (uzmanKart, okunus, anlam, saatGrafigi, metrik) ui-uzman.js'ten parametre olarak gelir (döngüsel içe aktarma olmasın diye).
 */
import { el, rozet } from "./ui-temel.js";
import { havaKodu } from "./hava-kodlari.js";
import { saatMetniTam, karSiddeti, SLR_ESIK_C, KAR_SINIRI_FARKI_M, BUZ_SEVIYELERI } from "./yagis-fizigi.js";

const n1 = (x, n = 1) => String(Number(x).toFixed(n));
const FAZ_AD = { yok: "Yağış yok", yagmur: "Yalnızca yağmur (sıvı faz)", kar: "Kar (katı faz)", karisik: "Karla karışık yağmur (çift faz)" };
const FAZ_IKON = { yok: "☀️", yagmur: "🌧️", kar: "❄️", karisik: "🌨️" };

/* ------------------------------ 1) çift fazlı özet ------------------------------ */
function fazKarti(G, H) {
  const f = G.fizik, k = f.kar;
  const kutu = (baslik, deger, birim, alt, sinif) => el("div", { class: `hv-ozet-kutu ${sinif}` },
    el("small", { class: "hv-ozet-baslik", text: baslik }), el("strong", { class: "hv-ozet-deger" }, deger, birim ? el("span", { class: "hv-ozet-birim", text: ` ${birim}` }) : null), el("small", { class: "hv-ozet-alt", text: alt }));
  const sid = k.siddet;
  const kodlar = k.kodlar.length ? k.kodlar.map((c) => `${c} ${havaKodu(c, true).ad}`).join(" · ") : "kar kodu yok";
  return H.uzmanKart("Çift fazlı yağış: sıvı mı, katı mı?",
    "Yağış yere sıvı (yağmur) ya da katı (kar) olarak düşer; kış günlerinde ikisi aynı gün içinde birbirine dönüşebilir. Kar günlerinde ham “mm” yerine zemine birikecek taze kar kalınlığı (cm) esas alınır: sıvı eşdeğer (SWE) × kar-sıvı oranı (SLR).",
    el("div", { class: "hv-faz-baslik" }, el("span", { class: "hv-faz-ikon", "aria-hidden": "true", text: FAZ_IKON[f.faz] || "🌡️" }), el("strong", { text: FAZ_AD[f.faz] || "—" }), f.faz === "karisik" ? rozet("Çift faz", "hv-rozet-onemli") : null),
    el("div", { class: "hv-ozet-grid" },
      kutu("Taze kar kalınlığı", n1(k.toplamCm), "cm", k.var ? `${k.aralik || "gün içinde"} · ${sid.ad}` : "kar beklenmiyor", k.var ? `d${Math.max(1, sid.id)}` : "d1"),
      kutu("Sıvı eşdeğer (SWE)", n1(k.toplamSWE, 2), "mm", k.var ? "kar yağışının su karşılığı" : "—", "d1"),
      kutu("SLR 1:10 (ıslak/yoğun)", n1(k.slrAralik.islak), "cm", `T > ${SLR_ESIK_C}°C iken geçerli oran`, k.slrAna === 10 && k.var ? "d3" : "d1"),
      kutu("SLR 1:15 (kuru/pudra)", n1(k.slrAralik.kuru), "cm", `T ≤ ${SLR_ESIK_C}°C iken geçerli oran`, k.slrAna === 15 && k.var ? "d3" : "d1"),
      kutu("En yoğun saat", n1(k.zirveCm), "cm/sa", k.zirveSaat != null ? `${saatMetniTam(k.zirveSaat)} civarı` : "—", `d${Math.max(1, sid.id)}`)),
    el("small", { class: "hv-ipucu", text: `WMO kodları: ${kodlar}. Modelin kendi hesabı (snowfall) bu gün toplam ${n1(k.modelCm)} cm; HavaStil, oranı sıcaklığa göre kendisi seçer ve her iki oranı da gösterir.` }),
    H.okunus("SWE = o saatin yağışından yağmur ve sağanak payı çıkarıldığında kalan kar suyu (mm). cm = SWE × SLR ÷ 10.", "SLR 1:10 → 1 mm sıvı ≈ 1 cm kar (ıslak, yoğun kar, 0 °C civarı). SLR 1:15 → 1 mm sıvı ≈ 1,5 cm kar (soğuk, hafif pudra kar).", "Karla karışık yağmurda (çift faz) yalnızca kar payı cm'ye çevrilir; yağmur payı mm olarak kalır."),
    H.anlam(k.var ? `Yerde yaklaşık ${n1(k.toplamCm)} cm taze kar birikebilir (${n1(k.slrAralik.islak)}–${n1(k.slrAralik.kuru)} cm aralığı). Şemsiyeyi bırak, kış donanımını tamamla.` : "Bu gün kar yağışı yok; aşağıda donma seviyesi ve gizli buzlanma riskine bak."));
}

/* ------------------------------ 2) saatlik kar ------------------------------ */
function saatlikKarKarti(G, H, simdiT) {
  const a = G.saatler.map((x) => ({ x, ...H.saatAnaliz(x) }));
  const maks = Math.max(2, Math.ceil(Math.max(...a.map((y) => y.karCm), 0)));
  const grafik = H.saatGrafigi(a.map((y) => ({ ...y.x, baslik: `${saatMetniTam(y.x.saat)} · ${n1(y.karCm, 2)} cm (SWE ${n1(y.swe, 2)} mm × 1:${y.slr}) · modelin kendi değeri ${n1(y.modelKarCm, 2)} cm` })), simdiT,
    (x, i) => [{ oran: a[i].karCm / maks, sinif: a[i].karSiddet.sinif }],
    [{ oran: 0.5 / maks, etiket: "0,5 hafif→orta" }, ...(maks >= 2 ? [{ oran: 1.5 / maks, etiket: "1,5 orta→yoğun" }] : [])], `cm/sa (üst sınır ${maks})`);
  const karSaatleri = a.filter((y) => y.karli && (y.karCm > 0 || y.kar > 0));
  let birikim = 0;
  const satirlar = karSaatleri.map((y) => {
    birikim += y.karCm;
    return el("tr", { class: `s${Math.min(3, y.karSiddet.id)}` },
      el("th", { scope: "row", text: saatMetniTam(y.x.saat) }), el("td", { text: `${havaKodu(y.kod, y.x.gunduz).ikon} ${y.kod}` }), el("td", { text: `${y.x.temp}°` }),
      el("td", { text: n1(y.swe, 2) }), el("td", { text: `1:${y.slr}` }), el("td", { class: "hv-kar-cm", text: n1(y.karCm, 2) }), el("td", { text: n1(birikim, 1) }), el("td", { class: "sessiz", text: n1(y.modelKarCm, 2) }));
  });
  const tablo = satirlar.length ? el("div", { class: "hv-matris-kaydir", tabindex: "0", role: "region", "aria-label": "Saatlik kar ayrıntısı, yatay kaydırılabilir" },
    el("table", { class: "hv-matris" }, el("thead", {}, el("tr", {}, ...["Saat", "WMO", "Sıcaklık", "SWE mm", "SLR", "Taze kar cm", "Birikim cm", "Modelin cm'si"].map((t) => el("th", { scope: "col", text: t })))), el("tbody", {}, ...satirlar))) : null;
  return H.uzmanKart("Saatlik taze kar",
    "Sütun yüksekliği o saatte yağan taze kar kalınlığıdır (cm/sa). Renk şiddeti gösterir: yeşil çok hafif, sarı orta, turuncu yoğun, kırmızı tipi.",
    grafik, tablo || el("p", { class: "hv-uzman-not", text: "Bu günün hiçbir saatinde kar yağışı yok (WMO 71/73/75/77/85/86 ya da snowfall > 0 görülmedi)." }),
    H.okunus("Hızlar: < 0,5 cm/sa hafif · 0,5–1,5 orta · 1,5–3 yoğun · ≥ 3 çok yoğun/tipi.", "“Modelin cm'si” Open-Meteo'nun kendi kar dönüşümüdür; HavaStil'in SLR hesabıyla farklı çıkabilir, ikisi şeffaflık için yan yana durur."));
}

/* ------------------------------ 3) kar örtüsü birikimi ------------------------------ */
function birikimKarti(G, H, simdiT) {
  const a = G.saatler.map((x) => ({ x, ...H.saatAnaliz(x) }));
  let t = 0; const kum = a.map((y) => { t += y.karli ? y.karCm : 0; return t; });
  const toplam = Math.max(1, Math.ceil(t));
  const derinlik = G.saatler.map((x) => x.karDerinlik).filter(Number.isFinite);
  const grafik = H.saatGrafigi(a.map((y, i) => ({ ...y.x, baslik: `${saatMetniTam(y.x.saat)} · birikim ${n1(kum[i], 1)} cm` })), simdiT, (x, i) => [{ oran: kum[i] / toplam, sinif: "genis" }], [], `kümülatif cm (üst sınır ${toplam})`);
  return H.uzmanKart("Kar örtüsü birikimi",
    "Gün boyunca yağan taze karın toplamı. Zemin sıcaksa (> 0 °C) karın bir kısmı yere değer değmez erir; bu yüzden birikim, kar yağışının üst sınırıdır.",
    grafik,
    el("div", { class: "hv-detay-grid" },
      H.metrik("Gün sonu toplam taze kar", `${n1(t, 1)} cm`, t > 0 ? "SLR'ye göre hesaplanan üst sınır" : "kar yok"),
      H.metrik("Modelin yerdeki kar kalınlığı", derinlik.length ? `${n1(Math.max(...derinlik), 1)} cm` : "veri yok", derinlik.length ? "snow_depth (en yüksek saat)" : "Bu bölge/saat için model yerdeki kar tahmini vermiyor")),
    H.anlam(t >= 5 ? "Yol ve kaldırımlarda ciddi kar örtüsü oluşabilir; ulaşım için ekstra süre bırak." : t > 0 ? "İnce bir kar tabakası oluşabilir; kaygan zemine dikkat." : "Kar örtüsü oluşmayacak."));
}

/* ------------------------------ 4) donma seviyesi ------------------------------ */
function donmaKarti(G, H, simdiT) {
  const f = G.fizik, d = f.donma, rakim = Number.isFinite(d.rakim) ? d.rakim : null;
  if (d.minM == null) return H.uzmanKart("Donma seviyesi (sıfır izotermi)", "Havanın 0 °C olduğu yükseklik.", el("p", { class: "hv-uzman-not", text: "Bu gün için sıfır izotermi verisi alınamadı." }));
  const ust = Math.max(1000, Math.ceil(Math.max(d.maxM, (rakim ?? 0) + 600) / 500) * 500);
  const sinir = Math.max(0, d.minM - KAR_SINIRI_FARKI_M);
  const grafik = H.saatGrafigi(G.saatler.map((x) => ({ ...x, baslik: `${saatMetniTam(x.saat)} · sıfır izotermi ${x.donma ?? "—"} m` })), simdiT,
    (x) => [{ oran: Number.isFinite(x.donma) ? x.donma / ust : 0, sinif: Number.isFinite(x.donma) && x.donma <= (rakim ?? 0) + KAR_SINIRI_FARKI_M ? "d4" : "d1" }],
    rakim != null ? [{ oran: Math.min(1, rakim / ust), etiket: `rakım ${Math.round(rakim)} m` }] : [], `metre (üst sınır ${ust})`);
  return H.uzmanKart("Donma seviyesi (sıfır izotermi)",
    "Sıfır izotermi, havanın tam 0 °C olduğu yüksekliktir. Yağış bu çizginin altından geçerken eriyorsa yağmur, çizgi zemine yakınsa kar ya da buz olarak düşer. Kar sınırı yaklaşık olarak sıfır izotermi − 300 m'dir.",
    el("div", { class: "hv-detay-grid" },
      H.metrik("Sıfır izotermi (en alçak)", `${Math.round(d.minM)} m`, `gün içi aralık ${Math.round(d.minM)}–${Math.round(d.maxM)} m`),
      H.metrik("Konum rakımı", rakim != null ? `${Math.round(rakim)} m` : "—", rakim != null ? "Open-Meteo'nun ızgara yüksekliği" : "rakım verisi yok"),
      H.metrik("Kar sınırı (yaklaşık)", `${Math.round(sinir)} m`, `sıfır izotermi − ${KAR_SINIRI_FARKI_M} m`)),
    el("p", { class: `hv-donma-yorum ${d.yorum.sinif}`, text: d.yorum.metin }),
    grafik,
    H.okunus("Sütun = o saatin sıfır izotermi (m). Kesikli çizgi = konum rakımı. Sütun çizgiye yaklaştıkça yağışın kara dönme ihtimali artar (turuncu).", "Yüzey katmanında soğuk hava birikmişse (inversiyon) sıfır izotermi yüksek görünse bile zemin donmuş olabilir; bunu yandaki buzlanma kartı yakalar."),
    H.anlam(d.yorum.kod === "yukarida" ? "Yağış yağmur olarak düşer; asıl risk, zemin yüzeyi donuksa buzlanmadır." : "Yağış zemine kar/buz olarak ulaşabilir; kış donanımı gerekli."));
}

/* ------------------------------ 5) gizli buzlanma ------------------------------ */
function buzKarti(G, H) {
  const f = G.fizik, b = f.buzlanma;
  const hucre = (s) => el("div", { class: `hv-buz-hucre b${s.seviye}`, title: `${saatMetniTam(s.saat)} · ${s.ad} · yüzey ${s.yuzey}°C` }, el("small", { text: String(s.saat).padStart(2, "0") }), el("strong", { text: `${Math.round(s.yuzey)}°` }));
  const riskli = b.liste.filter((s) => s.seviye >= 1).sort((p, q) => q.seviye - p.seviye || p.saat - q.saat).slice(0, 6);
  return H.uzmanKart("Gizli buzlanma (black ice)",
    "Görünmeyen buz: asfalt/kaldırım yüzeyi 0 °C'nin altına inmiş ve nemli olduğunda, ince şeffaf bir buz tabakası oluşur. Hava sıcaklığı +1–2 °C görünse bile zemin donmuş olabilir; bu yüzden zemin yüzey sıcaklığına (soil_temperature_0cm) bakılır.",
    el("div", { class: "hv-detay-grid" },
      H.metrik("Gün içi en yüksek risk", b.ad, b.saat != null ? `${saatMetniTam(b.saat)} civarı` : "risk görülmedi", el("span", { class: `hv-siddet ${BUZ_SEVIYELERI[b.maxSeviye].sinif}`, text: b.ad })),
      H.metrik("En düşük zemin yüzey sıcaklığı", `${n1(b.enDusukYuzey)}°C`, b.yuzeyTahmini ? "Bazı saatlerde yüzey verisi yok: hava sıcaklığı − 1,5 °C ile tahmin edildi" : "Open-Meteo zemin yüzey sıcaklığı"),
      H.metrik("Riskli saat sayısı", `${b.saatSayisi} / ${G.saatler.length}`, "Dikkat ve üzeri")),
    el("div", { class: "hv-buz-serit", role: "list", "aria-label": "Saat saat buzlanma riski ve zemin yüzey sıcaklığı" }, ...b.liste.map(hucre)),
    el("div", { class: "hv-grafik-lejant" }, ...BUZ_SEVIYELERI.map((s) => el("span", { class: `buz-l b${s.id}` }, s.ad))),
    riskli.length ? el("div", { class: "hv-e-liste" }, el("small", { class: "hv-ipucu", text: "En riskli saatler ve nedenleri:" }), ...riskli.map((s) => el("div", { class: "hv-e-satir" }, el("strong", { text: saatMetniTam(s.saat) }), el("span", { text: `${s.ad} · yüzey ${s.yuzey}°C — ${s.neden}` })))) : el("p", { class: "hv-uzman-not", text: "Bu gün gizli buzlanma riski görülmüyor." }),
    H.okunus("Kutudaki sayı zemin yüzey sıcaklığıdır; renk riski gösterir (yeşil yok, sarı dikkat, turuncu yüksek, kırmızı çok yüksek).", "Çok yüksek: dondurucu yağış ya da 0 °C altı zeminde sıvı yağış. Yüksek: zemin ≤ 0 °C ve nemli. Dikkat: zemin 0–2 °C ve nemli.", "Köprüler, alt geçitler, gölgeli rampalar ve sabah erken saatler ilk donan yerlerdir."),
    H.anlam(b.maxSeviye >= 2 ? "Kaygan zemin riski gerçek: kısa adım at, derin kauçuk dişli bot giy, şemsiye açıp elini meşgul etme." : b.maxSeviye === 1 ? "Gölge ve köprülerde ince buz olabilir; düz tabanlı ayakkabıdan kaçın." : "Buzlanma kaynaklı bir önlem gerekmiyor."));
}

/* ------------------------------ 6) taktik ------------------------------ */
function taktikKarti(G, H) {
  const f = G.fizik, zorunlu = f.karZorunlu;
  const oge = (ikon, ad, neden) => el("li", { class: "hv-zorunlu-oge" }, el("span", { class: "hv-zorunlu-ikon", "aria-hidden": "true", text: ikon }), el("div", {}, el("strong", { text: ad }), el("small", { text: neden })));
  return H.uzmanKart("Taktik ve donanım (CLO motoru)",
    "Kar ya da gizli buzlanma algılandığında HavaStil kombin motoru şemsiyeyi iptal eder ve kış donanımını zorunlu kılar. Bu liste seçili günün analizine göredir; “Kombin” sekmesi bugünün hazır kombinini verir.",
    zorunlu ? el("ul", { class: "hv-zorunlu" },
      oge("🚫", "Şemsiye iptal", "Kar/buzlanmada eli bağlar, rüzgârda işe yaramaz; kapüşonlu su geçirmez kabuk giyilir."),
      oge("🥾", "Derin kauçuk dişli kar botu", "Dişli kauçuk taban kaymayı azaltır; su geçirmez ve yalıtımlı olmalı. Düz/deri taban yasak."),
      oge("🧦", "Termal içlik", "Nemi ciltten uzaklaştırır; en iç kat. Yün/merino çorapla tamamla."),
      oge("🧶", "Yün veya polar ara katman", "Isıyı hapseden orta kat; çıkarılabilir olsun."),
      oge("🧢", "Bere", "Baştan ısı kaybı çok yüksektir."), oge("🧤", "Eldiven", "Su geçirmez ya da kalın; ıslak eldiven eli daha çok üşütür.")) : el("p", { class: "hv-uzman-not", text: "Bu gün kar ya da gizli buzlanma algılanmadı: kış donanımı zorunlu değil. Normal kombin kuralları geçerli." }),
    f.karZorunlu ? el("p", { class: "hv-uyari", text: f.baslik }) : null,
    H.anlam(zorunlu ? "Dışarı çıkmadan önce botu, bere ve eldiveni kontrol et; adım atarken telefonla oyalanma." : "Kış donanımı gerekmiyor."));
}

/** @param {{tarih:string,saatler:Array,fizik:object}} G  @param {{simdiT:string, H:object}} c */
export function karGorunumu(G, { simdiT, H }) {
  return [fazKarti(G, H), saatlikKarKarti(G, H, simdiT), birikimKarti(G, H, simdiT), donmaKarti(G, H, simdiT), buzKarti(G, H), taktikKarti(G, H)];
}
