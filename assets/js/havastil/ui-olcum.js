/**
 * ui-olcum.js — HavaStil · "RESMÎ ÖLÇÜM ↔ TAHMİN" kartı ve şeridi.
 * Eski "Resmî ölçüm" kartı hangi verinin neden gösterildiğini söylemiyordu. Yeni kart:
 *   • Başlıkta açık güvence rozeti: "MGM resmî verisi" (Meteoroloji Genel Müdürlüğü) ya da "Resmî havalimanı raporu".
 *   • Hangi istasyon, konumuna kaç km, kaç dakika önce — ve (ilçen farklıysa) "senin ilçen için en yakın istasyon" notu.
 *   • Ölçüm ve tahmin YAN YANA, farkı rengiyle; ölçüm tahmini düzelttiyse ne kadar ve neden düzelttiği açıkça yazılır.
 *   • "Bu veri neden burada?" açıklaması (havalimanı neden görünür, güven nasıl hesaplanır).
 * Yeri: Derin analiz'in en üstü (bugün) + Veri doğrulama sekmesi + Bugün ekranında tek satırlık şerit.
 * CSP: inline stil/işleyici yok.
 */
import { el, kart, bolumBasligi, ipucu, olay } from "./ui-temel.js";
import { DURUM_AD } from "./dogrulama.js";
import { sonCekilme, resmiSiteBaglantisi } from "./ui-zaman.js";

const tr = (x, n = 1) => (x == null ? "—" : Number(x).toLocaleString("tr-TR", { maximumFractionDigits: n }));
const dakikaOnce = (iso) => { const dk = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return dk < 2 ? "az önce" : dk < 90 ? `${dk} dk önce` : `${Math.round(dk / 60)} sa önce`; };
const kmYaz = (x) => (x == null ? "" : `${tr(x, 1)} km`);
const YON = ["kuzey", "kuzeydoğu", "doğu", "güneydoğu", "güney", "güneybatı", "batı", "kuzeybatı"];
const GUVEN_AD = { yuksek: "Yüksek", orta: "Orta", dusuk: "Düşük", yok: "—" };

export const kaynakBilgisi = (g) => g.saglayici === "mgm"
  ? { kisa: "MGM resmî verisi", uzun: "Meteoroloji Genel Müdürlüğü (MGM)", rozet: "✔ MGM resmî verisi", ikon: "🏛️" }
  : { kisa: "Resmî havalimanı raporu", uzun: "Havalimanı resmî hava raporu (METAR)", rozet: "✔ Resmî havalimanı raporu", ikon: "✈️" };

/** "Ataşehir için en yakın MGM istasyonu: Kadıköy (5,1 km)" gibi tek cümle. */
function istasyonCumlesi(d, g) {
  const bolge = String(g.ad || "").split(",")[0].trim(), benimYerim = String(d.konum?.ad || "").trim();
  const ayniYer = bolge && benimYerim && bolge.toLocaleLowerCase("tr") === benimYerim.toLocaleLowerCase("tr");
  const kaynak = g.saglayici === "mgm" ? "MGM istasyonu" : "havalimanı";
  if (ayniYer) return `${benimYerim} için ${kaynak}: ${g.ad}${g.mesafeKm != null ? ` (${kmYaz(g.mesafeKm)})` : ""}`;
  return `${benimYerim || "Konumun"} için en yakın ${kaynak}: ${g.ad}${g.kod ? ` (${g.kod})` : ""}${g.mesafeKm != null ? ` · ${kmYaz(g.mesafeKm)} uzakta` : ""}`;
}

function farkChip(s) {
  const isaret = s.fark > 0 ? "+" : s.fark < 0 ? "−" : "";
  return el("span", { class: `hv-olcum-fark ${s.durum}`, title: DURUM_AD[s.durum] }, el("span", { class: "hv-olcum-fark-ikon", "aria-hidden": "true", text: s.durum === "uyumlu" ? "✓" : s.durum === "kucuk" ? "≈" : "!" }),
    el("span", { text: s.fark === 0 ? "Aynı" : `${isaret}${tr(Math.abs(s.fark), s.id === "nem" || s.id === "ruzgar" ? 0 : 1)} ${s.birim}` }));
}

function karsilastirmaTablosu(dg) {
  const baslik = el("div", { class: "hv-olcum-satir baslik", role: "row" }, ...["Değer", "Resmî ölçüm", "Tahmin", "Fark"].map((x) => el("span", { role: "columnheader", text: x })));
  const satirlar = dg.satirlar.map((s) => el("div", { class: `hv-olcum-satir ${s.durum}`, role: "row" },
    el("span", { class: "hv-olcum-ad", role: "rowheader", text: s.ad }),
    el("strong", { role: "cell", text: `${tr(s.olcum, s.id === "nem" || s.id === "ruzgar" ? 0 : 1)} ${s.birim}` }),
    el("span", { role: "cell", text: `${tr(s.model, s.id === "nem" || s.id === "ruzgar" ? 0 : 1)} ${s.birim}` }),
    el("span", { role: "cell" }, farkChip(s))));
  return el("div", { class: "hv-olcum-tablo", role: "table", "aria-label": "Resmî ölçüm ile tahmin karşılaştırması" }, baslik, ...satirlar);
}

/** Doğrulama kapalı/yoksa: yalnızca ölçülen değerler (eski görünüm, sade). */
function yalnizOlcum(g) {
  const kutu = (ad, deger, alt) => el("div", { class: "hv-metrik" }, el("span", { class: "hv-metrik-baslik", text: ad }), el("strong", { text: deger }), alt ? el("small", { text: alt }) : null);
  return el("div", { class: "hv-detay-grid" },
    g.sicaklik != null ? kutu("Sıcaklık", `${tr(g.sicaklik)}°`, g.hissedilen != null ? `Hissedilen ${tr(g.hissedilen)}°` : null) : null,
    g.nem != null ? kutu("Nem", `%${tr(g.nem, 0)}`, g.cig != null ? `Çiğ noktası ${tr(g.cig)}°` : null) : null,
    g.ruzgar != null ? kutu("Rüzgâr", `${tr(g.ruzgar, 0)} km/s`, [g.yon != null ? `${YON[Math.round(g.yon / 45) % 8]} yönünden` : null, g.hamle ? `hamle ${g.hamle} km/s` : null].filter(Boolean).join(" · ") || null) : null,
    g.basinc != null ? kutu("Hava basıncı", `${tr(g.basinc)} hPa`, null) : null,
    g.gorus != null ? kutu("Görüş mesafesi", g.gorus >= 10000 ? "10 km+" : `${tr(g.gorus / 1000)} km`, null) : null);
}

function neden(g) {
  return el("details", { class: "hv-yardim-blok hv-olcum-neden" }, el("summary", { text: "Bu veri neden burada?" }),
    el("ul", { class: "hv-liste" },
      g.saglayici === "mgm"
        ? el("li", { text: "Türkiye'deyken önce Meteoroloji Genel Müdürlüğü'nün (MGM) resmî ölçümü aranır. MGM, ilçe merkezleri için en yakın ölçüm istasyonunun verisini yayınlar; bu yüzden bulunduğun ilçeyle istasyonun adı farklı olabilir (örn. Ataşehir için Kadıköy ya da Kartal)." })
        : el("li", { text: "MGM ölçümü alınamadığında ya da Türkiye dışındayken en yakın havalimanının resmî hava raporu (METAR) kullanılır. Havalimanları uçuş güvenliği için saatlik/yarım saatlik resmî ölçüm yapar ve bu raporlar dünya genelinde herkese açık yayınlanır." }),
      el("li", { text: "Güven puanı ölçümün yaşına ve konumuna uzaklığına bağlıdır. Düşük güvenli ölçüm yalnızca gösterilir, hiçbir hesabı değiştirmez." }),
      el("li", { text: "Sıcaklık ve hissedilen değer güvenliyse yakın saatlerde ölçüme doğru kaydırılır (en çok ±4°, birkaç saatte sönümlenir). Nem, rüzgâr ve basınç yalnızca karşılaştırılır; çünkü bina, tepe ve deniz gibi yerel etkilere çok bağlıdırlar." }),
      el("li", { text: "Kombin ve yağış kararı hâlâ aynı motordan çıkar; bu kart motorun girdisinin ölçümle ne kadar örtüştüğünü gösterir. Yönetici ayarlardan düzeltmeyi kapatabilir." })));
}

/** Tam kart. d.hava.gozlem yoksa null (ekran sade kalır). */
export function olcumKarti(d, kb) {
  const g = d.hava?.gozlem, dg = d.hava?.dogrulama;
  if (!g || d.vitrin || d.misafir) return null;                  // vitrin/misafirde resmî ölçüm kartı HİÇ çizilmez
  const kay = kaynakBilgisi(g);
  const kok = kart(`hv-olcum ${dg ? `genel-${dg.genel.durum}` : ""}`.trim(), bolumBasligi("Resmî ölçümle doğrulama", el("span", { class: "hv-olcum-rozet", title: kay.uzun }, el("span", { "aria-hidden": "true", text: kay.ikon }), el("span", { text: kay.rozet }))));
  kok.append(
    el("p", { class: "hv-olcum-konum" }, el("strong", { text: istasyonCumlesi(d, g) }), el("span", { class: "hv-olcum-zaman", text: ` · ${dakikaOnce(g.zaman)} ölçüldü · ${kay.uzun}` })),
    el("div", { class: "hv-olcum-dogrula" }, resmiSiteBaglantisi(g, { sinif: "hv-resmi-link hv-resmi-link--buyuk" }), el("small", { class: "muted", text: "Açılan sayfada aynı anki resmî değeri görüp yukarıdakiyle karşılaştırabilirsin." })),
    sonCekilme(d, kb, g.saglayici, { olcumZamani: g.zaman }),
    dg && dg.satirlar.length ? karsilastirmaTablosu(dg) : yalnizOlcum(g));
  if (dg) {
    kok.append(el("p", { class: `hv-olcum-genel ${dg.genel.durum}`, text: `${dg.genel.durum === "uyumlu" ? "✅" : dg.genel.durum === "kucuk" ? "🟡" : dg.genel.durum === "belirgin" ? "🔶" : "ℹ️"} ${dg.genel.yazi}` }));
    const satir = (ikon, yazi) => el("li", {}, el("span", { "aria-hidden": "true", text: ikon }), el("span", { text: yazi }));
    kok.append(el("ul", { class: "hv-olcum-notlar" },
      satir("🎯", `Güven: ${GUVEN_AD[dg.guven.duzey]} — ${dg.guven.neden}`),
      dg.duzeltme.uygulandi ? satir("🛠️", `Tahmin ölçüme göre düzeltildi. ${dg.duzeltme.neden}`) : (dg.duzeltme.neden ? satir("ℹ️", dg.duzeltme.neden) : null),
      dg.yagis.yazi ? satir(dg.yagis.durum === "olcumGoruyor" ? "☔" : "💧", dg.yagis.yazi + (dg.yagis.olcumMm != null ? ` (son ölçüm: ${tr(dg.yagis.olcumMm)} mm)` : "")) : null));
  }
  kok.append(neden(g));
  return kok;
}

/** Bugün ekranı için tek satırlık güvence şeridi. Tıklayınca Derin analiz'deki tam karta gider. */
export function olcumSeridi(d, kb) {
  const g = d.hava?.gozlem, dg = d.hava?.dogrulama;
  if (!g || d.vitrin || d.misafir) return null;
  const k = kaynakBilgisi(g);
  const ozet = !dg ? `Ölçülen ${tr(g.sicaklik)}°` : dg.duzeltme.uygulandi ? `Tahmin ölçüme göre ${dg.duzeltme.sicaklik > 0 ? "+" : ""}${tr(dg.duzeltme.sicaklik)}° düzeltildi` : dg.genel.durum === "uyumlu" ? "Tahminle uyumlu" : dg.genel.durum === "kucuk" ? "Küçük farklar var" : dg.genel.durum === "belirgin" ? "Ölçüm tahminden ayrışıyor" : `Ölçülen ${tr(g.sicaklik)}°`;
  const kok = el("section", { class: `hv-olcum-serit ${dg ? `genel-${dg.genel.durum}` : ""}`.trim(), "aria-label": "Resmî ölçüm doğrulaması" },
    el("span", { class: "hv-olcum-rozet", title: k.uzun }, el("span", { "aria-hidden": "true", text: k.ikon }), el("span", { text: k.rozet })),
    el("span", { class: "hv-olcum-serit-metin" }, el("strong", { text: ozet }), el("small", { text: ` ${String(g.ad).split(",")[0]}${g.mesafeKm != null ? ` · ${kmYaz(g.mesafeKm)}` : ""} · ${dakikaOnce(g.zaman)}` })));
  const rl = resmiSiteBaglantisi(g, { kisa: true }); if (rl) kok.append(rl);
  if (kb?.sekmeGit) kok.append(olay(el("button", { type: "button", class: "hv-baglanti", text: "Karşılaştır" }), "click", () => { kb.sekmeGit("derin"); }));
  return kok;
}
void ipucu;
